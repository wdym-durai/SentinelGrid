/**
 * SentinelGrid — Ring Developer API Routes
 *
 * Implements the Partner-Initiated OAuth 2.0 account linking flow.
 * Does NOT implement the one-way / Ring-driven (HMAC nonce) flow.
 *
 * Official Ring Developer API documentation used as source of truth:
 *   https://developer.amazon.com/docs/ring/api-documentation.html
 *
 * Security rules enforced throughout:
 *   - All Ring credentials read from environment variables only
 *   - Access tokens, refresh tokens, client secrets never returned in responses
 *   - All Ring OAuth calls are server-to-server (Ring CORS blocks browser calls)
 *   - HMAC webhook signatures verified before any payload is processed
 *   - Webhook idempotency via meta.request_id prevents duplicate incidents
 *
 * Endpoints in this module:
 *   GET  /ring/status         — safe config/status only, no secrets
 *   GET  /ring/account-link   — start Partner-Initiated OAuth 2.0 (PKCE S256)
 *   GET  /ring/callback       — receive Ring redirect, validate state, exchange code
 *   POST /ring/webhook        — handler exported separately for express.raw() wiring
 *
 * Ring OAuth endpoints confirmed from official docs:
 *   Authorization : https://account.ring.com/account/integrations/partner-link/authorize
 *   Token exchange: https://oauth.ring.com/oauth/token
 *   Vision API    : https://api.amazonvision.com
 *   Webhook header: X-Signature: sha256=<hmac_hex>
 */

'use strict';

const express = require('express');
const crypto  = require('crypto');  // built-in Node.js — no extra package needed
const { v4: uuidv4 } = require('uuid');

const router     = express.Router();
const tokenStore = require('../services/ringTokenStore');
const mockStore  = require('../data/mockStore');

// ── Ring credentials — from environment variables only, never hardcoded ──────
const RING_CLIENT_ID          = process.env.RING_CLIENT_ID;
const RING_CLIENT_SECRET      = process.env.RING_CLIENT_SECRET;
const RING_HMAC_SIGNATURE_KEY = process.env.RING_HMAC_SIGNATURE_KEY;
const RING_REDIRECT_URI       = process.env.RING_REDIRECT_URI;
const RING_API_BASE_URL       = process.env.RING_API_BASE_URL
                                  || 'https://api.amazonvision.com';

// Ring OAuth server URLs — confirmed from official docs
const RING_AUTHORIZE_URL = 'https://account.ring.com/account/integrations/partner-link/authorize';
const RING_TOKEN_URL     = 'https://oauth.ring.com/oauth/token';

// ── PKCE session store ────────────────────────────────────────────────────────
// Maps state token → { codeVerifier, createdAt }
// TTL: 10 minutes. Ring's authorization codes expire within 10 minutes too.
// In production replace with a short-TTL encrypted session store (e.g. Redis).
const pkceSessionStore = new Map();
const PKCE_TTL_MS = 10 * 60 * 1000;

function cleanExpiredPkceSessions() {
  const cutoff = Date.now() - PKCE_TTL_MS;
  for (const [state, session] of pkceSessionStore.entries()) {
    if (session.createdAt < cutoff) pkceSessionStore.delete(state);
  }
}

// ── Webhook idempotency store ─────────────────────────────────────────────────
// Tracks processed meta.request_id values so Ring webhook retries cannot
// create duplicate incidents. Bounded at 1000 entries to limit memory use.
const processedWebhookIds = new Set();
const MAX_PROCESSED_IDS = 1000;

function markWebhookProcessed(requestId) {
  if (processedWebhookIds.size >= MAX_PROCESSED_IDS) {
    // Remove the oldest entry — Sets preserve insertion order
    processedWebhookIds.delete(processedWebhookIds.values().next().value);
  }
  processedWebhookIds.add(requestId);
}

