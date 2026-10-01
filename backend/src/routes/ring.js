/**
 * SentinelGrid — Ring Developer API Routes
 *
 * Implements the one-way (Ring-driven) account linking flow required by the
 * Ring Developer Console. This is the standard flow for all Ring AppStore apps.
 *
 * Also retains the Partner-Initiated OAuth 2.0 callback endpoint (invitation-only).
 *
 * Official Ring Developer API documentation used as source of truth:
 *   https://developer.amazon.com/docs/ring/api-documentation.html
 *   https://developer.amazon.com/docs/ring/developer-faq.html
 *
 * Security rules enforced throughout:
 *   - All Ring credentials read from environment variables only
 *   - Access tokens, refresh tokens, client secrets never returned in responses
 *   - All Ring OAuth calls are server-to-server (Ring CORS blocks browser calls)
 *   - HMAC-SHA256 webhook signatures verified before any payload is processed
 *   - Webhook idempotency via meta.request_id prevents duplicate incidents
 *   - Nonce matching uses constant-time comparison to prevent timing attacks
 *
 * Ring Developer Console URL mapping:
 *
 *   Console field         Our endpoint
 *   ─────────────────     ─────────────────────────────
 *   Token Exchange URL  → POST /ring/token-exchange
 *   Account Link URL    → GET  /ring/account-link
 *   Webhook URL         → POST /ring/webhook
 *   App Homepage URL    → GET  /ring/home
 *
 * Additional endpoints:
 *   GET  /ring/status     — safe config/status, no secrets
 *   GET  /ring/callback   — Partner-Initiated OAuth 2.0 (invitation-only)
 *
 * Ring OAuth endpoints confirmed from official docs:
 *   Token exchange : https://oauth.ring.com/oauth/token
 *   Vision API     : https://api.amazonvision.com
 *   Webhook header : X-Signature: sha256=<hmac_hex>
 *   Nonce algorithm: HMAC-SHA256(K_hmac, "<time_ms>:<account_id>"), Base64URL no padding
 */

'use strict';

const express = require('express');
const crypto  = require('crypto');  // built-in Node.js
const { v4: uuidv4 } = require('uuid');

const router     = express.Router();
const tokenStore = require('../services/ringTokenStore');
const mockStore  = require('../data/mockStore');

// ── Ring credentials — environment variables only, never hardcoded ───────────
const RING_CLIENT_ID          = process.env.RING_CLIENT_ID;
const RING_CLIENT_SECRET      = process.env.RING_CLIENT_SECRET;
const RING_HMAC_SIGNATURE_KEY = process.env.RING_HMAC_SIGNATURE_KEY;
const RING_REDIRECT_URI       = process.env.RING_REDIRECT_URI;
const RING_API_BASE_URL       = process.env.RING_API_BASE_URL
                                  || 'https://api.amazonvision.com';
const RING_APP_HOMEPAGE_URL   = process.env.RING_APP_HOMEPAGE_URL
                                  || 'http://localhost:5173';

// Ring OAuth server URL — confirmed from official docs
const RING_TOKEN_URL = 'https://oauth.ring.com/oauth/token';

// Ring authorization URL — used by Partner-Initiated flow only
const RING_AUTHORIZE_URL = 'https://account.ring.com/account/integrations/partner-link/authorize';

// ── PKCE session store — for Partner-Initiated flow only ─────────────────────
// Maps state token → { codeVerifier, createdAt }
const pkceSessionStore = new Map();
const PKCE_TTL_MS = 10 * 60 * 1000;

function cleanExpiredPkceSessions() {
  const cutoff = Date.now() - PKCE_TTL_MS;
  for (const [state, session] of pkceSessionStore.entries()) {
    if (session.createdAt < cutoff) pkceSessionStore.delete(state);
  }
}

// ── Webhook idempotency store ─────────────────────────────────────────────────
// Tracks processed meta.request_id values. Bounded at 1000 entries.
const processedWebhookIds = new Set();
const MAX_PROCESSED_IDS = 1000;

