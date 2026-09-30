/**
 * SentinelGrid — Backend Entry Point
 *
 * This is the main file that starts the Express server.
 * It runs on http://localhost:3001
 *
 * Currently runs in LOCAL MODE using in-memory mock data.
 * AWS integration (DynamoDB, S3, SNS) will be connected later
 * by setting USE_AWS=true in the .env file.
 *
 * Middleware order is intentional:
 *   1. POST /ring/webhook  — express.raw() BEFORE express.json()
 *      The webhook handler requires the raw request body Buffer for
 *      HMAC-SHA256 signature verification. If express.json() runs first
 *      the raw bytes are consumed and verification becomes impossible.
 *   2. express.json()      — global JSON parsing for all other routes
 *   3. All other routes
 */

// Load environment variables from .env file (if it exists).
// This must be the very first thing we do.
require('dotenv').config();

const express = require('express');
const cors    = require('cors');

// Import route modules
const incidentRoutes = require('./routes/incidents');
const { router: ringRouter, ringWebhookHandler } = require('./routes/ring');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://sentinelgrid-ai2.pages.dev',
    'https://sentinelgrid-aiz.pages.dev',
  ],
}));

// ── Step 1: Ring webhook — express.raw() BEFORE express.json() ───────────────
//
// This route MUST be registered before app.use(express.json()) below.
// express.raw({ type: 'application/json' }) captures the raw body as a Buffer
// without parsing it, making it available as req.body in ringWebhookHandler
// for HMAC-SHA256 signature verification.
//
// All other routes receive normal JSON parsing via express.json() below.
app.post('/ring/webhook', express.raw({ type: 'application/json' }), ringWebhookHandler);

// ── Step 2: Global JSON parsing for all remaining routes ─────────────────────
app.use(express.json());

// ── Step 3: Routes ────────────────────────────────────────────────────────────
app.use('/ring',      ringRouter);       // GET /ring/status, /account-link, /callback
app.use('/incidents', incidentRoutes);   // existing incident CRUD — unchanged

// ── Health check ─────────────────────────────────────────────────────────────
// Visit http://localhost:3001/health to confirm the server is running
app.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    message:   'SentinelGrid backend is running',
    mode:      process.env.USE_AWS === 'true' ? 'AWS Mode' : 'Local Mock Mode',
    timestamp: new Date().toISOString(),
  });
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('🟢 SentinelGrid Backend is running');
  console.log(`   URL:  http://localhost:${PORT}`);
  console.log(`   Mode: ${process.env.USE_AWS === 'true' ? '✅ AWS Mode' : '🟡 Local Mock Mode (no AWS)'}`);
  console.log('');
});
