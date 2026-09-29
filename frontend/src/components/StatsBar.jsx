/**
 * StatsBar — shows a live count of incidents by status
 * Displayed at the top of the dashboard below the header.
 */

import React from 'react';

export default function StatsBar({ incidents }) {
  const open      = incidents.filter((i) => i.status === 'OPEN').length;
  const verified  = incidents.filter((i) => i.status === 'VERIFIED').length;
  const dismissed = incidents.filter((i) => i.status === 'DISMISSED').length;
  const total     = incidents.length;

  const stats = [
    { label: 'Total Incidents',  value: total,     color: 'text-blue-400',   bg: 'bg-blue-950',   border: 'border-blue-800' },
    { label: 'Open — Awaiting Review', value: open, color: 'text-red-400',   bg: 'bg-red-950',    border: 'border-red-800' },
    { label: 'Verified by Operator',   value: verified,  color: 'text-green-400', bg: 'bg-green-950',  border: 'border-green-800' },
    { label: 'Dismissed',        value: dismissed, color: 'text-gray-400',   bg: 'bg-gray-900',   border: 'border-gray-700' },
  ];

  return (
    <div className="grid grid-cols-4 gap-3 px-4 py-3 bg-sg-panel border-b border-sg-border">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`flex flex-col items-center justify-center px-3 py-2 rounded-lg border ${stat.bg} ${stat.border}`}
        >
          <span className={`text-2xl font-bold ${stat.color}`}>{stat.value}</span>
          <span className="text-xs text-gray-400 mt-1 text-center">{stat.label}</span>
        </div>
      ))}
    </div>
  );
}