function markWebhookProcessed(requestId) {
  if (processedWebhookIds.size >= MAX_PROCESSED_IDS) {
    processedWebhookIds.delete(processedWebhookIds.values().next().value);
  }
  processedWebhookIds.add(requestId);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMissingVarNames(varMap) {
  return Object.entries(varMap).filter(([, v]) => !v).map(([k]) => k);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /ring/status
//
// Returns safe integration status only.
// Shows which env vars are present (boolean) and account summary (no tokens).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const varPresence = {
    RING_CLIENT_ID:          !!RING_CLIENT_ID,
    RING_CLIENT_SECRET:      !!RING_CLIENT_SECRET,
    RING_HMAC_SIGNATURE_KEY: !!RING_HMAC_SIGNATURE_KEY,
    RING_REDIRECT_URI:       !!RING_REDIRECT_URI,
    RING_API_BASE_URL:       !!RING_API_BASE_URL,
    RING_APP_HOMEPAGE_URL:   !!RING_APP_HOMEPAGE_URL,
  };
  const allConfigured = Object.values(varPresence).every(Boolean);

  res.json({
    success: true,
    ring: {
      integrationReady:    allConfigured,
      configuredVariables: varPresence,
      ...tokenStore.getStatusSummary(),
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /ring/home
//
// App Homepage URL — registered in the Ring Developer Console.
// Ring directs users here after account linking is complete.
// Redirects to the SentinelGrid dashboard.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/home', (req, res) => {
  res.redirect(RING_APP_HOMEPAGE_URL);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /ring/token-exchange
//
// Token Exchange URL — registered in the Ring Developer Console.
// Ring calls this endpoint server-to-server (NOT via the user's browser)
// immediately after a user approves the app in the Ring AppStore.
//
// Ring POSTs an authorization code as an application/x-www-form-urlencoded
// body. We must:
//   1. Extract the authorization code from the request body
//   2. Exchange it at https://oauth.ring.com/oauth/token within 60 seconds
//      Parameters: grant_type=authorization_code, code, client_id, client_secret
//      NOTE: No PKCE (code_verifier) — one-way flow does not use PKCE
//   3. Call GET /v1/users/me to retrieve the Ring Account ID (data.id)
//   4. Store tokens as UNCLAIMED — they are not yet associated with a partner user
//   5. Return HTTP 200 promptly
//
// Source: https://developer.amazon.com/docs/ring/api-documentation.html
//         Section 5 — Token Exchange Flow
//         https://developer.amazon.com/docs/ring/developer-faq.html Q1
//
// IMPORTANT: The request body from Ring may be either form-encoded or JSON
// depending on Ring's implementation. We handle both formats.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/token-exchange', async (req, res) => {
  const missing = getMissingVarNames({ RING_CLIENT_ID, RING_CLIENT_SECRET });
  if (missing.length) {
    console.error('[Ring] Token Exchange: missing env vars:', missing);
    // Still return 200 — returning an error could cause Ring to retry
    return res.status(200).json({
      success: false,
      error:   'Token Exchange endpoint not fully configured',
    });
  }

  // Ring sends the authorization code — body may be form-encoded or JSON
  const code = req.body?.code || req.query?.code;
  if (!code) {
    console.warn('[Ring] Token Exchange: no authorization code in request');
    return res.status(200).json({ success: false, error: 'Missing authorization code' });
  }

  console.log('[Ring] Token Exchange: received authorization code, exchanging...');

  // ── Exchange authorization code for tokens (server-to-server) ────────────
  // Authorization codes expire in 60 seconds — exchange immediately.
  // One-way flow does NOT use PKCE; no code_verifier parameter.
  // Source: Ring docs Section 5, confirmed from FAQ Q1.
  let tokens;
  try {
    const tokenBody = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      client_id:     RING_CLIENT_ID,
      client_secret: RING_CLIENT_SECRET,
    });

    const tokenRes = await fetch(RING_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    tokenBody.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error(`[Ring] Token exchange failed (${tokenRes.status}): ${errText}`);
      return res.status(200).json({
        success: false,
        error:   `Token exchange failed with status ${tokenRes.status}`,
      });
    }

    tokens = await tokenRes.json();
  } catch (networkErr) {
    console.error('[Ring] Network error during token exchange:', networkErr.message);
    return res.status(200).json({
      success: false,
      error:   'Network error reaching Ring token endpoint',
    });
  }

  // ── Retrieve Ring Account ID via GET /v1/users/me ─────────────────────────
  // The Account ID (data.id) keys the token store and is used to compute
  // nonces during account linking.
  // Response structure: { "data": { "id": "ava1.ring.account.XXXYYY", ... } }
  let accountId = `unknown-${uuidv4()}`;
  try {
    const profileRes = await fetch(`${RING_API_BASE_URL}/v1/users/me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      accountId = profile?.data?.id || accountId;
    } else {
      console.warn(`[Ring] /v1/users/me returned ${profileRes.status} — using generated ID`);
    }
  } catch (profileErr) {
    console.warn('[Ring] Could not fetch user profile:', profileErr.message);
  }

  // ── Store tokens as UNCLAIMED ─────────────────────────────────────────────
  // Tokens are now held server-side but not yet associated with a partner user.
  // The nonce matching step at GET /ring/account-link will claim them.
  tokenStore.saveUnclaimedTokens(
    accountId,
    tokens.access_token,
    tokens.refresh_token,
    tokens.expires_in || 14400,
  );

  console.log(`[Ring] Token Exchange complete — accountId: ${accountId} (UNCLAIMED)`);

  // Return 200 — Ring requires this to confirm receipt
  res.status(200).json({ success: true, accountId });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /ring/account-link
//
// Account Link URL — registered in the Ring Developer Console.
// Ring redirects the user's browser here AFTER the Token Exchange completes,
// with query parameters: ?nonce=<hmac_nonce>&time=<unix_ms>
//
// This endpoint must:
//   1. Extract nonce and time from query params
//   2. Validate freshness: time must be within 600 seconds of now
//      (time param is Unix epoch in MILLISECONDS)
//   3. Present a login/confirmation page to the user (sign-in is mandatory)
//   4. After user confirms, perform nonce matching:
//      For each UNCLAIMED token, compute:
//        HMAC-SHA256(K_hmac, "<time_ms>:<account_id>")
//        encoded as Base64URL without padding (not hex — different from webhooks)
//      Find the token whose computed nonce matches the received nonce (constant-time)
//   5. Call POST /v1/accounts/me/app-integrations with { account_identifier, nonce }
//   6. Call PATCH /v1/accounts/me/app-integrations with { status: "completed" }
//   7. Mark the token as CLAIMED in the token store
//
// Nonce algorithm confirmed from official Ring docs Section 6.3 and FAQ Q2:
//   payload  = "<time_ms>:<account_id>"   (time in milliseconds as-is)
//   mac      = HMAC-SHA256(K_hmac.encode('utf-8'), payload.encode('utf-8'))
//   nonce    = Base64URL(mac) without padding  (NOT hex — webhooks use hex)
//   window   = 600 seconds
//
// Source: https://developer.amazon.com/docs/ring/api-documentation.html
//         Section 6.3 — Nonce Validation and Account Linking
// ─────────────────────────────────────────────────────────────────────────────
router.get('/account-link', (req, res) => {
  const { nonce, time } = req.query;

  // ── No nonce/time params — Partner-Initiated entry point ──────────────────
  // If the user arrives at this URL directly without Ring's params (e.g. from
  // the SentinelGrid dashboard "Connect Ring" button), initiate Partner-Initiated
  // flow if configured, otherwise show an informational page.
  if (!nonce || !time) {
    const missing = getMissingVarNames({ RING_CLIENT_ID, RING_REDIRECT_URI });
    if (!missing.length) {
      // Redirect to Partner-Initiated flow
      return res.redirect('/ring/partner-link');
    }
    return res.status(200).send(`
      <html><head><title>SentinelGrid — Ring Account Link</title></head>
      <body style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:20px">
        <h2>🛡️ SentinelGrid — Ring Integration</h2>
        <p>This page handles Ring account linking.</p>
        <p>To link your Ring account, install the SentinelGrid app from the Ring AppStore.
        Ring will redirect you here automatically.</p>
        <p><a href="/">Return to SentinelGrid Dashboard</a></p>
      </body></html>`);
  }

  // ── Step 1: Validate nonce and time are present ───────────────────────────
  const missing = getMissingVarNames({ RING_HMAC_SIGNATURE_KEY });
  if (missing.length) {
    console.error('[Ring] Account Link: RING_HMAC_SIGNATURE_KEY not set');
    return res.status(503).send(
      '<html><body><h2>Account linking is not configured on this server.</h2></body></html>',
    );
  }

  // ── Step 2: Freshness check ───────────────────────────────────────────────
  // time is Unix epoch in MILLISECONDS — confirmed from Ring docs FAQ Q2
  const VALIDATION_WINDOW_MS = 600 * 1000; // 600 seconds in ms
  const timeMsParam = parseInt(time, 10);
  if (isNaN(timeMsParam)) {
    console.warn('[Ring] Account Link: invalid time parameter');
    return res.status(400).send('<html><body><h2>Invalid time parameter.</h2></body></html>');
  }

  const ageSec = (Date.now() - timeMsParam) / 1000;
  if (ageSec > 600) {
    console.warn(`[Ring] Account Link: nonce expired (${Math.round(ageSec)}s old)`);
    return res.status(400).send(`
      <html><body>
        <h2>Link request expired.</h2>
        <p>This link is ${Math.round(ageSec)} seconds old. Please return to Ring and try again.</p>
      </body></html>`);
  }
  if (ageSec < 0) {
    console.warn('[Ring] Account Link: timestamp is in the future — rejected');
    return res.status(400).send('<html><body><h2>Invalid timestamp.</h2></body></html>');
  }

  // ── Step 3: Show confirmation page with POST action ───────────────────────
  // Ring's certification requires the user to explicitly authenticate or confirm.
  // For this prototype we present a minimal confirmation form.
  // The nonce and time are passed forward as hidden form fields so the POST
  // handler can complete the nonce matching.
  // NOTE: In production, this page would show a full login form.
  res.send(`
    <html>
      <head><title>SentinelGrid — Connect Ring Account</title></head>
      <body style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:20px">
        <h2>🛡️ Connect Ring Account to SentinelGrid</h2>
        <p>A Ring account is ready to be linked to SentinelGrid.</p>
        <p>By confirming, you allow SentinelGrid to receive motion alerts
           from your Ring devices for the monitoring dashboard.</p>
        <hr>
        <p style="font-size:0.85em;color:#555">
          ⚠️ SentinelGrid is a prototype monitoring tool. Events flagged by Ring
          devices require human verification. No automatic action will be taken.
        </p>
        <form method="POST" action="/ring/account-link/confirm">
          <input type="hidden" name="nonce" value="${escapeHtml(nonce)}">
          <input type="hidden" name="time"  value="${escapeHtml(time)}">
          <button type="submit"
            style="background:#2563eb;color:white;border:none;padding:12px 24px;
                   border-radius:6px;font-size:1em;cursor:pointer;margin-top:12px">
            ✅ Confirm — Link My Ring Account
          </button>
        </form>
        <p style="margin-top:16px"><a href="/">Cancel — Return to Dashboard</a></p>
      </body>
    </html>`);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /ring/account-link/confirm
//
// Handles the confirmation form submission from GET /ring/account-link.
// Performs nonce matching against unclaimed tokens, then calls the
// App-Integrations API to finalise the account link.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/account-link/confirm', async (req, res) => {
  const { nonce: receivedNonce, time } = req.body;

  if (!receivedNonce || !time) {
    return res.status(400).send('<html><body><h2>Missing nonce or time parameter.</h2></body></html>');
  }

  if (!RING_HMAC_SIGNATURE_KEY) {
    return res.status(503).send('<html><body><h2>Server not configured for nonce matching.</h2></body></html>');
  }

  const timeMsParam = parseInt(time, 10);

  // Re-validate freshness — form submission could be delayed
  const ageSec = (Date.now() - timeMsParam) / 1000;
  if (ageSec > 600 || ageSec < 0) {
    return res.status(400).send(`
      <html><body>
        <h2>Link request expired. Please return to Ring and try again.</h2>
      </body></html>`);
  }

  // ── Step 4: Nonce matching ────────────────────────────────────────────────
  // Iterate through all UNCLAIMED tokens.
  // For each, compute: HMAC-SHA256(K_hmac, "<time_ms>:<account_id>")
  // Encode as Base64URL without padding.
  // Compare with constant-time comparison.
  //
  // Algorithm confirmed from Ring docs Section 6.3 and FAQ Q2:
  //   - time param is milliseconds (use as-is in the HMAC payload string)
  //   - encoding is URL-safe Base64 WITHOUT padding (NOT hex)
  //   - the same K_hmac key is used for webhooks but webhooks use hex encoding
  const unclaimedTokens = tokenStore.getUnclaimedTokens();

  if (unclaimedTokens.length === 0) {
    console.warn('[Ring] Nonce match: no unclaimed tokens in pool');
    return res.status(400).send(`
      <html><body>
        <h2>No pending Ring accounts to link.</h2>
        <p>The account may have already been linked or the session expired.</p>
        <p><a href="/">Return to Dashboard</a></p>
      </body></html>`);
  }

  let matchedToken = null;
  for (const record of unclaimedTokens) {
    const payload      = `${time}:${record.accountId}`;
    const computedMac  = crypto
      .createHmac('sha256', RING_HMAC_SIGNATURE_KEY)
      .update(payload, 'utf8')
      .digest();
    // Base64URL without padding — confirmed from Ring docs FAQ Q2
    const computedNonce = computedMac
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Constant-time comparison prevents timing attacks
    let match = false;
    try {
      match = crypto.timingSafeEqual(
        Buffer.from(computedNonce, 'utf8'),
        Buffer.from(receivedNonce,  'utf8'),
      );
    } catch {
      // Buffer lengths differ — not a match
      match = false;
    }

    if (match) {
      matchedToken = record;
      break;
    }
  }

  if (!matchedToken) {
    console.warn('[Ring] Nonce match: no matching unclaimed token found');
    return res.status(400).send(`
      <html><body>
        <h2>Account linking failed — nonce did not match.</h2>
        <p>Please return to Ring and try again.</p>
        <p><a href="/">Return to Dashboard</a></p>
      </body></html>`);
  }

  console.log(`[Ring] Nonce matched — accountId: ${matchedToken.accountId}`);

  // Prototype account identifier — obfuscated partner-side user identifier.
  // In production this would be the masked email of the authenticated partner user.
  // Ring certification requires this to be a non-empty string.
  const PROTOTYPE_ACCOUNT_IDENTIFIER = 'sentinelgrid-operator@prototype.local';

  // ── Step 5: POST to App-Integrations API ─────────────────────────────────
  // Sends the nonce back to Ring for server-side verification.
  // Transitions integration to 'awaiting' status.
  try {
    const postRes = await fetch(
      `${RING_API_BASE_URL}/v1/accounts/me/app-integrations`,
      {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${matchedToken.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account_identifier: PROTOTYPE_ACCOUNT_IDENTIFIER,
          nonce:              receivedNonce,
        }),
      },
    );

    if (!postRes.ok) {
      const errText = await postRes.text();
      console.error(`[Ring] App-Integrations POST failed (${postRes.status}): ${errText}`);
      return res.status(502).send(`
        <html><body>
          <h2>Ring verification failed (${postRes.status}).</h2>
          <p>Please try again.</p>
        </body></html>`);
    }

    console.log(`[Ring] App-Integrations POST accepted for account: ${matchedToken.accountId}`);
  } catch (networkErr) {
    console.error('[Ring] Network error during App-Integrations POST:', networkErr.message);
    return res.status(502).send(
      '<html><body><h2>Network error contacting Ring. Please try again.</h2></body></html>',
    );
  }

  // ── Step 6: PATCH to complete the integration ─────────────────────────────
  // Transitions integration from 'awaiting' to 'completed'.
  // After this, webhook events will be delivered and device API is active.
  try {
    const patchRes = await fetch(
      `${RING_API_BASE_URL}/v1/accounts/me/app-integrations`,
      {
        method:  'PATCH',
        headers: {
          Authorization:  `Bearer ${matchedToken.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'completed' }),
      },
    );

    if (patchRes.ok) {
      console.log(`[Ring] Integration PATCH completed for account: ${matchedToken.accountId}`);
    } else {
      const patchErr = await patchRes.text();
      // Log but continue — token is already claimed, PATCH can be retried
      console.warn(`[Ring] Integration PATCH returned ${patchRes.status}: ${patchErr}`);
    }
  } catch (patchErr) {
    console.warn('[Ring] Network error during PATCH:', patchErr.message);
  }

  // ── Step 7: Mark token as CLAIMED ────────────────────────────────────────
  tokenStore.claimToken(matchedToken.accountId, PROTOTYPE_ACCOUNT_IDENTIFIER);

  console.log(`[Ring] Account linking complete — accountId: ${matchedToken.accountId}`);

  // Return safe confirmation — no tokens in response
  res.send(`
    <html>
      <head><title>SentinelGrid — Ring Linked</title></head>
      <body style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:20px">
        <h2>✅ Ring Account Linked Successfully</h2>
        <p>Your Ring devices are now connected to SentinelGrid.</p>
        <p>Motion events detected by your Ring devices will appear on the
           SentinelGrid dashboard for human verification.</p>
        <p><strong>Account ID:</strong> ${escapeHtml(matchedToken.accountId)}</p>
        <hr>
        <p style="font-size:0.8em;color:#666">
          PROTOTYPE: account_identifier is a static placeholder.<br>
          Events flagged by Ring devices require human operator verification.
          No automatic action is taken.
        </p>
        <p><a href="${escapeHtml(RING_APP_HOMEPAGE_URL)}">Open SentinelGrid Dashboard →</a></p>
      </body>
    </html>`);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /ring/partner-link
