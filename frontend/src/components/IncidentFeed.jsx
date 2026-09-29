/**
 * IncidentFeed — the left panel showing all incidents as a scrollable list.
 * Renders an IncidentCard for each incident.
 */

import React from 'react';
import IncidentCard from './IncidentCard';

export default function IncidentFeed({ incidents, loading, selectedId, onSelect }) {
  return (
    <div className="flex flex-col h-full">

      {/* Panel header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Incident Feed
        </h2>
        <span className="text-xs text-gray-500">{incidents.length} total</span>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
          <span className="animate-spin mr-2">⏳</span> Loading incidents...
        </div>
      )}

      {/* Empty state */}
      {!loading && incidents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500 text-sm text-center">
          <span className="text-3xl mb-3">📭</span>
          <p>No incidents yet.</p>
          <p className="text-xs mt-1">Use the Event Simulator below to trigger one.</p>
        </div>
      )}

      {/* Incident list */}
      {!loading && incidents.length > 0 && (
        <div className="flex flex-col gap-2 overflow-y-auto flex-1">
          {incidents.map((incident) => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              isSelected={incident.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
