/**
 * SentinelGrid — Ring Token Store (server-side, in-memory)
 *
 * Stores OAuth tokens issued by Ring's authorization server securely
 * on the backend only. Tokens are NEVER returned to the frontend or
 * included in any API response.
 *
 * In production this would be replaced by an encrypted database store
 * (e.g. DynamoDB with at-rest encryption). For the hackathon prototype
 * the in-memory store is sufficient and avoids any credential leakage.
 *
 * Token lifecycle in the one-way (Ring-driven) account linking flow:
 *
 *   1. UNCLAIMED — Ring has POSTed an auth code to our Token Exchange URL.
 *                  We exchanged it for tokens and fetched the Account ID.
 *                  The tokens are stored but not yet associated with any
 *                  partner user. Waiting for the user to arrive at the
 *                  Account Link URL and complete nonce matching.
 *
 *   2. CLAIMED   — Nonce matched successfully. The token has been associated
 *                  with a partner user via the App-Integrations API POST.
 *                  The PATCH to status:"completed" has been sent to Ring.
 *                  Fully active — webhook events will now be delivered.
 *
 * Token record shape:
 * {
 *   accountId:        string  — Ring Account ID (ava1.ring.account.XXXYYY)
 *   accessToken:      string  — Bearer token for Amazon Vision API (~4h)
 *   refreshToken:     string  — Obtain new access tokens (~30d)
 *   expiresAt:        number  — Unix ms when access token expires
 *   receivedAt:       string  — ISO timestamp when token was first stored
 *   linkedAt:         string  — ISO timestamp when token was claimed (null if unclaimed)
 *   linkStatus:       string  — 'UNCLAIMED' | 'CLAIMED'
 *   accountIdentifier: string — Partner-side obfuscated user identifier (null if unclaimed)
 * }
 */

'use strict';

// Map<accountId, tokenRecord>
const tokenStore = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// saveUnclaimedTokens
//
// Called by POST /ring/token-exchange immediately after receiving tokens from
// Ring's OAuth server. Marks the record as UNCLAIMED until nonce matching
// completes at the Account Link URL.
//
// @param {string} accountId
// @param {string} accessToken
// @param {string} refreshToken
// @param {number} expiresIn  — seconds, from Ring token response
// ─────────────────────────────────────────────────────────────────────────────
function saveUnclaimedTokens(accountId, accessToken, refreshToken, expiresIn) {
  const record = {
    accountId,
    accessToken,
    refreshToken,
    expiresAt:         Date.now() + expiresIn * 1000,
    receivedAt:        new Date().toISOString(),
    linkedAt:          null,
    linkStatus:        'UNCLAIMED',
    accountIdentifier: null,
  };
  tokenStore.set(accountId, record);
  console.log(`[Ring] Tokens stored (UNCLAIMED) for account: ${accountId}`);
  return record;
}

// ─────────────────────────────────────────────────────────────────────────────
// saveTokens (kept for backward compatibility with Partner-Initiated flow)
//
// Saves tokens directly as CLAIMED. Used by GET /ring/callback in the
// Partner-Initiated OAuth 2.0 flow (invitation-only).
// ─────────────────────────────────────────────────────────────────────────────
function saveTokens(accountId, accessToken, refreshToken, expiresIn) {
  const record = {
    accountId,
    accessToken,
    refreshToken,
    expiresAt:         Date.now() + expiresIn * 1000,
    receivedAt:        new Date().toISOString(),
    linkedAt:          new Date().toISOString(),
    linkStatus:        'CLAIMED',
    accountIdentifier: null,
  };
  tokenStore.set(accountId, record);
  console.log(`[Ring] Tokens saved (CLAIMED) for account: ${accountId}`);
  return record;
}

// ─────────────────────────────────────────────────────────────────────────────
// getUnclaimedTokens
//
// Returns all token records with linkStatus === 'UNCLAIMED'.
// Used during nonce matching at the Account Link URL: we iterate through
// unclaimed tokens, recompute the nonce for each Account ID, and find
// the one whose computed nonce matches the received nonce.
//
// Per Ring docs: the unclaimed pool should remain small in practice —
// tokens are expected to be claimed within minutes.
// ─────────────────────────────────────────────────────────────────────────────
function getUnclaimedTokens() {
  const unclaimed = [];
  for (const record of tokenStore.values()) {
    if (record.linkStatus === 'UNCLAIMED') {
      unclaimed.push(record);
    }
  }
  return unclaimed;
}

// ─────────────────────────────────────────────────────────────────────────────
// claimToken
//
// Transitions a token record from UNCLAIMED → CLAIMED after successful
// nonce matching and App-Integrations API confirmation.
//
// @param {string} accountId
// @param {string} accountIdentifier — obfuscated partner-side user identifier
// ─────────────────────────────────────────────────────────────────────────────
function claimToken(accountId, accountIdentifier) {
  const record = tokenStore.get(accountId);
  if (!record) return null;
  record.linkStatus        = 'CLAIMED';
  record.linkedAt          = new Date().toISOString();
  record.accountIdentifier = accountIdentifier;
  tokenStore.set(accountId, record);
  console.log(`[Ring] Token CLAIMED for account: ${accountId}`);
  return record;
}

// ─────────────────────────────────────────────────────────────────────────────
// getTokens
//
// Returns the full token record for a given accountId, or null.
// ─────────────────────────────────────────────────────────────────────────────
function getTokens(accountId) {
  return tokenStore.get(accountId) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// isAccessTokenValid
//
// Returns true if the access token exists and has not expired.
// Includes a 60-second buffer so callers have time to use the token.
// ─────────────────────────────────────────────────────────────────────────────
function isAccessTokenValid(accountId) {
  const record = tokenStore.get(accountId);
  if (!record) return false;
  return record.expiresAt > Date.now() + 60_000;
}

// ─────────────────────────────────────────────────────────────────────────────
// removeTokens
//
// Deletes all tokens for a Ring account (e.g. on app_integration_removed).
// ─────────────────────────────────────────────────────────────────────────────
function removeTokens(accountId) {
  tokenStore.delete(accountId);
  console.log(`[Ring] Tokens removed for account: ${accountId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// getStatusSummary
//
// Returns a SAFE summary for the GET /ring/status endpoint.
// NEVER includes access tokens, refresh tokens, or any secret values.
// ─────────────────────────────────────────────────────────────────────────────
function getStatusSummary() {
  const accounts = [];
  for (const record of tokenStore.values()) {
    accounts.push({
      accountId:         record.accountId,
      linkStatus:        record.linkStatus,
      receivedAt:        record.receivedAt,
      linkedAt:          record.linkedAt,
      accessTokenValid:  record.expiresAt > Date.now() + 60_000,
      expiresAt:         new Date(record.expiresAt).toISOString(),
      // accountIdentifier is obfuscated already (e.g. "u***r@example.com")
      // but we omit it here to keep /ring/status fully non-sensitive
    });
  }
  return {
    linkedAccountCount:   accounts.filter(a => a.linkStatus === 'CLAIMED').length,
    unclaimedTokenCount:  accounts.filter(a => a.linkStatus === 'UNCLAIMED').length,
    accounts,
  };
}

module.exports = {
  saveUnclaimedTokens,
  saveTokens,
  getUnclaimedTokens,
  claimToken,
  getTokens,
  isAccessTokenValid,
  removeTokens,
  getStatusSummary,
};
