/**
 * SentinelGrid — Incident Routes
 *
 * These are the API endpoints the frontend calls.
 * Each route checks the USE_AWS flag:
 *   - USE_AWS=false → uses mockStore (local in-memory data)
 *   - USE_AWS=true  → uses DynamoDB, S3, SNS (connected in a later step)
 *
 * Available endpoints:
 *   GET    /incidents          — list all incidents
 *   GET    /incidents/:id      — get one incident by ID
 *   POST   /incidents          — create a new incident (from the event simulator)
 *   PUT    /incidents/:id/verify  — human operator verifies or dismisses an incident
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// Local mock store (used when USE_AWS=false)
const mockStore = require('../data/mockStore');

// AWS service modules (stubbed for now; activated when USE_AWS=true)
const dynamoService = require('../services/dynamodb');
const s3Service = require('../services/s3');
const snsService = require('../services/sns');

// Read the feature flag once at startup
const USE_AWS = process.env.USE_AWS === 'true';

// ─────────────────────────────────────────────
// GET /incidents
// Returns all incidents, newest first
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    let incidents;

    if (USE_AWS) {
      incidents = await dynamoService.getAllIncidents();
    } else {
      incidents = mockStore.getAllIncidents();
    }

    res.json({ success: true, incidents });
  } catch (error) {
    console.error('Error fetching incidents:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch incidents' });
  }
});

// ─────────────────────────────────────────────
// GET /incidents/:id
// Returns a single incident by its ID
// ─────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let incident;

    if (USE_AWS) {
      incident = await dynamoService.getIncidentById(id);
    } else {
      incident = mockStore.getIncidentById(id);
    }

    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found' });
    }

    res.json({ success: true, incident });
  } catch (error) {
    console.error('Error fetching incident:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch incident' });
  }
});

// ─────────────────────────────────────────────
// POST /incidents
// Creates a new incident from the event simulator
//
// Expected request body:
// {
//   "eventType": "Unusual Activity Detected",
//   "severity": "HIGH",          // HIGH | MEDIUM | LOW
//   "cameraId": "CAM-001",
//   "location": {
//     "lat": 40.7128,
//     "lng": -74.0060,
//     "label": "Camera Zone A"
//   },
//   "evidenceUrl": "/sample-evidence/sample1.jpg"
// }
// ─────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { eventType, severity, cameraId, location, evidenceUrl } = req.body;

    // Basic validation — make sure required fields are present
    if (!eventType || !severity || !location) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: eventType, severity, location',
      });
    }

    // Build the new incident object
    const newIncident = {
      id: uuidv4(),         // unique ID generated locally
      title: eventType,
      description: `[SIMULATED] Predefined safety-related event flagged for human verification. Event type: "${eventType}". This is prototype functionality — no automatic action has been taken.`,
      severity: severity.toUpperCase(),
      status: 'OPEN',
      location,
      evidenceUrl: evidenceUrl || null,
      cameraId: cameraId || 'UNKNOWN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      verifiedBy: null,
      simulatedInput: true, // always true in this prototype
    };

    if (USE_AWS) {
      // Save to DynamoDB
      await dynamoService.addIncident(newIncident);
      // Trigger SNS alert notification
      await snsService.publishAlert(newIncident);
      // (S3 evidence upload would happen here with real camera data)
    } else {
      mockStore.addIncident(newIncident);
    }

    console.log(`[Incident Created] ID: ${newIncident.id} | Type: ${eventType} | Severity: ${severity}`);

    res.status(201).json({ success: true, incident: newIncident });
  } catch (error) {
    console.error('Error creating incident:', error);
    res.status(500).json({ success: false, error: 'Failed to create incident' });
  }
});

// ─────────────────────────────────────────────
// PUT /incidents/:id/verify
// Human operator verifies or dismisses an incident
//
// Expected request body:
// {
//   "action": "VERIFIED" | "DISMISSED",
//   "operatorName": "Operator 1"
// }
// ─────────────────────────────────────────────
router.put('/:id/verify', async (req, res) => {
  try {
    const { id } = req.params;
    const { action, operatorName } = req.body;

    // Validate the action value
    if (!action || !['VERIFIED', 'DISMISSED'].includes(action.toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: 'action must be either "VERIFIED" or "DISMISSED"',
      });
    }

    const updates = {
      status: action.toUpperCase(),
      verifiedBy: operatorName || 'Unknown Operator',
      updatedAt: new Date().toISOString(),
    };

    let updatedIncident;

    if (USE_AWS) {
      updatedIncident = await dynamoService.updateIncident(id, updates);
    } else {
      updatedIncident = mockStore.updateIncident(id, updates);
    }

    if (!updatedIncident) {
      return res.status(404).json({ success: false, error: 'Incident not found' });
    }

    console.log(`[Incident ${updates.status}] ID: ${id} | By: ${updates.verifiedBy}`);

    res.json({ success: true, incident: updatedIncident });
  } catch (error) {
    console.error('Error verifying incident:', error);
    res.status(500).json({ success: false, error: 'Failed to update incident' });
  }
});

module.exports = router;
