# Architecture — Finfinity Voice Agent

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      YOUR PHONE (Customer)                   │
└────────────────────────────┬────────────────────────────────┘
                             │  Outbound call placed
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                        TWILIO                                │
│  - Manages the phone call                                    │
│  - Converts speech → text (STT built into <Gather>)         │
│  - Plays TwiML audio responses (TTS built-in)               │
│  - POSTs transcripts to our webhooks                        │
└────────────────────────────┬────────────────────────────────┘
                             │  HTTPS webhooks via ngrok
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              FASTIFY BACKEND (Node.js + Express)            │
│                                                              │
│  POST /twilio/voice   → Start call, ask CONSENT             │
│  POST /twilio/gather  → Receive speech, advance state       │
│  POST /twilio/status  → Log call status changes             │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              STATE MACHINE (in-memory)               │   │
│  │  CONSENT → NAME → PHONE → CITY → PINCODE → ...     │   │
│  │  → CONFIRM → COMPLETE → END                         │   │
│  └──────────────────────────┬──────────────────────────┘   │
│                             │  Speech transcript              │
│                             ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         GROQ (Llama 3.3-70B) — Field Extraction     │   │
│  │  "I want a home loan for about 30 lakhs" →           │   │
│  │  { product_interest: "Home Loan",                    │   │
│  │    loan_amount_range: "20-50 Lakhs" }               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  POST /api/call/start → Place outbound call                │
│  GET  /api/leads      → List all leads                     │
│  POST /api/leads      → Create lead (from n8n or direct)  │
└──────────────┬─────────────────────┬───────────────────────┘
               │                     │
               ▼                     ▼
┌──────────────────┐    ┌────────────────────────────────┐
│   SQLite (DB)    │    │         n8n                    │
│  Lead records    │    │  1. Webhook Trigger             │
│  Prisma ORM      │    │  2. Shape Data                  │
│                  │    │  3. Persist Lead                │
└──────────────────┘    │  4. Route by Product            │
                        │  5. Notify RM (stub/Slack)      │
                        │  6. Respond 200                 │
                        └────────────────────────────────┘
```

## Component Responsibilities

| Component | File | Responsibility |
|---|---|---|
| State Machine | `agent/stateMachine.ts` | Track conversation progress, manage sessions |
| LLM Extraction | `agent/extract.ts` | Parse speech → structured JSON |
| Question Script | `agent/prompts.ts` | All spoken text and LLM prompts |
| TwiML Builder | `twilio/twiml.ts` | Build XML responses for Twilio |
| Call Handler | `twilio/voiceRoutes.ts` | Process webhooks, orchestrate flow |
| Lead CRUD | `leads/leadService.ts` | SQLite persistence via Prisma |
| RM Notify | `rm/rmNotify.ts` | Forward lead to n8n |

## Data Flow for One Call

```
1. POST /api/call/start { "to": "+91xxxxxxxxxx" }
2. Twilio calls the customer
3. Customer answers → Twilio POSTs to /twilio/voice
4. Server creates session, responds with CONSENT TwiML
5. Customer says "yes"
6. Twilio POSTs transcript to /twilio/gather
7. Server detects yes → advance to FULL_NAME state
8. Server responds with "May I have your full name?"
9. (Repeat steps 6-8 for each field)
10. After all fields: Server speaks recap
11. Customer confirms → Server creates Lead in SQLite
12. Server calls notifyRM() → POSTs to n8n
13. n8n persists, routes, notifies RM
14. Server plays farewell → Hangup
```
