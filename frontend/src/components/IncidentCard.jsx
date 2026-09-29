/**
 * IncidentCard — a single row in the incident feed list.
 * Shows title, severity badge, status, location, and timestamp.
 * Highlights when selected.
 */

import React from 'react';

// Maps severity levels to Tailwind color classes
const SEVERITY_STYLES = {
  HIGH:   'bg-red-900 text-red-300 border-red-700',
  MEDIUM: 'bg-yellow-900 text-yellow-300 border-yellow-700',
  LOW:    'bg-green-900 text-green-300 border-green-700',
};

const STATUS_STYLES = {
  OPEN:      'text-red-400',
  VERIFIED:  'text-green-400',
  DISMISSED: 'text-gray-400',
};

const STATUS_ICONS = {
  OPEN:      '🔴',
  VERIFIED:  '✅',
  DISMISSED: '⚫',
};

// Formats a UTC ISO string into a readable local time string
function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function IncidentCard({ incident, isSelected, onSelect }) {
  const severityClass = SEVERITY_STYLES[incident.severity] || SEVERITY_STYLES.LOW;
  const statusClass   = STATUS_STYLES[incident.status]   || STATUS_STYLES.OPEN;
  const statusIcon    = STATUS_ICONS[incident.status]    || '🔴';

  return (
    <button
      onClick={() => onSelect(incident)}
      className={`
        w-full text-left px-4 py-3 rounded-lg border transition-all duration-150
        ${isSelected
          ? 'bg-blue-950 border-blue-600 shadow-lg shadow-blue-900/30'
          : 'bg-sg-panel border-sg-border hover:border-gray-500 hover:bg-gray-800'}
      `}
    >
      {/* Top row: severity badge + title */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="font-semibold text-sm text-white leading-tight flex-1">
          {incident.title}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded border font-mono flex-shrink-0 ${severityClass}`}>
          {incident.severity}
        </span>
      </div>

      {/* Middle row: location */}
      <p className="text-xs text-gray-400 truncate mb-1">
        📍 {incident.location?.label || 'Unknown location'}
      </p>

      {/* Bottom row: status + time */}
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${statusClass}`}>
          {statusIcon} {incident.status}
        </span>
        <span className="text-xs text-gray-500">
          {formatTime(incident.createdAt)}
        </span>
      </div>

      {/* Simulated input label */}
      {incident.simulatedInput && (
        <div className="mt-1.5 text-xs text-yellow-600 font-mono">
          [SIMULATED INPUT]
        </div>
      )}
    </button>
  );
}
