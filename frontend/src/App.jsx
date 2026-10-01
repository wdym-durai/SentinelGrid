/**
 * SentinelGrid — Root Application Component
 *
 * This is the top-level layout of the dashboard.
 * It manages the global incident state and selected incident.
 *
 * Layout:
 *   ┌─────────────────────────────────────────┐
 *   │  Header (title + mode badge)            │
 *   │  StatsBar (open / verified / dismissed) │
 *   ├─────────────────┬───────────────────────┤
 *   │  IncidentFeed   │  IncidentDetail       │
 *   │  (left panel)   │  ActivityLog          │
 *   │                 │  (right panel)        │
 *   ├─────────────────┴───────────────────────┤
 *   │  EventSimulator  [PROTOTYPE INPUT]       │
 *   └─────────────────────────────────────────┘
 */

import React, { useState, useEffect, useCallback } from 'react';
import StatsBar from './components/StatsBar';
import IncidentFeed from './components/IncidentFeed';
import IncidentDetail from './components/IncidentDetail';
import EventSimulator from './components/EventSimulator';
import ActivityLog from './components/ActivityLog';
import RingStatusPanel from './components/RingStatusPanel';

const API_BASE = 'https://sentinelgrid-2l30.onrender.com/incidents';
const BACKEND_HEALTH = 'https://sentinelgrid-2l30.onrender.com/health';

export default function App() {
  const [incidents, setIncidents] = useState([]);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  // Tracks whether backend is reachable and its reported mode
  const [backendMode, setBackendMode] = useState('connecting...');

  // ── Add a timestamped entry to the activity log ───────────────────────────
  const addLog = useCallback((type, incident, operator = null) => {
    setLogs((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random()}`,
        type,
        incidentTitle: incident.title,
        operator,
        timestamp: new Date().toISOString(),
      },
    ]);
  }, []);

  // ── Fetch backend mode (health check) ────────────────────────────────────
  useEffect(() => {
    fetch(BACKEND_HEALTH)
      .then((r) => r.json())
      .then((d) => setBackendMode(d.mode || 'Unknown'))
      .catch(() => setBackendMode('unreachable'));
  }, []);

  // ── Fetch all incidents from the backend ──────────────────────────────────
  const fetchIncidents = useCallback(async () => {
    try {
      const response = await fetch(API_BASE);
      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const data = await response.json();
      const fetched = data.incidents || [];
      setIncidents(fetched);
      setError(null);

      // On first load only (when logs is empty), log pre-existing incidents
      setLogs((prevLogs) => {
        if (prevLogs.length > 0) return prevLogs; // already seeded
        return fetched.map((inc) => ({
          id: `preload-${inc.id}`,
          type: inc.status === 'VERIFIED'
            ? 'verified'
            : inc.status === 'DISMISSED'
            ? 'dismissed'
            : 'preloaded',
          incidentTitle: inc.title,
          operator: inc.verifiedBy || null,
          timestamp: inc.createdAt,
        }));
      });
    } catch (err) {
      console.error('Failed to fetch incidents:', err);
      setError('Unable to connect to backend. Is it running on port 3001?');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load incidents on first render, then poll every 10 seconds
  useEffect(() => {
    fetchIncidents();
    const interval = setInterval(fetchIncidents, 10000);
    return () => clearInterval(interval); // cleanup on unmount
  }, [fetchIncidents]);

  // ── Handle new incident from the Event Simulator ──────────────────────────
  const handleNewIncident = (incident) => {
    setIncidents((prev) => [incident, ...prev]);
    setSelectedIncident(incident); // auto-select the new incident
    addLog('created', incident);
  };

  // ── Handle verify/dismiss from IncidentDetail ─────────────────────────────
  const handleIncidentUpdated = (updatedIncident) => {
    setIncidents((prev) =>
      prev.map((inc) => (inc.id === updatedIncident.id ? updatedIncident : inc))
    );
    setSelectedIncident(updatedIncident);
    const type = updatedIncident.status === 'VERIFIED' ? 'verified' : 'dismissed';
    addLog(type, updatedIncident, updatedIncident.verifiedBy);
  };

  // ── Sync selectedIncident when the incidents list updates ─────────────────
  useEffect(() => {
    if (selectedIncident) {
      const updated = incidents.find((inc) => inc.id === selectedIncident.id);
      if (updated) setSelectedIncident(updated);
    }
  }, [incidents]);

  return (
    <div className="min-h-screen bg-sg-dark text-gray-100 flex flex-col">

      {/* ── Header ── */}
      <header className="bg-sg-panel border-b border-sg-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🛡️</span>
          <div>
            <h1 className="text-xl font-bold tracking-wide text-white">
              SentinelGrid
            </h1>
            <p className="text-xs text-gray-400">
              Public Safety Monitoring — Control Room Dashboard
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Live indicator */}
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            LIVE
          </div>
          {/* System mode indicator — driven by live health check */}
          <span className="text-xs bg-gray-800 text-gray-400 border border-gray-600 px-2 py-1 rounded font-mono">
            {backendMode === 'connecting...' ? 'CONNECTING…' : backendMode.toUpperCase()}
          </span>
          {/* Prototype badge */}
          <span className="text-xs bg-yellow-900 text-yellow-300 border border-yellow-700 px-2 py-1 rounded font-mono">
            PROTOTYPE
          </span>
        </div>
      </header>

      {/* ── Disclaimer Banner ── */}
      <div className="bg-yellow-950 border-b border-yellow-800 px-6 py-2 text-xs text-yellow-300 text-center">
        ⚠️ This system flags <strong>potentially concerning events</strong> for human verification only.
        It does <strong>not</strong> automatically determine that a crime has occurred or dispatch emergency services.
      </div>

      {/* ── Stats Bar ── */}
      <StatsBar incidents={incidents} />

      {/* ── Error Banner ── */}
      {error && (
        <div className="mx-6 mt-4 bg-red-950 border border-red-700 text-red-300 text-sm px-4 py-3 rounded">
          ⚠️ {error}
        </div>
      )}

      {/* ── Main Content ── */}
      <main className="flex flex-1 gap-4 p-4 overflow-hidden">

        {/* Left panel — incident feed + Ring status */}
        <div className="w-96 flex-shrink-0 flex flex-col gap-4 overflow-y-auto">
          <IncidentFeed
            incidents={incidents}
            loading={loading}
            selectedId={selectedIncident?.id}
            onSelect={setSelectedIncident}
          />
          {/* Ring API integration status — real data only, not local simulation */}
          <RingStatusPanel />
        </div>

        {/* Right panel — incident detail + activity log */}
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto">
          <IncidentDetail
            incident={selectedIncident}
            onIncidentUpdated={handleIncidentUpdated}
          />
          <ActivityLog logs={logs} />
        </div>
      </main>

      {/* ── Event Simulator (bottom panel) ── */}
      <EventSimulator onNewIncident={handleNewIncident} />

    </div>
  );
}
