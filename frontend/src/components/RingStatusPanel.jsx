/**
 * RingStatusPanel — Ring API integration status display
 *
 * Fetches live status from GET /ring/status on the backend.
 * Shows real configuration state and linked account data.
 *
 * IMPORTANT: This panel only displays real data from the backend.
 * It never fabricates Ring connection state.
 * It clearly distinguishes Ring API status from local simulation.
 */

import React, { useState, useEffect, useCallback } from 'react';

const BACKEND = 'https://sentinelgrid-2l30.onrender.com';
const POLL_INTERVAL_MS = 30_000; // poll every 30s — Ring status doesn't change frequently

export default function RingStatusPanel() {
  const [status, setStatus]     = useState(null);   // null = loading
  const [error, setError]       = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND}/ring/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data.ring);
      setError(null);
      setLastFetched(new Date().toISOString());
    } catch (err) {
      setError('Ring API status unavailable');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // ── Derived values ────────────────────────────────────────────────────────
  const isConfigured    = status?.integrationReady === true;
  const linkedCount     = status?.linkedAccountCount ?? 0;
  const unclaimedCount  = status?.unclaimedTokenCount ?? 0;
  const accounts        = status?.accounts ?? [];

  return (
    <div className="bg-sg-panel border border-sg-border rounded-lg overflow-hidden">

      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-sg-border bg-blue-950/40">
        <div className="flex items-center gap-2">
          {/* Ring logo-like indicator */}
          <span className="text-sm">💍</span>
          <h2 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            Ring API Integration
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {status === null && !error && (
            <span className="text-xs text-gray-500 animate-pulse">checking...</span>
          )}
          {error && (
            <span className="text-xs text-red-400 font-mono">⚠ unavailable</span>
          )}
          {status !== null && !error && (
            <span className={`text-xs font-mono px-2 py-0.5 rounded border ${
              isConfigured
                ? 'bg-blue-950 text-blue-300 border-blue-700'
                : 'bg-gray-800 text-gray-400 border-gray-600'
            }`}>
              {isConfigured ? 'API CONFIGURED' : 'NOT CONFIGURED'}
            </span>
          )}
          <button
            onClick={fetchStatus}
            title="Refresh Ring status"
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 flex flex-col gap-2">

        {/* Error state */}
        {error && (
          <p className="text-xs text-red-400">
            ⚠ Ring API status unavailable — check backend connectivity.
          </p>
        )}

        {/* Config variables */}
        {status !== null && !error && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {/* Linked accounts */}
              <div className="bg-sg-dark rounded px-3 py-2">
                <span className="text-xs text-gray-500 block mb-0.5">Linked Accounts</span>
                <span className={`text-lg font-bold ${linkedCount > 0 ? 'text-green-400' : 'text-gray-400'}`}>
                  {linkedCount}
                </span>
              </div>

              {/* Unclaimed tokens */}
              <div className="bg-sg-dark rounded px-3 py-2">
                <span className="text-xs text-gray-500 block mb-0.5">Pending Links</span>
                <span className={`text-lg font-bold ${unclaimedCount > 0 ? 'text-yellow-400' : 'text-gray-400'}`}>
                  {unclaimedCount}
                </span>
              </div>
            </div>

            {/* Link status message */}
            {linkedCount === 0 && unclaimedCount === 0 && (
              <div className="text-xs text-gray-500 bg-sg-dark rounded px-3 py-2">
                Ring account is not currently linked to SentinelGrid.
                Ring API integration is configured and ready for a linked account.
              </div>
            )}

            {/* Linked account summary — safe info only, no tokens */}
            {accounts.length > 0 && (
              <div className="flex flex-col gap-1">
                {accounts.map((acc) => (
                  <div key={acc.accountId} className="bg-sg-dark rounded px-3 py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 font-mono truncate max-w-36" title={acc.accountId}>
                        {acc.accountId}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-mono border ${
                        acc.linkStatus === 'CLAIMED'
                          ? 'bg-green-950 text-green-400 border-green-800'
                          : 'bg-yellow-950 text-yellow-400 border-yellow-800'
                      }`}>
                        {acc.linkStatus}
                      </span>
                    </div>
                    <div className="text-gray-600 mt-0.5">
                      Token valid: {acc.accessTokenValid ? '✅' : '⚠ expired'} ·
                      Expires: {acc.expiresAt ? new Date(acc.expiresAt).toLocaleTimeString() : '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Config variables grid */}
            <details className="text-xs">
              <summary className="text-gray-500 cursor-pointer hover:text-gray-300 transition-colors select-none">
                Config variables ▾
              </summary>
              <div className="mt-1 grid grid-cols-2 gap-1">
                {status.configuredVariables && Object.entries(status.configuredVariables).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-1.5 text-xs">
                    <span className={val ? 'text-green-400' : 'text-red-400'}>{val ? '✓' : '✗'}</span>
                    <span className="text-gray-500 font-mono truncate">{key}</span>
                  </div>
                ))}
              </div>
            </details>
          </>
        )}

        {/* Footer — source distinction */}
        <div className="border-t border-sg-border pt-2 flex items-center justify-between">
          <span className="text-xs text-gray-600">
            {lastFetched ? `Updated ${new Date(lastFetched).toLocaleTimeString()}` : ''}
          </span>
          <div className="flex gap-2 text-xs">
            <span className="bg-blue-950 text-blue-400 border border-blue-800 px-1.5 py-0.5 rounded font-mono">
              RING API
            </span>
            <span className="bg-gray-800 text-gray-400 border border-gray-700 px-1.5 py-0.5 rounded font-mono">
              ≠ LOCAL SIM
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
