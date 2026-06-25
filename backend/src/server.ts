// ============================================================
// server.ts — Application entry point
// Sets up Express, mounts all routes, starts the server.
// WHY: Keeping this file thin means all business logic lives
// in the individual route/service files where it belongs.
// ============================================================

import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import twilio from 'twilio';

// Load env vars FIRST before importing anything that uses them
dotenv.config();

import { voiceRouter, registerConference } from './twilio/voiceRoutes';
import { leadRouter } from './leads/leadRoutes';
import { notifyRM } from './rm/rmNotify';
import { initSocket } from './socket';
import { WebSocketServer } from 'ws';
import { handleMediaStream } from './twilio/mediaStream';

const app = express();
const httpServer = createServer(app);
const PORT = parseInt(process.env.PORT || '3000', 10);

// Initialize Socket.IO
initSocket(httpServer);

// ── Twilio Media Stream WebSocket server ──────────────────────
// Uses prependListener so our handler fires BEFORE engine.io's,
// allowing us to intercept /twilio/stream upgrades cleanly.
// Engine.io ignores upgrades after they've been handled
// (socket.bytesWritten > 0 → its 1s destroy timer no-ops).
const mediaStreamWSS = new WebSocketServer({ noServer: true });

httpServer.prependListener('upgrade', (request, socket, head) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    if (url.pathname === '/twilio/stream') {
        mediaStreamWSS.handleUpgrade(request, socket as any, head, (ws: import('ws').WebSocket) => {
            handleMediaStream(ws, url.searchParams);
        });
    }
});

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
// morgan: HTTP request logger (shows method, url, status, time)
app.use(morgan('dev'));
// Twilio sends webhook data as URL-encoded form (not JSON)
app.use(express.urlencoded({ extended: false }));
// Also accept JSON (for /api/call/start and n8n callbacks)
app.use(express.json());

// ── Routes ───────────────────────────────────────────────────
app.use('/twilio', voiceRouter);   // Twilio webhooks
app.use('/api/leads', leadRouter); // Lead CRUD API