// ── Config check helper ───────────────────────────────────────────────────────
function getMissingVarNames(varMap) {
  return Object.entries(varMap)
    .filter(([, v]) => !v)
    .map(([k]) => k);
}

// ── HTML escape — used only in callback HTML responses, never for JSON ────────
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
// Shows which env vars are present (boolean only — not their values)
// and a safe summary of linked accounts (no tokens, no secrets).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const varPresence = {
    RING_CLIENT_ID:          !!RING_CLIENT_ID,
    RING_CLIENT_SECRET:      !!RING_CLIENT_SECRET,
    RING_HMAC_SIGNATURE_KEY: !!RING_HMAC_SIGNATURE_KEY,
    RING_REDIRECT_URI:       !!RING_REDIRECT_URI,
    RING_API_BASE_URL:       !!RING_API_BASE_URL,
  };
  const allConfigured = Object.values(varPresence).every(Boolean);

  res.json({
    success: true,
    ring: {
      integrationReady:    allConfigured,
      configuredVariables: varPresence,       // booleans only — no values exposed
      ...tokenStore.getStatusSummary(),       // account count + safe per-account info
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /ring/account-link
//
// Entry point for Partner-Initiated OAuth 2.0.
// Generates a PKCE pair (code_verifier + code_challenge S256) and a CSRF
// state token, stores them, then redirects the user's browser to Ring's
// authorization page.
//
// After the user authenticates and approves device access, Ring redirects
// to RING_REDIRECT_URI (GET /ring/callback).
//
// Authorization URL parameters — confirmed from official Ring docs:
//   client_id, redirect_uri, response_type=code, scope=ava.v1:read,
//   state, code_challenge, code_challenge_method=S256
// ─────────────────────────────────────────────────────────────────────────────
router.get('/account-link', (req, res) => {
  const missing = getMissingVarNames({ RING_CLIENT_ID, RING_REDIRECT_URI });
  if (missing.length) {
    return res.status(503).json({
      success: false,
      error:   'Ring integration not fully configured.',
      missing,
      hint:    'Set the missing variables in your .env file.',
    });
  }

  // PKCE code_verifier: cryptographically random, URL-safe base64, 43–128 chars
  const codeVerifier = crypto.randomBytes(32).toString('base64url');

  // code_challenge = Base64URL( SHA-256( code_verifier ) )  — method S256
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier, 'ascii')
    .digest('base64url');

  // CSRF state: opaque random string stored server-side for callback validation
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

  const authUrl = `${RING_AUTHORIZE_URL}?${params.toString()}`;
  console.log(`[Ring] Starting account-link — state: ${state}`);
  res.redirect(authUrl);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /ring/callback
//
// RING_REDIRECT_URI must point to this endpoint exactly as registered in the
// Ring Developer Portal.
//
// Ring redirects here after the user approves access:
//   Success: GET /ring/callback?code=<auth_code>&state=<state>
//   Error:   GET /ring/callback?error=<code>&error_description=<desc>&state=<state>
//
// Steps performed:
//   1. Detect and handle Ring-side errors
//   2. Validate state against PKCE session (CSRF protection)
//   3. Consume PKCE session (one-time use)
//   4. POST to https://oauth.ring.com/oauth/token — server-to-server
//      Parameters: grant_type, code, code_verifier, client_id, client_secret
//      NOTE: redirect_uri is NOT included — not listed in Ring's documented
//            token exchange parameters (confirmed from official docs, Step 4)
//   5. GET /v1/users/me to retrieve Ring Account ID (data.id)
//   6. Store tokens server-side via ringTokenStore — never returned to caller
//   7. PATCH /v1/accounts/me/app-integrations with status:"completed"
//      Required to activate device consents and enable webhook delivery
//      Per docs: "The integration is not fully active until you call this
//      endpoint with status: 'completed'."
//   8. Return a safe HTML confirmation page — no tokens anywhere in response
// ─────────────────────────────────────────────────────────────────────────────
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // ── Step 1: Handle Ring-side errors ────────────────────────────────────────
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

  // ── Validate required parameters ───────────────────────────────────────────
  if (!code || !state) {
    console.warn('[Ring] Callback missing code or state');
    return res.status(400).send(
      '<html><body><h2>Invalid callback — missing required parameters.</h2></body></html>',
    );
  }

  // ── Step 2–3: Validate and consume PKCE session ────────────────────────────
  cleanExpiredPkceSessions();
  const pkceSession = pkceSessionStore.get(state);
  if (!pkceSession) {
    console.warn('[Ring] Callback rejected — state not found or expired');
    return res.status(400).send(`
      <html><body>
        <h2>Session expired or invalid state.</h2>
        <p>Please <a href="/ring/account-link">restart account linking</a>.</p>
      </body></html>`);
  }
  // Consume immediately — each state/code pair is one-time use
  pkceSessionStore.delete(state);
  const { codeVerifier } = pkceSession;

  // ── Check required credentials are present ─────────────────────────────────
  const missing = getMissingVarNames({ RING_CLIENT_ID, RING_CLIENT_SECRET });
  if (missing.length) {
    console.error('[Ring] Cannot exchange token — missing env vars:', missing);
    return res.status(503).send(
      `<html><body><h2>Server configuration error. Missing: ${missing.join(', ')}</h2></body></html>`,
    );
  }

  // ── Step 4: Exchange authorization code for tokens (server-to-server) ──────
  // Ring's CORS policy blocks browser-initiated calls to oauth.ring.com.
  // This MUST be a backend call. Node 24 has built-in fetch.
  //
  // CORRECTION: redirect_uri is NOT included in the request body.
  // Ring's documented token exchange parameters (Step 4) list exactly:
  //   grant_type, code, code_verifier, client_id, client_secret
  // Source: https://developer.amazon.com/docs/ring/api-documentation.html
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
      console.error(`[Ring] Token exchange failed (${tokenRes.status}): ${errText}`);
      return res.status(502).send(
        `<html><body><h2>Token exchange with Ring failed (${tokenRes.status}).</h2></body></html>`,
      );
    }

    tokens = await tokenRes.json();
  } catch (networkErr) {
    console.error('[Ring] Network error during token exchange:', networkErr.message);
    return res.status(502).send(
      '<html><body><h2>Could not reach Ring token endpoint. Check network connectivity.</h2></body></html>',
    );
  }

  // ── Step 5: Retrieve Ring Account ID via GET /v1/users/me ──────────────────
  // The Account ID (data.id) is required to key the token store and
  // correlate incoming webhook events (meta.account_id field).
  // Response structure confirmed: { "data": { "id": "ava1.ring.account.XXXYYY", ... } }
  let accountId = 'unknown';
  try {
    const profileRes = await fetch(`${RING_API_BASE_URL}/v1/users/me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      accountId = profile?.data?.id || 'unknown';
    } else {
      console.warn(`[Ring] /v1/users/me returned ${profileRes.status} — using 'unknown' account ID`);
    }
  } catch (profileErr) {
    console.warn('[Ring] Could not fetch user profile:', profileErr.message);
  }

  // ── Step 6: Store tokens server-side only ──────────────────────────────────
  // Access tokens and refresh tokens are NEVER returned to any caller.
  tokenStore.saveTokens(
    accountId,
    tokens.access_token,
    tokens.refresh_token,
    tokens.expires_in || 14400,  // Ring docs: ~4 hour access token lifetime
  );

  // ── Step 7: PATCH /v1/accounts/me/app-integrations — required ──────────────
  // This finalizes the account link and activates device-level consents.
  // Per Ring docs Step 5: without this PATCH, webhook notifications are
  // not delivered and device API access remains inactive.
  //
  // account_identifier: an obfuscated identifier for the partner-side user.
  // In a real system this would be a masked email of the logged-in partner user.
  // For this prototype we use a clearly-labeled placeholder value.
  // This does NOT represent a real user identity system.
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
          // NOTE: In production, account_identifier should be a masked email
          // of the authenticated partner user, e.g. "u***r@example.com".
          // This prototype uses a static placeholder for demonstration only.
        }),
      },
    );

    if (patchRes.ok) {
      console.log(`[Ring] Integration confirmed (completed) for account: ${accountId}`);
    } else {
      const patchErr = await patchRes.text();
      // Log but do not fail — tokens are stored; operator can retry linking
      console.warn(`[Ring] Integration PATCH returned ${patchRes.status}: ${patchErr}`);
    }
  } catch (patchNetworkErr) {
    console.warn('[Ring] Could not reach app-integrations endpoint:', patchNetworkErr.message);
  }

  console.log(`[Ring] Account linked — accountId: ${accountId}`);

  // ── Step 8: Return safe confirmation — no tokens in response ───────────────
  res.send(`
    <html>
      <head><title>SentinelGrid — Ring Linked</title></head>
      <body style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:20px">
        <h2>✅ Ring Account Linked</h2>
        <p>Your Ring account has been successfully connected to SentinelGrid.</p>
        <p><strong>Account ID:</strong> ${escapeHtml(accountId)}</p>
        <hr>
        <p style="font-size:0.8em;color:#666">
          PROTOTYPE: account_identifier is a static placeholder. In production
          this would reflect the authenticated partner user identity.
        </p>
        <p><a href="/">Open SentinelGrid Dashboard</a></p>
      </body>
    </html>`);
});

// ─────────────────────────────────────────────────────────────────────────────
// ringWebhookHandler — exported separately for express.raw() wiring in index.js
//
// This function is NOT registered on the router. It is mounted in index.js
// BEFORE the global express.json() call so the raw body Buffer is available
// for HMAC-SHA256 signature verification.
//
// POST /ring/webhook
//
// Signature verification — confirmed from official Ring Notifications docs:
//   Header    : X-Signature: sha256=<hex_digest>
//   Algorithm : HMAC-SHA256(RING_HMAC_SIGNATURE_KEY, raw_body_bytes).hexdigest()
//   Comparison: crypto.timingSafeEqual — constant-time, prevents timing attacks
//
// Idempotency:
//   meta.request_id is checked against processedWebhookIds before any
//   processing. Ring retries receive HTTP 200 but produce no side effects.
//
// Webhook payload v1.1 structure — confirmed from official Ring docs:
//   meta: { version, time, request_id, account_id }
//   data: { id, type, attributes: { source, source_type, timestamp, sub_type? } }
// ─────────────────────────────────────────────────────────────────────────────
function ringWebhookHandler(req, res) {
  // ── Guard: HMAC key must be configured ────────────────────────────────────
  if (!RING_HMAC_SIGNATURE_KEY) {
    console.error('[Ring] RING_HMAC_SIGNATURE_KEY not set — webhook handler not operational');
    // Respond 200 to avoid Ring treating the endpoint as permanently failed
    return res.status(200).json({ received: false, reason: 'not_configured' });
  }

  // ── Verify X-Signature header present ────────────────────────────────────
  const sigHeader = req.headers['x-signature'];
  if (!sigHeader) {
    console.warn('[Ring] Webhook rejected — missing X-Signature header');
    return res.status(401).json({ success: false, error: 'Missing X-Signature header' });
  }

  // ── Verify raw body is a Buffer (set by express.raw()) ────────────────────
  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    console.warn('[Ring] Webhook rejected — body is not a raw Buffer');
    return res.status(400).json({ success: false, error: 'Invalid request body' });
  }

  // ── Compute expected HMAC-SHA256 signature ────────────────────────────────
  const expectedHex = crypto
    .createHmac('sha256', RING_HMAC_SIGNATURE_KEY)
    .update(rawBody)
    .digest('hex');

  // Strip "sha256=" prefix from Ring's header value
  const receivedHex = sigHeader.startsWith('sha256=')
    ? sigHeader.slice(7)
    : sigHeader;

  // Constant-time comparison — prevents timing-based oracle attacks
  let signatureValid = false;
  try {
    signatureValid = crypto.timingSafeEqual(
      Buffer.from(expectedHex, 'hex'),
      Buffer.from(receivedHex,  'hex'),
    );
  } catch {
    // timingSafeEqual throws if buffer lengths differ — treat as invalid
    signatureValid = false;
  }

  if (!signatureValid) {
    console.warn('[Ring] Webhook rejected — HMAC signature mismatch');
    return res.status(401).json({ success: false, error: 'Invalid webhook signature' });
  }

  // ── Parse verified payload ────────────────────────────────────────────────
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

  // ── Idempotency: deduplicate Ring retries by request_id ───────────────────
  if (requestId && processedWebhookIds.has(requestId)) {
    console.log(`[Ring] Duplicate webhook — requestId ${requestId} already processed`);
    return res.status(200).json({ success: true, duplicate: true });
  }

  // ── Respond HTTP 200 immediately ─────────────────────────────────────────
  // Ring requires a response within 5 seconds. We respond first, then process.
  res.status(200).json({ success: true, received: true });

  // Mark as processed — before handling so concurrent retries are also blocked
  if (requestId) markWebhookProcessed(requestId);

  console.log(`[Ring] Webhook — type: ${eventType} | account: ${accountId} | requestId: ${requestId}`);

  // ── Route to event handler ────────────────────────────────────────────────
  if (eventType === 'motion_detected') {
    handleMotionEvent({ accountId, deviceId, eventTime, requestId, payload });
  } else {
    // All other event types are logged but do not generate incidents.
    // Includes: button_press, device_added, device_removed,
    //           device_online, device_offline, app_integration_added/removed
    console.log(`[Ring] Event type "${eventType}" received — no incident created`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// handleMotionEvent
//
// Creates a SentinelGrid incident from a verified Ring motion_detected event.
//
// A Ring motion_detected webhook is a predefined safety-related trigger.
// It does NOT automatically indicate a crime has occurred.
// The incident is set to OPEN and requires human operator verification.
//
// simulatedInput is false — this is a real device event, not simulated.
// source is 'ring' — distinguishes from EventSimulator-triggered incidents.
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
      // Ring webhooks do not include GPS coordinates.
      // Device location requires a separate GET /v1/devices/{id}/location call.
      label: `Ring Device: ${deviceId || 'Unknown'} — location requires device API lookup`,
    },
    evidenceUrl:    null,      // Evidence requires GET /v1/devices/{id}/media/...
    cameraId:       deviceId || 'RING-UNKNOWN',
    createdAt:      eventTime,
    updatedAt:      new Date().toISOString(),
    verifiedBy:     null,
    simulatedInput: false,     // Real Ring device event — not simulated
    source:         'ring',    // Distinguishes from EventSimulator incidents
    ringAccountId:  accountId,
    ringRequestId:  requestId,
  };

  if (USE_AWS) {
    // TODO: When USE_AWS=true, save to DynamoDB and publish SNS alert.
    // Follow the same pattern as incidents.js — import dynamoService and snsService.
    // Deferred to the AWS integration step.
    console.log(`[Ring] USE_AWS=true — TODO: persist incident ${newIncident.id} to DynamoDB + SNS`);
    mockStore.addIncident(newIncident);
  } else {
    mockStore.addIncident(newIncident);
  }

  console.log(
    `[Ring] Incident created — id: ${newIncident.id} | device: ${deviceId} | subType: ${subType || 'unspecified'}`,
  );
}

// Export the router (GET /ring/status, /ring/account-link, /ring/callback)
// and the webhook handler separately (mounted in index.js with express.raw())
module.exports = { router, ringWebhookHandler };