//
// Entry point for Partner-Initiated OAuth 2.0 (invitation-only).
// Generates a PKCE pair + CSRF state token, redirects to Ring's authorization
// page. Only available if RING_CLIENT_ID and RING_REDIRECT_URI are set.
//
// Authorization URL parameters confirmed from official Ring docs:
//   client_id, redirect_uri, response_type=code, scope=ava.v1:read,
//   state, code_challenge, code_challenge_method=S256
// ─────────────────────────────────────────────────────────────────────────────
router.get('/partner-link', (req, res) => {
  const missing = getMissingVarNames({ RING_CLIENT_ID, RING_REDIRECT_URI });
  if (missing.length) {
    return res.status(503).json({
      success: false,
      error:   'Partner-Initiated flow not configured.',
      missing,
      hint:    'This flow is invitation-only. Set RING_CLIENT_ID and RING_REDIRECT_URI.',
    });
  }

  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier, 'ascii')
    .digest('base64url');
  const state = crypto.randomBytes(16).toString('base64url');

  cleanExpiredPkceSessions();
  pkceSessionStore.set(state, { codeVerifier, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id:             RING_CLIENT_ID,
    redirect_uri:          RING_REDIRECT_URI,
    response_type:         'code',
    scope:                 'ava.v1:read',
    state,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  });

  console.log(`[Ring] Starting Partner-Initiated link — state: ${state}`);
  res.redirect(`${RING_AUTHORIZE_URL}?${params.toString()}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /ring/callback
//
// Partner-Initiated OAuth 2.0 callback (invitation-only).
// RING_REDIRECT_URI must point here. Ring redirects after user approves.
//
// Steps: validate state → consume PKCE session → exchange code (no PKCE) →
//        get Account ID → store tokens (CLAIMED) → PATCH app-integrations →
//        show confirmation.
//
// NOTE: redirect_uri is NOT included in the token exchange body per Ring docs.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.warn(`[Ring] Callback error: ${error} — ${error_description}`);
    return res.status(400).send(`
      <html><head><title>SentinelGrid — Ring Linking Failed</title></head>
      <body style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:20px">
        <h2>Ring Account Linking Failed</h2>
        <p><strong>Error:</strong> ${escapeHtml(error)}</p>
        <p>${escapeHtml(error_description || '')}</p>
        <p><a href="/">Return to SentinelGrid</a></p>
      </body></html>`);
  }

  if (!code || !state) {
    return res.status(400).send(
      '<html><body><h2>Invalid callback — missing parameters.</h2></body></html>',
    );
  }

  cleanExpiredPkceSessions();
  const pkceSession = pkceSessionStore.get(state);
  if (!pkceSession) {
    console.warn('[Ring] Callback: state not found or expired');
    return res.status(400).send(`
      <html><body>
        <h2>Session expired.</h2>
        <p><a href="/ring/partner-link">Restart account linking</a></p>
      </body></html>`);
  }
  pkceSessionStore.delete(state);
  const { codeVerifier } = pkceSession;

  const missing = getMissingVarNames({ RING_CLIENT_ID, RING_CLIENT_SECRET });
  if (missing.length) {
    return res.status(503).send(
      `<html><body><h2>Server configuration error. Missing: ${missing.join(', ')}</h2></body></html>`,
    );
  }

  let tokens;
  try {
    const tokenBody = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      code_verifier: codeVerifier,
      client_id:     RING_CLIENT_ID,
      client_secret: RING_CLIENT_SECRET,
    });

    const tokenRes = await fetch(RING_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    tokenBody.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error(`[Ring] Callback token exchange failed (${tokenRes.status}): ${errText}`);
      return res.status(502).send(
        `<html><body><h2>Token exchange failed (${tokenRes.status}).</h2></body></html>`,
      );
    }

    tokens = await tokenRes.json();
  } catch (networkErr) {
    console.error('[Ring] Callback network error:', networkErr.message);
    return res.status(502).send(
      '<html><body><h2>Could not reach Ring token endpoint.</h2></body></html>',
    );
  }

  let accountId = 'unknown';
  try {
    const profileRes = await fetch(`${RING_API_BASE_URL}/v1/users/me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      accountId = profile?.data?.id || 'unknown';
    }
  } catch (profileErr) {
    console.warn('[Ring] Callback: could not fetch profile:', profileErr.message);
  }

  tokenStore.saveTokens(
    accountId,
    tokens.access_token,
    tokens.refresh_token,
    tokens.expires_in || 14400,
  );

  const PROTOTYPE_ACCOUNT_IDENTIFIER = 'sentinelgrid-prototype@demo.local';

  try {
    const patchRes = await fetch(
      `${RING_API_BASE_URL}/v1/accounts/me/app-integrations`,
      {
        method:  'PATCH',
        headers: {
          Authorization:  `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status:             'completed',
          account_identifier: PROTOTYPE_ACCOUNT_IDENTIFIER,
        }),
      },
    );
    if (patchRes.ok) {
      console.log(`[Ring] Callback: integration confirmed for account: ${accountId}`);
    } else {
      console.warn(`[Ring] Callback: PATCH returned ${patchRes.status}`);
    }
  } catch (patchErr) {
    console.warn('[Ring] Callback: PATCH network error:', patchErr.message);
  }

  console.log(`[Ring] Partner-Initiated linking complete — accountId: ${accountId}`);

  res.send(`
    <html>
      <head><title>SentinelGrid — Ring Linked</title></head>
      <body style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:20px">
        <h2>✅ Ring Account Linked</h2>
        <p>Your Ring account has been connected to SentinelGrid.</p>
        <p><strong>Account ID:</strong> ${escapeHtml(accountId)}</p>
        <hr>
        <p style="font-size:0.8em;color:#666">
          PROTOTYPE: account_identifier is a static placeholder.
          Events require human operator verification. No automatic action is taken.
        </p>
        <p><a href="${escapeHtml(RING_APP_HOMEPAGE_URL)}">Open SentinelGrid Dashboard →</a></p>
      </body>
    </html>`);
});

// ─────────────────────────────────────────────────────────────────────────────
// ringWebhookHandler — exported separately for express.raw() wiring
//
// POST /ring/webhook — Webhook URL registered in Ring Developer Console.
//
// Signature verification per official Ring Notifications docs:
//   Header    : X-Signature: sha256=<hex_digest>
//   Algorithm : HMAC-SHA256(RING_HMAC_SIGNATURE_KEY, raw_body_bytes).hexdigest()
//   Comparison: crypto.timingSafeEqual — constant-time
//
// NOTE: Webhooks use HEX encoding. Nonces (Account Link) use Base64URL.
// Do not mix the two encodings — confirmed from Ring FAQ Q2.
//
// Idempotency: meta.request_id deduplicated via processedWebhookIds Set.
// ─────────────────────────────────────────────────────────────────────────────
function ringWebhookHandler(req, res) {
  if (!RING_HMAC_SIGNATURE_KEY) {
    console.error('[Ring] RING_HMAC_SIGNATURE_KEY not set — webhook not operational');
    return res.status(200).json({ received: false, reason: 'not_configured' });
  }

  const sigHeader = req.headers['x-signature'];
  if (!sigHeader) {
    console.warn('[Ring] Webhook rejected — missing X-Signature header');
    return res.status(401).json({ success: false, error: 'Missing X-Signature header' });
  }

  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    console.warn('[Ring] Webhook rejected — body is not a raw Buffer');
    return res.status(400).json({ success: false, error: 'Invalid request body' });
  }

  // Compute expected HMAC-SHA256 as HEX (webhooks use hex, not Base64URL)
  const expectedHex = crypto
    .createHmac('sha256', RING_HMAC_SIGNATURE_KEY)
    .update(rawBody)
    .digest('hex');

  const receivedHex = sigHeader.startsWith('sha256=')
    ? sigHeader.slice(7)
    : sigHeader;

  let signatureValid = false;
  try {
    signatureValid = crypto.timingSafeEqual(
      Buffer.from(expectedHex, 'hex'),
      Buffer.from(receivedHex,  'hex'),
    );
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    console.warn('[Ring] Webhook rejected — HMAC signature mismatch');
    return res.status(401).json({ success: false, error: 'Invalid webhook signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    console.warn('[Ring] Webhook rejected — payload is not valid JSON');
    return res.status(400).json({ success: false, error: 'Invalid JSON payload' });
  }

  const requestId = payload?.meta?.request_id;
  const eventType = payload?.data?.type;
  const accountId = payload?.meta?.account_id;
  const deviceId  = payload?.data?.attributes?.source;
  const eventTime = payload?.meta?.time || new Date().toISOString();

  if (requestId && processedWebhookIds.has(requestId)) {
    console.log(`[Ring] Duplicate webhook — requestId ${requestId} already processed`);
    return res.status(200).json({ success: true, duplicate: true });
  }

  // Respond 200 immediately — Ring requires response within 5 seconds
  res.status(200).json({ success: true, received: true });

  if (requestId) markWebhookProcessed(requestId);

  console.log(`[Ring] Webhook — type: ${eventType} | account: ${accountId} | requestId: ${requestId}`);

  if (eventType === 'motion_detected') {
    handleMotionEvent({ accountId, deviceId, eventTime, requestId, payload });
  } else {
    console.log(`[Ring] Event type "${eventType}" received — no incident created`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// handleMotionEvent
//
// Creates a SentinelGrid incident from a verified Ring motion_detected event.
// A Ring motion event is a predefined safety-related trigger.
// It does NOT automatically indicate a crime has occurred.
// Incident is OPEN and requires human operator verification.
// ─────────────────────────────────────────────────────────────────────────────
function handleMotionEvent({ accountId, deviceId, eventTime, requestId, payload }) {
  const USE_AWS  = process.env.USE_AWS === 'true';
  const subType  = payload?.data?.attributes?.sub_type;
  const subLabel = subType ? ` (detection type: ${subType})` : '';

  const newIncident = {
    id:    uuidv4(),
    title: 'Motion Detected — Ring Device',
    description:
      `[RING DEVICE EVENT] Motion detected by a linked Ring device${subLabel}. ` +
      `This is a predefined safety-related event flagged for human verification. ` +
      `It does NOT automatically indicate a crime has occurred. ` +
      `No automatic action has been taken. Awaiting human review.`,
    severity:  'HIGH',
    status:    'OPEN',
    location: {
      lat:   null,
      lng:   null,
      label: `Ring Device: ${deviceId || 'Unknown'} — location requires device API lookup`,
    },
    evidenceUrl:    null,
    cameraId:       deviceId || 'RING-UNKNOWN',
    createdAt:      eventTime,
    updatedAt:      new Date().toISOString(),
    verifiedBy:     null,
    simulatedInput: false,
    source:         'ring',
    ringAccountId:  accountId,
    ringRequestId:  requestId,
  };

  if (USE_AWS) {
    // TODO: When USE_AWS=true, save to DynamoDB and publish SNS alert.
    // Same pattern as incidents.js. Deferred to the AWS integration step.
    console.log(`[Ring] USE_AWS=true — TODO: persist incident ${newIncident.id} to DynamoDB + SNS`);
  }

  mockStore.addIncident(newIncident);
  console.log(
    `[Ring] Incident created — id: ${newIncident.id} | device: ${deviceId} | subType: ${subType || 'unspecified'}`,
  );
}

module.exports = { router, ringWebhookHandler };