// ───────────────────────────────────────────────────────────
// POST /api/call/start — Trigger an outbound call
// Body: { "to": "+91xxxxxxxxxx" }
// HOW IT WORKS:
// 1. We tell Twilio to call the `to` number from our Twilio number
// 2. When the person answers, Twilio calls BASE_URL/twilio/voice
// 3. That starts the conversation (CONSENT → questions → CONFIRM)
// ───────────────────────────────────────────────────────────
app.post('/api/call/start', async (req, res) => {
    const { to } = req.body;

    if (!to) {
        return res.status(400).json({ error: 'Missing "to" phone number. Example: { "to": "+91xxxxxxxxxx" }' });
    }

    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, BASE_URL } = process.env;

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !BASE_URL) {
        return res.status(500).json({ error: 'Missing Twilio environment variables in .env' });
    }

    try {
        const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

        const call = await client.calls.create({
            to,
            from: TWILIO_FROM_NUMBER,
            url: `${BASE_URL}/twilio/voice?ngrok-skip-browser-warning=true`,               // Twilio calls this when answered
            method: 'POST',
            fallbackMethod: 'POST',
            statusCallback: `${BASE_URL}/twilio/status?ngrok-skip-browser-warning=true`,   // Twilio calls this on status changes
            statusCallbackMethod: 'POST',
            statusCallbackEvent: ['answered', 'completed'],
        });

        console.log(`\n[CALL] 🚀 Outbound call placed!`);
        console.log(`[CALL]    CallSid: ${call.sid}`);
        console.log(`[CALL]    To: ${to}`);
        console.log(`[CALL]    From: ${TWILIO_FROM_NUMBER}\n`);

        return res.json({
            success: true,
            callSid: call.sid,
            to,
            from: TWILIO_FROM_NUMBER,
            message: 'Call placed. Answer your phone — the agent will start speaking.',
        });
    } catch (err: any) {
        console.error('[CALL] ❌ Failed to place call:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ───────────────────────────────────────────────────────────
// POST /api/rm/notify — Manually trigger RM notification
// Useful for re-sending a lead notification or testing n8n
// ───────────────────────────────────────────────────────────
app.post('/api/rm/notify', async (req, res) => {
    try {
        await notifyRM(req.body);
        res.json({ success: true, message: 'RM notification sent to n8n' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ───────────────────────────────────────────────────────────
// POST /api/rm/direct-call
// Skips the AI agent entirely. Dials both the customer AND
// the RM into a shared Twilio Conference room so they speak
// directly with each other.
// Body: { "to": "+91xxxxxxxxxx" }
// ───────────────────────────────────────────────────────────
app.post('/api/rm/direct-call', async (req, res) => {
    const { to } = req.body;

    if (!to) {
        return res.status(400).json({ error: 'Missing "to" phone number' });
    }

    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, RM_PHONE_NUMBER, BASE_URL } = process.env;

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !RM_PHONE_NUMBER || !BASE_URL) {
        return res.status(500).json({ error: 'Missing required environment variables' });
    }

    const confName = `direct-rm-${Date.now()}`;
    const joinUrl = (participant: string) =>
        `${BASE_URL}/twilio/direct-join?confName=${encodeURIComponent(confName)}&participant=${participant}&ngrok-skip-browser-warning=true`;

    try {
        const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

        // Dial the customer — they join the Conference room
        const customerCall = await client.calls.create({
            to,
            from: TWILIO_FROM_NUMBER,
            url: joinUrl('customer'),
            method: 'POST',
            statusCallback: `${BASE_URL}/twilio/rm-status?ngrok-skip-browser-warning=true`,
            statusCallbackMethod: 'POST',
            statusCallbackEvent: ['answered', 'completed'],
        });

        // Dial the RM — they join the same Conference room
        const rmCall = await client.calls.create({
            to: RM_PHONE_NUMBER,
            from: TWILIO_FROM_NUMBER,
            url: joinUrl('rm'),
            method: 'POST',
            statusCallback: `${BASE_URL}/twilio/rm-status?ngrok-skip-browser-warning=true`,
            statusCallbackMethod: 'POST',
            statusCallbackEvent: ['answered', 'completed'],
        });

        // Register the mapping so RM-side transcription can be attributed to the customer's callSid
        registerConference(confName, customerCall.sid);

        console.log(`\n[DIRECT-CALL] 🔗 Conference: ${confName}`);
        console.log(`[DIRECT-CALL]    Customer CallSid: ${customerCall.sid} → ${to}`);
        console.log(`[DIRECT-CALL]    RM CallSid:       ${rmCall.sid} → ${RM_PHONE_NUMBER}\n`);

        // Broadcast to frontend
        const { broadcastRMCallStatus } = await import('./socket');
        broadcastRMCallStatus(customerCall.sid, 'dialing');

        return res.json({
            success: true,
            confName,
            customerCallSid: customerCall.sid,
            rmCallSid: rmCall.sid,
            message: 'Calling customer and RM. Both will be connected in a conference.',
        });
    } catch (err: any) {
        console.error('[DIRECT-CALL] ❌ Failed:', err.message, '| code:', err.code, '| status:', err.status, '| moreInfo:', err.moreInfo);
        return res.status(500).json({ error: err.message, code: err.code, moreInfo: err.moreInfo });
    }
});


// ───────────────────────────────────────────────────────────
// GET /api/callbacks — Return all scheduled RM callbacks
// ───────────────────────────────────────────────────────────
const CALLBACKS_FILE = path.join(process.cwd(), 'scheduled_callbacks.json');

app.get('/api/callbacks', (_req, res) => {
    try {
        const callbacks = fs.existsSync(CALLBACKS_FILE)
            ? JSON.parse(fs.readFileSync(CALLBACKS_FILE, 'utf8'))
            : [];
        // Return newest first
        res.json({ success: true, callbacks: callbacks.reverse() });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ───────────────────────────────────────────────────────────
// POST /api/callbacks — Manually schedule an RM callback
// Used by the "Schedule Callback" modal in the frontend
// ───────────────────────────────────────────────────────────
app.post('/api/callbacks', (req, res) => {
    const { callSid, customerPhone, customerName, scheduledTime } = req.body;

    if (!scheduledTime || !customerPhone) {
        return res.status(400).json({ error: 'Missing scheduledTime or customerPhone' });
    }

    const entry = {
        id: `cb-${Date.now()}`,
        callSid: callSid || 'manual',
        customerPhone,
        customerName: customerName || 'Unknown',
        scheduledTime,
        scheduledAt: new Date().toISOString(),
        status: 'pending',
    };

    try {
        const existing = fs.existsSync(CALLBACKS_FILE)
            ? JSON.parse(fs.readFileSync(CALLBACKS_FILE, 'utf8'))
            : [];
        existing.push(entry);
        fs.writeFileSync(CALLBACKS_FILE, JSON.stringify(existing, null, 2));
        res.json({ success: true, callback: entry });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});


// ───────────────────────────────────────────────────────────
// GET /api/recordings — Return all saved RM-customer recordings
// ───────────────────────────────────────────────────────────
const RECORDINGS_FILE = path.join(process.cwd(), 'recordings.json');

app.get('/api/recordings', (_req, res) => {
    try {
        const recordings = fs.existsSync(RECORDINGS_FILE)
            ? JSON.parse(fs.readFileSync(RECORDINGS_FILE, 'utf8'))
            : [];
        res.json({ success: true, recordings: recordings.reverse() });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ───────────────────────────────────────────────────────────
// GET /api/recordings/:sid/audio — Proxy a Twilio recording
// Twilio recording URLs require Basic Auth; this endpoint adds it.
// ───────────────────────────────────────────────────────────
app.get('/api/recordings/:sid/audio', async (req, res) => {
    const { sid } = req.params;
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
        return res.status(500).json({ error: 'Missing Twilio credentials' });
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${sid}.mp3`;
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

    try {
        const upstream = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
        if (!upstream.ok) {
            return res.status(upstream.status).json({ error: 'Recording not found' });
        }
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        // Stream audio bytes to client
        const { Readable } = await import('stream');
        Readable.fromWeb(upstream.body as any).pipe(res);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ── Twilio account diagnostic ─────────────────────────────────
// GET /api/debug/twilio — Shows raw Twilio API response to diagnose 403 errors
app.get('/api/debug/twilio', async (_req, res) => {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
        return res.status(500).json({ error: 'Missing credentials in .env' });
    }
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    try {
        const r = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}.json`,
            { headers: { Authorization: `Basic ${auth}` } }
        );
        const rawBody = await r.text();
        let parsed: any;
        try { parsed = JSON.parse(rawBody); } catch { parsed = rawBody; }
        return res.json({ httpStatus: r.status, body: parsed });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// ── Serve React frontend (production build) ───────────────────
const FRONTEND_DIST = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST));
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/twilio') || req.path.startsWith('/health')) {
            return next();
        }
        res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
}

// ── Health check ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'finfinity-voice-agent',
        timestamp: new Date().toISOString(),
        env: {
            BASE_URL: process.env.BASE_URL,
            TWILIO_FROM: process.env.TWILIO_FROM_NUMBER,
            N8N_WEBHOOK: process.env.N8N_WEBHOOK_URL,
        },
    });
});

// ── Start server ─────────────────────────────────────────────
httpServer.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║     🏦 Finfinity Voice Agent — Ready     ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Local:   http://localhost:${PORT}          ║`);
    console.log(`║  Health:  http://localhost:${PORT}/health   ║`);
    console.log(`║  BASE_URL: ${process.env.BASE_URL || '(not set — run ngrok)'}`.padEnd(44) + '║');
    console.log('╚══════════════════════════════════════════╝\n');
});

export default app;
