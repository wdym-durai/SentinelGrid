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
 * Middleware registration order is intentional — do not reorder:
 *
 *   1. POST /ring/webhook  — express.raw({ type:'application/json' })
 *      Must be registered BEFORE express.json(). The webhook handler
 *      requires the raw request body Buffer for HMAC-SHA256 signature
 *      verification. If express.json() runs first the raw bytes are
 *      consumed and HMAC verification becomes impossible.
 *
 *   2. express.urlencoded({ extended: false })
 *      Ring's Token Exchange URL receives an application/x-www-form-urlencoded
 *      POST from Ring's backend. This parser makes req.body.code available
 *      on that route. Safe alongside express.json() — each parser only
 *      activates for its own Content-Type.
 *
 *   3. express.json()
 *      Global JSON body parsing for all other routes.
 *
 *   4. All other routes.
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
// express.raw() captures the body as a Buffer without parsing it.
// ringWebhookHandler uses this raw Buffer for HMAC-SHA256 verification.
app.post(
  '/ring/webhook',
  express.raw({ type: 'application/json' }),
  ringWebhookHandler,
);

// ── Step 2: Form-encoded body parser ─────────────────────────────────────────
// Ring's backend POSTs the authorization code to our Token Exchange URL
// as application/x-www-form-urlencoded. This parser makes req.body.code
// available in POST /ring/token-exchange.
// extended:false uses the built-in querystring module (no extra dependencies).
app.use(express.urlencoded({ extended: false }));

// ── Step 3: Global JSON parsing ───────────────────────────────────────────────
app.use(express.json());

// ── Step 4: Routes ────────────────────────────────────────────────────────────
//
// Ring Developer Console URL mapping:
//   Token Exchange URL → POST /ring/token-exchange  (handled by ringRouter)
//   Account Link URL   → GET  /ring/account-link    (handled by ringRouter)
//   Webhook URL        → POST /ring/webhook         (handled above with raw body)
//   App Homepage URL   → GET  /ring/home            (handled by ringRouter)
//
app.use('/ring',      ringRouter);       // all /ring/* routes except /webhook
app.use('/incidents', incidentRoutes);   // existing incident CRUD — unchanged

// ── Health check ──────────────────────────────────────────────────────────────
// GET http://localhost:3001/health — confirms server is running
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
