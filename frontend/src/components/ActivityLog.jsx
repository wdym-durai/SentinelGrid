/**
 * ActivityLog — timestamped log of incident lifecycle events.
 *
 * Receives a `logs` array from App.jsx (no backend calls, no AWS).
 * Each log entry shape:
 *   { id, type, message, incidentTitle, timestamp }
 *   type: 'created' | 'verified' | 'dismissed'
 */

import React from 'react';

const TYPE_STYLES = {
  created:   { icon: '🟢', color: 'text-blue-400',  label: 'CREATED'   },
  verified:  { icon: '✅', color: 'text-green-400', label: 'VERIFIED'  },
  dismissed: { icon: '⚫', color: 'text-gray-400',  label: 'DISMISSED' },
  preloaded: { icon: '📋', color: 'text-gray-500',  label: 'PRE-EXISTING' },
};

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function ActivityLog({ logs }) {
  return (
    <div className="bg-sg-panel border border-sg-border rounded-lg flex flex-col" style={{ maxHeight: '260px' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-sg-border flex-shrink-0">
        <h2 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          Activity Log
        </h2>
        <span className="text-xs text-gray-500">{logs.length} events</span>
      </div>

      {/* Log entries */}
      <div className="overflow-y-auto flex-1 px-2 py-1">
        {logs.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-gray-600 text-xs">
            No activity yet
          </div>
        ) : (
          // Newest first
          [...logs].reverse().map((entry) => {
            const style = TYPE_STYLES[entry.type] || TYPE_STYLES.created;
            return (
              <div
                key={entry.id}
                className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-sg-dark transition-colors"
              >
                {/* Icon */}
                <span className="text-sm flex-shrink-0 mt-0.5">{style.icon}</span>

                {/* Message body */}
                <div className="flex-1 min-w-0">
                  <span className={`text-xs font-mono font-semibold ${style.color}`}>
                    {style.label}
                  </span>
                  <span className="text-xs text-gray-300 ml-1.5 truncate">
                    {entry.incidentTitle}
                  </span>
                  {entry.operator && (
                    <span className="text-xs text-gray-500 ml-1">
                      — by {entry.operator}
                    </span>
                  )}
                </div>

                {/* Timestamp */}
                <span className="text-xs text-gray-600 flex-shrink-0 font-mono">
                  {formatTime(entry.timestamp)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
