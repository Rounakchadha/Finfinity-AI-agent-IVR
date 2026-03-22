# 🏦 Finfinity Voice Agent

An AI-powered outbound voice intake agent for Finfinity loan services. Makes a phone call, conducts a structured interview, creates a lead in SQLite, and notifies an RM via n8n.

**Stack:** Node.js + Express + TypeScript · Prisma + SQLite · Twilio Voice · Groq (Llama 3.3-70B) · n8n

**Cost:** ~Free for development (Twilio $15 trial credit · Groq free tier · n8n self-hosted)

---

## Project Structure

```
ai_call_agent/
├── backend/
│   ├── src/
│   │   ├── server.ts               # App entry, /api/call/start endpoint
│   │   ├── twilio/
│   │   │   ├── voiceRoutes.ts      # /twilio/voice, /gather, /status
│   │   │   └── twiml.ts            # TwiML XML builder helpers
│   │   ├── agent/
│   │   │   ├── stateMachine.ts     # 15-state conversation machine
│   │   │   ├── prompts.ts          # Agent questions + Groq prompts
│   │   │   └── extract.ts          # Groq field extraction
│   │   ├── leads/
│   │   │   ├── leadRoutes.ts       # GET/POST /api/leads
│   │   │   └── leadService.ts      # Prisma CRUD
│   │   └── rm/
│   │       └── rmNotify.ts         # Posts lead JSON to n8n
│   ├── prisma/schema.prisma
│   ├── .env                        # Your credentials (git-ignored)
│   └── package.json
├── n8n/
│   ├── workflow-finfinity-lead-intake.json
│   └── README.md
└── docs/
    ├── architecture.md
    ├── call-flow.md
    └── improvements.md
```

---

## Prerequisites — Setup (One-time)

### Step 1: Verify your Twilio phone number

> ⚠️ **Twilio Trial accounts can only call verified phone numbers.**
> Before a test call works, go to your Twilio Console:
> **Console → Phone Numbers → Verified Caller IDs → Add a new number**
> Verify the Indian phone number you want to test with.

### Step 2: Configure ngrok with your account

```bash
ngrok config add-authtoken YOUR_NGROK_TOKEN
```
Get your token from: https://dashboard.ngrok.com/auth/your-authtoken

---

## Running the Project

### Terminal 1 — Install & Start Backend

```bash
cd /Users/rounakchadha/ai_call_agent/backend

# Install all dependencies
npm install

# Generate Prisma client and create SQLite database
npx prisma db push

# Start the development server (auto-restarts on file save)
npm run dev
```

You should see:
```
╔══════════════════════════════════════════╗
║     🏦 Finfinity Voice Agent — Ready     ║
╠══════════════════════════════════════════╣
║  Local:   http://localhost:3000          ║
║  Health:  http://localhost:3000/health   ║
╚══════════════════════════════════════════╝
```

### Terminal 2 — Start ngrok (HTTPS tunnel)

```bash
ngrok http 3000
```

You'll see output like:
```
Forwarding  https://abc123.ngrok.io -> http://localhost:3000
```

**Copy the `https://...ngrok.io` URL.**

Now update `backend/.env`:
```bash
BASE_URL=https://abc123.ngrok.io
```

**Restart the backend** (`Ctrl+C` in Terminal 1, then `npm run dev` again).

### Terminal 3 — Start n8n

```bash
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -v ~/.n8n:/home/node/.n8n \
  n8nio/n8n
```

Then:
1. Open **http://localhost:5678**
2. Create a free n8n account (local only)
3. Click **"+"** → **"Import from File"**
4. Select `n8n/workflow-finfinity-lead-intake.json`
5. Click **Import** → Toggle **Active** ON

---

## Making a Test Call

```bash
curl -X POST http://localhost:3000/api/call/start \
  -H "Content-Type: application/json" \
  -d '{"to": "+91XXXXXXXXXX"}'
```

Replace `+91XXXXXXXXXX` with your verified Indian phone number.

**Answer your phone** — the Finfinity agent will start speaking!

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/call/start` | Trigger outbound call `{ "to": "+91..." }` |
| `GET` | `/api/leads` | List all leads |
| `GET` | `/api/leads/:id` | Get a single lead |
| `POST` | `/api/leads` | Create lead manually |
| `POST` | `/api/rm/notify` | Re-trigger RM notification |
| `GET` | `/health` | Health check + env status |
| `POST` | `/twilio/voice` | ← Twilio webhook (auto-called) |
| `POST` | `/twilio/gather` | ← Twilio webhook (auto-called) |
| `POST` | `/twilio/status` | ← Twilio webhook (auto-called) |

---

## View Collected Leads

```bash
# List all leads
curl http://localhost:3000/api/leads

# Or open Prisma Studio GUI
cd backend && npx prisma studio
```

---

## Environment Variables

| Variable | What it is |
|---|---|
| `TWILIO_ACCOUNT_SID` | From Twilio Console → Account Info |
| `TWILIO_AUTH_TOKEN` | From Twilio Console → Account Info |
| `TWILIO_FROM_NUMBER` | Your Twilio trial phone number |
| `BASE_URL` | Your ngrok HTTPS URL (update after each ngrok restart) |
| `GROQ_API_KEY` | From console.groq.com (free) |
| `N8N_WEBHOOK_URL` | `http://localhost:5678/webhook/finfinity-lead` |
| `DATABASE_URL` | `file:./dev.db` (SQLite, auto-created) |
| `PORT` | `3000` |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Call placed but no speech | Check `BASE_URL` is set to ngrok URL and backend is restarted |
| "Unverified number" error | Verify phone number in Twilio Console first |
| n8n not receiving webhook | Make sure n8n workflow is **Active** (toggle in top right) |
| Groq returns `{}` | Check `GROQ_API_KEY` is valid at console.groq.com |
| Database error | Run `npx prisma db push` again in `backend/` folder |

---

## Next Steps

See `docs/improvements.md` for a full upgrade roadmap including:
- Redis session store
- PostgreSQL database  
- Real RM notifications (Slack, WhatsApp, Email)
- Streaming audio for faster responses
- Bulk outbound call campaigns
