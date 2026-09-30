/**
 * IncidentDetail — the right panel showing full details of a selected incident.
 *
 * Includes:
 *   - Severity + status badges
 *   - Full description
 *   - Map with location pin (MapView)
 *   - Evidence image placeholder
 *   - Human verification buttons: Verify / Dismiss
 */

import React, { useState } from 'react';
import MapView from './MapView';

const SEVERITY_STYLES = {
  HIGH:   'bg-red-900 text-red-300 border-red-700',
  MEDIUM: 'bg-yellow-900 text-yellow-300 border-yellow-700',
  LOW:    'bg-green-900 text-green-300 border-green-700',
};

function formatDateTime(isoString) {
  return new Date(isoString).toLocaleString();
}

export default function IncidentDetail({ incident, onIncidentUpdated }) {
  const [verifying, setVerifying] = useState(false);
  const [actionError, setActionError] = useState(null);

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!incident) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm text-center py-20">
        <span className="text-5xl mb-4">🔍</span>
        <p className="text-base">Select an incident from the feed</p>
        <p className="text-xs mt-1 text-gray-600">
          Full details, map, evidence, and verification controls will appear here.
        </p>
      </div>
    );
  }

  // ── Verify / Dismiss handler ───────────────────────────────────────────────
  const handleVerify = async (action) => {
    setVerifying(true);
    setActionError(null);
    try {
      const response = await fetch(`https://sentinelgrid-2l30.onrender.com/incidents/${incident.id}/verify`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, operatorName: 'Operator 1' }),
      });
      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const data = await response.json();
      onIncidentUpdated(data.incident);
    } catch (err) {
      console.error('Verification failed:', err);
      setActionError('Failed to update incident. Is the backend running?');
    } finally {
      setVerifying(false);
    }
  };

  const isOpen      = incident.status === 'OPEN';
  const severityClass = SEVERITY_STYLES[incident.severity] || SEVERITY_STYLES.LOW;

  return (
    <div className="bg-sg-panel border border-sg-border rounded-lg p-5 flex flex-col gap-5">

      {/* ── Title row ── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white leading-tight">{incident.title}</h2>
          <p className="text-xs text-gray-500 mt-0.5 font-mono">ID: {incident.id}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className={`text-xs px-2 py-1 rounded border font-mono ${severityClass}`}>
            {incident.severity}
          </span>
          <span className={`text-xs px-2 py-1 rounded font-semibold ${
            incident.status === 'OPEN'      ? 'bg-red-950 text-red-400' :
            incident.status === 'VERIFIED'  ? 'bg-green-950 text-green-400' :
                                              'bg-gray-800 text-gray-400'
          }`}>
            {incident.status}
          </span>
        </div>
      </div>

      {/* ── Simulated input notice ── */}
      {incident.simulatedInput && (
        <div className="text-xs bg-yellow-950 border border-yellow-800 text-yellow-400 rounded px-3 py-2 font-mono">
          🟡 SIMULATED / PROTOTYPE FUNCTIONALITY — Camera input is simulated.
          AI classification is simulated. This event requires human verification.
        </div>
      )}

      {/* ── Description ── */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-1">Event Description</h3>
        <p className="text-sm text-gray-300 leading-relaxed">{incident.description}</p>
      </div>

      {/* ── Metadata grid ── */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-sg-dark rounded px-3 py-2">
          <span className="text-xs text-gray-500 block mb-0.5">Camera ID</span>
          <span className="text-gray-200 font-mono">{incident.cameraId || '—'}</span>
        </div>
        <div className="bg-sg-dark rounded px-3 py-2">
          <span className="text-xs text-gray-500 block mb-0.5">Created</span>
          <span className="text-gray-200">{formatDateTime(incident.createdAt)}</span>
        </div>
        <div className="bg-sg-dark rounded px-3 py-2 col-span-2">
          <span className="text-xs text-gray-500 block mb-0.5">Location</span>
          <span className="text-gray-200">
            📍 {incident.location?.label || 'Unknown'} &nbsp;
            <span className="text-gray-500 font-mono text-xs">
              ({incident.location?.lat?.toFixed(5)}, {incident.location?.lng?.toFixed(5)})
            </span>
          </span>
        </div>
        {incident.verifiedBy && (
          <div className="bg-sg-dark rounded px-3 py-2 col-span-2">
            <span className="text-xs text-gray-500 block mb-0.5">Reviewed by</span>
            <span className="text-gray-200">{incident.verifiedBy}</span>
          </div>
        )}
      </div>

      {/* ── Map ── */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">Incident Location</h3>
        <MapView location={incident.location} />
      </div>

      {/* ── Evidence ── */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">
          Evidence &nbsp;
          <span className="normal-case text-yellow-600 font-mono">[SIMULATED]</span>
        </h3>
        {incident.evidenceUrl ? (
          <div className="bg-sg-dark border border-sg-border rounded-lg overflow-hidden">
            <img
              src={incident.evidenceUrl}
              alt="Simulated evidence capture"
              className="w-full object-cover max-h-48"
              onError={(e) => {
                // If the image fails to load, show a placeholder
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'flex';
              }}
            />
            <div
              className="hidden items-center justify-center h-32 text-gray-500 text-sm"
              style={{ display: 'none' }}
            >
              📷 Simulated evidence image
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-32 bg-sg-dark border border-sg-border rounded-lg text-gray-500 text-sm">
            📷 No evidence attached
          </div>
        )}
      </div>

      {/* ── Human Verification Controls ── */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">Human Verification</h3>

        {actionError && (
          <div className="text-xs text-red-400 bg-red-950 border border-red-800 rounded px-3 py-2 mb-3">
            ⚠️ {actionError}
          </div>
        )}

        {isOpen ? (
          <div className="flex gap-3">
            <button
              onClick={() => handleVerify('VERIFIED')}
              disabled={verifying}
              className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
            >
              {verifying ? '⏳ Processing...' : '✅ Verify Incident'}
            </button>
            <button
              onClick={() => handleVerify('DISMISSED')}
              disabled={verifying}
              className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
            >
              {verifying ? '⏳ Processing...' : '⚫ Dismiss'}
            </button>
          </div>
        ) : (
          <div className={`text-center py-3 rounded-lg text-sm font-semibold ${
            incident.status === 'VERIFIED'
              ? 'bg-green-950 text-green-400 border border-green-800'
              : 'bg-gray-800 text-gray-400 border border-gray-700'
          }`}>
            {incident.status === 'VERIFIED'
              ? `✅ Verified by ${incident.verifiedBy}`
              : `⚫ Dismissed by ${incident.verifiedBy}`}
          </div>
        )}

        <p className="text-xs text-gray-600 mt-2 text-center">
          All incidents require human review. No automatic action is taken.
        </p>
      </div>

    </div>
  );
}
