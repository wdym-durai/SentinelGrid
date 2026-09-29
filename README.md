# SentinelGrid

**SentinelGrid** is a hackathon prototype for a public-safety monitoring system.

It detects predefined safety-related events, flags potentially concerning events, creates incident alerts for human verification, and displays them on a control-room dashboard.

> ⚠️ This is a prototype. It does NOT automatically determine that a crime has occurred. It does NOT dispatch emergency services automatically. All flagged events require human verification by a monitoring operator.

---

## What Is Real vs Simulated

| Component | Status |
|---|---|
| REST API backend (Node.js/Express) | ✅ Real |
| React dashboard | ✅ Real |
| Map with incident location (Leaflet.js) | ✅ Real |
| Amazon DynamoDB — incident storage | 🔌 Stubbed (connect later) |
| Amazon S3 — evidence storage | 🔌 Stubbed (connect later) |
| Amazon SNS — alert notifications | 🔌 Stubbed (connect later) |
| Camera / event input | 🟡 SIMULATED / PROTOTYPE FUNCTIONALITY |
| AI event classification | 🟡 SIMULATED (Amazon Rekognition cited as real upgrade path) |
| Evidence images | 🟡 Simulated (preloaded sample images) |

---

## Project Structure

```
SentinelGrid/
├── frontend/       # React dashboard (Vite)
├── backend/        # Node.js + Express API
├── assets/         # Sample evidence images
└── README.md
```

---

## Running Locally

> Prerequisites: Node.js installed. No AWS credentials needed for local mode.

```bash
# Terminal 1 — Backend
cd backend
npm install
npm start

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

---

## AWS Integration (Future Step)

AWS services (DynamoDB, S3, SNS) are designed to be connected via environment variables.
See `backend/.env.example` for the variables needed.
**Do not add real credentials to any code file.**

---

## Demo Flow

1. Operator triggers a simulated safety event via the **[PROTOTYPE] Event Simulator** panel
2. Backend creates an incident record
3. Incident appears on the dashboard with location, severity, and evidence
4. Operator reviews and clicks **Verify** or **Dismiss**
5. Incident status updates in real time
