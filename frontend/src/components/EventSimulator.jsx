/**
 * EventSimulator — SIMULATED / PROTOTYPE FUNCTIONALITY
 *
 * This component simulates a camera/event input for demo purposes.
 * In a real deployment, events would come from actual camera hardware or a
 * video analytics service (e.g. Amazon Rekognition Video).
 *
 * The operator selects an event type and clicks "Trigger Event".
 * This sends a POST /incidents request to the backend, which creates
 * a real incident record (flowing through the full backend pipeline).
 *
 * Clearly labeled as SIMULATED INPUT so judges and viewers are never misled.
 */

import React, { useState } from 'react';

// Predefined simulated event types with realistic metadata
const EVENT_TYPES = [
  {
    label: 'Unusual Activity Detected',
    severity: 'HIGH',
    cameraId: 'CAM-001',
    location: { lat: 40.7128, lng: -74.006,  label: 'Camera Zone A — Main Entrance' },
    evidenceUrl: '/sample-evidence/sample1.svg',
  },
  {
    label: 'Perimeter Proximity Alert',
    severity: 'MEDIUM',
    cameraId: 'CAM-002',
    location: { lat: 40.7158, lng: -74.009,  label: 'Camera Zone B — North Perimeter' },
    evidenceUrl: '/sample-evidence/sample2.svg',
  },
  {
    label: 'Unattended Object Detected',
    severity: 'MEDIUM',
    cameraId: 'CAM-003',
    location: { lat: 40.7100, lng: -74.003,  label: 'Camera Zone C — Parking Area' },
    evidenceUrl: '/sample-evidence/sample3.svg',
  },
  {
    label: 'Restricted Area Access',
    severity: 'HIGH',
    cameraId: 'CAM-004',
    location: { lat: 40.7140, lng: -74.013,  label: 'Camera Zone D — Server Room Entry' },
    evidenceUrl: '/sample-evidence/sample1.svg',
  },
  {
    label: 'Loitering Pattern Flagged',
    severity: 'LOW',
    cameraId: 'CAM-005',
    location: { lat: 40.7090, lng: -73.998,  label: 'Camera Zone E — South Corridor' },
    evidenceUrl: '/sample-evidence/sample2.svg',
  },
];

export default function EventSimulator({ onNewIncident }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [triggering, setTriggering] = useState(false);
  const [lastResult, setLastResult] = useState(null); // success | error

  const selectedEvent = EVENT_TYPES[selectedIndex];

  const handleTrigger = async () => {
    setTriggering(true);
    setLastResult(null);

    try {
      const response = await fetch('https://sentinelgrid-2l30.onrender.com/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType:   selectedEvent.label,
          severity:    selectedEvent.severity,
          cameraId:    selectedEvent.cameraId,
          location:    selectedEvent.location,
          evidenceUrl: selectedEvent.evidenceUrl,
        }),
      });

      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      const data = await response.json();
      onNewIncident(data.incident); // pass up to App so the feed updates immediately
      setLastResult({ type: 'success', message: `Incident created: ${data.incident.id}` });
    } catch (err) {
      console.error('Trigger failed:', err);
      setLastResult({ type: 'error', message: 'Failed to trigger event. Is the backend running?' });
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="bg-yellow-950 border-t-2 border-yellow-700 px-6 py-4">

      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-yellow-400 text-sm font-bold font-mono">
          ⚠️ [PROTOTYPE] SIMULATED / PROTOTYPE FUNCTIONALITY
        </span>
        <span className="text-xs text-yellow-600">
          — This panel simulates camera/event input. Not a real camera feed.
        </span>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3 flex-wrap">

        {/* Event type selector */}
        <div className="flex flex-col gap-1 flex-1 min-w-48">
          <label className="text-xs text-yellow-600">Select Simulated Event Type</label>
          <select
            value={selectedIndex}
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
            className="bg-yellow-900 border border-yellow-700 text-yellow-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-yellow-400"
          >
            {EVENT_TYPES.map((event, index) => (
              <option key={index} value={index}>
                [{event.severity}] {event.label}
              </option>
            ))}
          </select>
        </div>

        {/* Preview of what will be sent */}
        <div className="flex flex-col gap-1 text-xs text-yellow-600 min-w-48">
          <span>📍 {selectedEvent.location.label}</span>
          <span>📷 {selectedEvent.cameraId}</span>
          <span className={`font-bold ${
            selectedEvent.severity === 'HIGH'   ? 'text-red-400' :
            selectedEvent.severity === 'MEDIUM' ? 'text-yellow-400' :
                                                   'text-green-400'
          }`}>
            Severity: {selectedEvent.severity}
          </span>
        </div>

        {/* Trigger button */}
        <button
          onClick={handleTrigger}
          disabled={triggering}
          className="bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold px-6 py-2.5 rounded-lg transition-colors text-sm whitespace-nowrap"
        >
          {triggering ? '⏳ Triggering...' : '🚨 Trigger Simulated Event'}
        </button>
      </div>

      {/* Result message */}
      {lastResult && (
        <div className={`mt-2 text-xs px-3 py-1.5 rounded ${
          lastResult.type === 'success'
            ? 'bg-green-950 text-green-400 border border-green-800'
            : 'bg-red-950 text-red-400 border border-red-800'
        }`}>
          {lastResult.type === 'success' ? '✅' : '❌'} {lastResult.message}
        </div>
      )}

    </div>
  );
}
