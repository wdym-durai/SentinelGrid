# SentinelGrid

A public-space safety monitoring prototype that uses the Ring Partner API to flag predefined potentially concerning events and route them to human reviewers via a real-time control-room dashboard.

> ⚠️ **Prototype disclaimer.** SentinelGrid flags predefined safety-related events for human verification. It does **not** automatically determine that a crime has occurred, does **not** dispatch emergency services, and makes **no** guarantee of crime detection or prevention. All flagged events require review by a human monitoring operator.

---

## What It Does

SentinelGrid connects to the Ring Partner API (Amazon Vision API) and:

1. Receives real-time motion events from linked Ring devices via HMAC-signed webhooks
2. Normalises each event into a reviewable incident with severity, location, and evidence metadata
3. Displays incidents on a live control-room dashboard
4. Requires a human operator to **Verify** or **Dismiss** every incident before any action can be considered
5. Logs all operator actions with timestamps in a persistent Activity Log

An **Event Simulator** (clearly labelled `[PROTOTYPE] SIMULATED / PROTOTYPE FUNCTIONALITY`) allows demo operators to generate synthetic incidents for demonstration without requiring a live Ring device.

---

## Why It Matters

Traditional monitoring infrastructure requires constant human attention to camera feeds. SentinelGrid demonstrates how Ring's event-driven API can surface predefined safety signals to monitoring personnel, reduce missed alerts, and ensure every event has a human decision attached to it — not an automated one.

---

## Features

| Feature | Status |
|---|---|
| Live incident feed with severity levels | ✅ Real |
| Human verification workflow (Verify / Dismiss) | ✅ Real |
| Activity log with timestamps | ✅ Real |
| Interactive map (OpenStreetMap, no API key) | ✅ Real |
| SVG evidence display panel | ✅ Real |
| Ring API integration layer | ✅ Real |
| Ring OAuth one-way account linking | ✅ Real |
| Ring webhook receiver with HMAC-SHA256 verification | ✅ Real |
| Ring device motion event → SentinelGrid incident | ✅ Real |
| Ring integration status panel in dashboard | ✅ Real |
| Event simulator for demo purposes | 🟡 Simulated (clearly labelled) |
| Evidence images | 🟡 Simulated SVGs (clearly labelled) |
| AWS DynamoDB / S3 / SNS | 🔌 Stubbed (connect via `.env`) |

---

## Architecture

```
Ring devices (motion events)
        │
        ▼ HMAC-signed webhook POST
┌───────────────────────────────────────┐
│  SentinelGrid Backend (Node.js/Express)│
│                                        │
│  POST /ring/token-exchange  ← Ring     │
│  GET  /ring/account-link    ← Ring     │
│  POST /ring/webhook         ← Ring     │
│  GET  /ring/status          → Frontend│
│  GET  /ring/devices         → Frontend│
│                                        │
│  POST /incidents  ← Simulator/Ring    │
│  GET  /incidents  → Frontend          │
│  PUT  /incidents/:id/verify → Frontend│
└───────────────────────────────────────┘
        │
        ▼ REST API (polling + actions)
┌───────────────────────────────────────┐
│  SentinelGrid Frontend (React/Vite)    │
│                                        │
│  Control-room dashboard                │
│  ├── Ring Integration Status Panel     │
│  ├── Incident Feed                     │
│  ├── Incident Detail + Map             │
│  ├── Evidence Panel                    │
│  ├── Verify / Dismiss buttons          │
│  ├── Activity Log                      │
│  └── Event Simulator [PROTOTYPE]       │
└───────────────────────────────────────┘
        │
        ▼ Human operator decision
   VERIFIED / DISMISSED
```

---

## Ring Integration

SentinelGrid integrates with the **Ring Partner API (Amazon Vision API)**.

| Component | Detail |
|---|---|
| API base | `https://api.amazonvision.com` |
| OAuth flow | One-way account linking (Ring-driven) |
| Token exchange | `POST https://oauth.ring.com/oauth/token` |
| Device discovery | `GET https://api.amazonvision.com/v1/devices` |
| Webhook events | `POST /ring/webhook` — HMAC-SHA256 verified |
| Webhook signature | `X-Signature: sha256=<hex>` header |
| Nonce verification | `HMAC-SHA256(K_hmac, "<time_ms>:<account_id>")` Base64URL |

