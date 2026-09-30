/**
 * SentinelGrid — Backend Entry Point
 *
 * This is the main file that starts the Express server.
 * It runs on http://localhost:3001
 *
 * Currently runs in LOCAL MODE using in-memory mock data.
 * AWS integration (DynamoDB, S3, SNS) will be connected later
 * by setting USE_AWS=true in the .env file.
 */

// Load environment variables from .env file (if it exists)
// This must be the very first thing we do
require('dotenv').config();

const express = require('express');
const cors = require('cors');

// Import our incident routes
const incidentRoutes = require('./routes/incidents');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
// cors() allows the frontend (running on port 5173) to talk to this backend
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://sentinelgrid-ai2.pages.dev',
    'https://sentinelgrid-aiz.pages.dev'
  ]
}));
// express.json() lets us read JSON data sent in request bodies
app.use(express.json());

// --- Routes ---
app.use('/incidents', incidentRoutes);

// --- Health Check ---
// Visit http://localhost:3001/health to confirm the server is running
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'SentinelGrid backend is running',
    mode: process.env.USE_AWS === 'true' ? 'AWS Mode' : 'Local Mock Mode',
    timestamp: new Date().toISOString(),
  });
});

// --- Start Server ---
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('🟢 SentinelGrid Backend is running');
  console.log(`   URL:  http://localhost:${PORT}`);
  console.log(`   Mode: ${process.env.USE_AWS === 'true' ? '✅ AWS Mode' : '🟡 Local Mock Mode (no AWS)'}`);
  console.log('');
});
