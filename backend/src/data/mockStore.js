/**
 * SentinelGrid — In-Memory Mock Data Store
 *
 * This file acts as a temporary "database" while AWS is not connected.
 * All incidents are stored in a simple JavaScript array in memory.
 *
 * IMPORTANT: This data is reset every time the server restarts.
 * Once USE_AWS=true, the real DynamoDB table is used instead.
 *
 * This file is NOT used when AWS mode is enabled.
 */

// This array holds all incidents while running in local mode.
// It starts with two example incidents so the dashboard is not empty on first load.
const incidents = [
  {
    id: 'mock-001',
    title: 'Unusual Activity Detected',
    description:
      '[SIMULATED] Predefined motion pattern flagged by prototype event classifier. Requires human verification.',
    severity: 'HIGH',
    status: 'OPEN',       // OPEN → VERIFIED or DISMISSED by a human operator
    location: {
      lat: 40.7128,
      lng: -74.006,
      label: 'Camera Zone A — Main Entrance',
    },
    evidenceUrl: '/sample-evidence/sample1.svg', // served from frontend/public/
    cameraId: 'CAM-001',
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
    updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    verifiedBy: null,
    simulatedInput: true,  // always true in prototype
  },
  {
    id: 'mock-002',
    title: 'Perimeter Proximity Alert',
    description:
      '[SIMULATED] Object detected near restricted perimeter boundary. Flagged for human review.',
    severity: 'MEDIUM',
    status: 'OPEN',
    location: {
      lat: 40.7158,
      lng: -74.009,
      label: 'Camera Zone B — North Perimeter',
    },
    evidenceUrl: '/sample-evidence/sample2.svg',
    cameraId: 'CAM-002',
    createdAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(), // 12 minutes ago
    updatedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    verifiedBy: null,
    simulatedInput: true,
  },
];

/**
 * Returns all incidents (newest first).
 */
function getAllIncidents() {
  return [...incidents].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
}

/**
 * Finds a single incident by its ID.
 * Returns undefined if not found.
 */
function getIncidentById(id) {
  return incidents.find((inc) => inc.id === id);
}

/**
 * Adds a new incident to the store.
 * @param {Object} incident - The full incident object to add
 */
function addIncident(incident) {
  incidents.push(incident);
  return incident;
}

/**
 * Updates an existing incident's fields.
 * @param {string} id - The incident ID
 * @param {Object} updates - Key/value pairs to update
 * Returns the updated incident, or null if not found.
 */
function updateIncident(id, updates) {
  const index = incidents.findIndex((inc) => inc.id === id);
  if (index === -1) return null;

  incidents[index] = {
    ...incidents[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  return incidents[index];
}

module.exports = { getAllIncidents, getIncidentById, addIncident, updateIncident };