All Ring credentials are loaded from environment variables only. No credentials are hardcoded or committed to the repository.

Ring Developer Console URL mapping:

| Console field | Backend endpoint |
|---|---|
| Token Exchange URL | `POST /ring/token-exchange` |
| Account Link URL | `GET /ring/account-link` |
| Webhook URL | `POST /ring/webhook` |
| App Homepage URL | `GET /ring/home` → redirects to frontend |

---

## Local Development

**Prerequisites:** Node.js 18+ installed.

```bash
# Terminal 1 — Backend (port 3001)
cd backend
npm install
npm start

# Terminal 2 — Frontend (port 5173)
cd frontend
npm install
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001
- Health check: http://localhost:3001/health
- Ring status: http://localhost:3001/ring/status

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in your values.

```
# Server
PORT=3001

# Ring Developer API
RING_CLIENT_ID=
RING_CLIENT_SECRET=
RING_HMAC_SIGNATURE_KEY=
RING_REDIRECT_URI=
RING_API_BASE_URL=https://api.amazonvision.com
RING_APP_HOMEPAGE_URL=

# AWS (optional — stubbed by default)
USE_AWS=false
AWS_REGION=us-east-1
DYNAMODB_TABLE_NAME=SentinelGridIncidents
S3_BUCKET_NAME=sentinelgrid-evidence
SNS_TOPIC_ARN=
```

**Never commit real credentials.** The `.env` file is in `.gitignore`.

---

## Production URLs

| Resource | URL |
|---|---|
| Frontend | https://sentinelgrid-aiz.pages.dev |
| Backend | https://sentinelgrid-2l30.onrender.com |
| Health check | https://sentinelgrid-2l30.onrender.com/health |
| Ring status | https://sentinelgrid-2l30.onrender.com/ring/status |

---

## Demo Flow

1. Open the SentinelGrid dashboard
2. Observe the **Ring Integration** panel in the left column showing API configuration status
3. Observe the **Incident Feed** (pre-seeded with mock incidents in local mode)
4. In the **[PROTOTYPE] Event Simulator**, select an event type and click **Trigger Simulated Event**
5. The incident appears in the feed with severity, location, and evidence
6. Click the incident to open the **Detail Panel**
7. Review the map pin, evidence image, camera ID, and description
8. Click **Verify Incident** — the status transitions to `VERIFIED by Operator 1`
9. Observe the **Activity Log** entry
10. The **Stats Bar** updates the count

When Ring account linking is complete and a real Ring device triggers a motion event:
- Step 4 is replaced by the Ring device triggering `POST /ring/webhook`
- The incident appears with `source: "ring"` and `simulatedInput: false`
- Steps 5–10 remain identical

---

## Hackathon Update

SentinelGrid was built for the **Amazon Developer Hackathon 2026 — Ring track**.

Key work completed during the hackathon:

- Full Ring Partner API integration layer (`backend/src/routes/ring.js`)
- One-way OAuth account linking with HMAC nonce verification
- HMAC-SHA256 webhook receiver with idempotency (`meta.request_id`)
- Ring token store with UNCLAIMED/CLAIMED lifecycle (`ringTokenStore.js`)
- Ring integration status panel in the frontend dashboard (`RingStatusPanel.jsx`)
- Ring device discovery endpoint (`GET /ring/devices`)
- Incident normalisation for Ring motion events with `source: "ring"` field
- Partner-Initiated OAuth 2.0 callback (invitation-only, retained as secondary flow)

---

## Safety / Prototype Disclaimer

SentinelGrid is a prototype. It:

- **Flags** predefined safety-related events for human verification
- **Does not** automatically determine that a crime has occurred
- **Does not** dispatch emergency services
- **Does not** guarantee detection or prevention of any event
- **Requires** human operator review before any action is considered

All incidents are labelled with their source (`ring` or `simulated`) and require explicit Verify or Dismiss action by a human operator.

---

## License

MIT — see [LICENSE](./LICENSE)
