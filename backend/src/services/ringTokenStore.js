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
 * Token shape (per Ring account_id):
 * {
 *   accountId:    string   — Ring Account ID (ava1.ring.account.XXXYYY)
 *   accessToken:  string   — Bearer token for Amazon Vision API calls (~4h lifetime)
 *   refreshToken: string   — Used to obtain new access tokens (~30d lifetime)
 *   expiresAt:    number   — Unix ms timestamp when access token expires
 *   linkedAt:     string   — ISO timestamp when account was linked
 * }
 */

// Map<accountId, tokenRecord>
const tokenStore = new Map();

/**
 * Save or overwrite tokens for a Ring account.
 * @param {string} accountId
 * @param {string} accessToken
 * @param {string} refreshToken
 * @param {number} expiresIn  — lifetime in seconds, from Ring token response
 */
function saveTokens(accountId, accessToken, refreshToken, expiresIn) {
  const record = {
    accountId,
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    linkedAt: new Date().toISOString(),
  };
  tokenStore.set(accountId, record);
  console.log(`[Ring] Tokens saved for account: ${accountId}`);
  return record;
}

/**
 * Retrieve tokens for a Ring account.
 * Returns null if not found.
 * @param {string} accountId
 */
function getTokens(accountId) {
  return tokenStore.get(accountId) || null;
}

/**
 * Returns true if the access token for the given account is still valid.
 * Adds a 60-second buffer so callers have time to use the token.
 * @param {string} accountId
 */
function isAccessTokenValid(accountId) {
  const record = tokenStore.get(accountId);
  if (!record) return false;
  return record.expiresAt > Date.now() + 60_000;
}

/**
 * Remove all tokens for a Ring account (e.g. on unlink).
 * @param {string} accountId
 */
function removeTokens(accountId) {
  tokenStore.delete(accountId);
  console.log(`[Ring] Tokens removed for account: ${accountId}`);
}

/**
 * Returns a SAFE summary of linked accounts for the /ring/status endpoint.
 * Never includes access tokens, refresh tokens, or secrets.
 */
function getStatusSummary() {
  const accounts = [];
  for (const record of tokenStore.values()) {
    accounts.push({
      accountId: record.accountId,
      linkedAt: record.linkedAt,
      accessTokenValid: record.expiresAt > Date.now() + 60_000,
      expiresAt: new Date(record.expiresAt).toISOString(),
    });
  }
  return {
    linkedAccountCount: accounts.length,
    accounts,
  };
}

module.exports = { saveTokens, getTokens, isAccessTokenValid, removeTokens, getStatusSummary };
