# Improvements — Finfinity Voice Agent

This document tracks production upgrades for each component.
The MVP is intentionally simple; here's how to level each part up.

## 🔴 Priority 1 — Do Before Going Live

### Session Storage
- **MVP**: In-memory Map (lost on server restart, single instance only)
- **Upgrade**: Replace with **Redis** (`ioredis`)
  - `sessions.set(callSid, session)` → `redis.setex(callSid, 1800, JSON.stringify(session))`
  - Handles multiple server instances, persists restarts

### Database
- **MVP**: SQLite (single file, no concurrency)
- **Upgrade**: **PostgreSQL** via Supabase (free tier) or Railway
  - Only change: `DATABASE_URL` in `.env` + `provider = "postgresql"` in schema.prisma

### Security
- **Add**: Twilio request signature validation
  - Use `twilio.validateRequest()` to verify webhooks are from Twilio
  - Prevents anyone from POSTing to your `/twilio/gather` endpoint

### Error Handling
- **Add**: Retry logic in `extract.ts` — if Groq returns `{}`, attempt LLM call once more
- **Add**: Fallback to keyword matching if Groq is unavailable

---

## 🟡 Priority 2 — Polish & UX

### Voice Quality
- **MVP**: `Polly.Aditi` (Indian English, decent quality)
- **Upgrade**: **ElevenLabs** voices — stream audio via `<Play>` + a TTS API
  - Dramatically more natural-sounding

### Interruption Handling
- Currently: Agent finishes speaking before listening
- **Upgrade**: Use Twilio's `<Gather>` `barge-in` feature so callers can interrupt

### Language Support
- Ask language preference in CONSENT → detect Hindi/English
- Maintain two question scripts in `prompts.ts`
- Language-specific Polly voices: `Polly.Aditi` (Hindi-accented EN), `Polly.Kajal` (Hindi)

### Multi-Turn Conversation Memory
- **MVP**: Simple field-by-field collection
- **Upgrade**: Store conversation transcript → use it for LLM-powered natural dialogue

---

## 🟢 Priority 3 — Analytics & Operations

### Call Recording
- Enable with Twilio's `record: true` in `calls.create()`
- Store recording URL in the Lead DB record

### Dashboard
- Build a simple Next.js dashboard to view all leads
- Filter by city, product, timeline, status

### RM Portal
- Build a page where RMs can mark leads as "contacted", "converted", "rejected"
- `PATCH /api/leads/:id { status: "contacted" }`

### Outbound Campaign
- **MVP**: One call at a time via `/api/call/start`
- **Upgrade**: Bulk upload CSV → queue calls with BullMQ + Redis
  - Rate limit to Twilio's concurrent call limit (trial: 1, paid: configurable)

### n8n Integrations to Add
- **Slack**: Notify `#leads` channel with summary message
- **WhatsApp**: Send lead summary to RM's phone
- **Google Sheets**: Append lead row to a spreadsheet CRM
- **HubSpot**: Create contact + deal automatically
- **Email**: Automated "thank you" email to the customer

---

## 🔵 Advanced — v2 Features

### Streaming Audio (Real-time)
- Replace TwiML `<Gather>` with Twilio Media Streams + WebSockets
- Use Deepgram for real-time STT (word-by-word transcript)
- Use ElevenLabs streaming TTS for zero-latency responses
- **Result**: Sub-1-second response time vs current ~3 seconds

### LLM-Powered Validation
- Detect when a user says something inconsistent (e.g., "I want ₹5 crore loan with ₹20K income")
- Politely flag and re-ask

### Sentiment Analysis
- Detect frustrated callers → flag lead as "urgent" for immediate RM callback
- Use a simple Groq call: "Is the customer frustrated? Yes/No"

### Voice Biometrics
- Verify the caller is the expected lead before data collection
