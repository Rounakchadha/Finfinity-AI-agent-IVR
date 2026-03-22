// ============================================================
// voiceRoutes.ts — The LLM-driven Twilio webhook handlers
// This is the core call flow controller.
//
// FLOW:
// 1. POST /twilio/voice   → call connected, LLM generates greeting
// 2. POST /twilio/gather  → user spoke, send to LLM, speak reply
//    ↳ If rm_intent=now  → bridge call into Conference + dial RM
//    ↳ If rm_intent=later → schedule callback entry
// 3. POST /twilio/rm-join   → TwiML for the RM's call leg (joins Conference)
// 4. POST /twilio/rm-status → status callback for RM call leg
// 5. POST /twilio/status  → call ended, log it
// ============================================================

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import {
    createSession,
    getSession,
    addMessage,
    updateCollectedData,
    SessionState,
} from '../agent/stateMachine';
import { generateAgentReply } from '../agent/agentChat';
import { buildGatherTwiML, buildSayTwiML } from './twiml';
import { createLead } from '../leads/leadService';
import { notifyRM } from '../rm/rmNotify';
import {
    broadcastTranscription,
    broadcastCallStatus,
    broadcastRMCallStatus,
    broadcastCallbackScheduled,
    broadcastRMTranscription,
    broadcastRecordingReady,
} from '../socket';

export const voiceRouter = Router();

// Log files for local backup
const LOG_FILE = path.join(process.cwd(), 'leads_log.json');
const CALLBACKS_FILE = path.join(process.cwd(), 'scheduled_callbacks.json');
const RECORDINGS_FILE = path.join(process.cwd(), 'recordings.json');

// Maps our internal conference name → customer call SID so that
// RM-side transcription callbacks can broadcast on the right callSid.
const confToCustomerSid = new Map<string, string>();

/** Register a conference so RM transcription can be attributed to the right call. */
export function registerConference(confName: string, customerCallSid: string) {
    confToCustomerSid.set(confName, customerCallSid);
}

/** Resolve a confName to the customer's callSid for broadcasting. */
export function resolveCustomerSid(confName: string, fallback: string): string {
    if (confName.startsWith('conf-')) return confName.slice(5); // conf-{callSid}
    return confToCustomerSid.get(confName) || fallback;
}

// Helper to always get the latest BASE_URL (set after ngrok starts)
const BASE_URL = (): string => process.env.BASE_URL || 'http://localhost:3000';

// Build the WSS URL for Twilio Media Streams
// Twilio requires wss:// for stream WebSocket connections
const streamUrl = (confName: string, participant: string): string => {
    const wssBase = BASE_URL().replace(/^https/, 'wss').replace(/^http(?!s)/, 'ws');
    return `${wssBase}/twilio/stream?confName=${encodeURIComponent(confName)}&participant=${participant}&ngrok-skip-browser-warning=true`;
};

// ─────────────────────────────────────────────────────────────
// POST /twilio/voice
// Twilio calls this when the customer picks up.
// ─────────────────────────────────────────────────────────────
voiceRouter.post('/voice', async (req: Request, res: Response) => {
    const callSid: string = req.body.CallSid;

    const direction: string = req.body.Direction || 'outbound-api';
    const customerPhone: string = direction === 'inbound' ? req.body.From : req.body.To;

    console.log(`\n[VOICE] 📞 Call connected — Direction: ${direction}, CallSid: ${callSid}, Customer: ${customerPhone}`);

    // Create a fresh session for this call
    const session = createSession(callSid, customerPhone);

    res.type('text/xml');

    // To kick off the conversation, we simulate the user saying "Hello"
    const initialText = 'Hello, I just picked up the phone.';
    addMessage(session, 'user', initialText);
    broadcastTranscription(callSid, 'user', initialText);
    broadcastCallStatus(callSid, 'in-progress');

    try {
        const llmResponse = await generateAgentReply(session.messages);

        // Save the LLM's reply into the transcript
        addMessage(session, 'assistant', llmResponse.agent_reply);
        broadcastTranscription(callSid, 'assistant', llmResponse.agent_reply);

        // Speak the LLM's dynamically generated greeting
        return res.send(buildGatherTwiML(llmResponse.agent_reply, BASE_URL()));
    } catch (error: any) {
        console.error('[VOICE] ❌ LLM Error:', error.message);
        broadcastCallStatus(callSid, 'failed');
        return res.send(buildSayTwiML('I am currently experiencing technical difficulties. Please try calling back later. Goodbye.'));
    }
});

// ─────────────────────────────────────────────────────────────
// POST /twilio/gather
// Twilio calls this after the caller finishes speaking.
// We append speech to transcript, hit Groq, and return the reply.
// ─────────────────────────────────────────────────────────────
voiceRouter.post('/gather', async (req: Request, res: Response) => {
    const callSid: string = req.body.CallSid;
    // DTMF digits take priority over speech — user can type phone number on keypad
    const dtmfDigits: string = (req.body.Digits || '').replace(/[^0-9]/g, '');
    const speechResult: string = dtmfDigits.length === 10
        ? dtmfDigits  // Use keypad digits as the "speech" input
        : (req.body.SpeechResult || '').trim();
    const isRetry = req.query.retry === 'true';

    console.log(`[GATHER] CallSid: ${callSid}`);
    console.log(`[GATHER] 🗣️  Speech: "${speechResult}" | DTMF: "${dtmfDigits}" | Retry: ${isRetry}`);

    res.type('text/xml');

    // ── Session lookup ──────────────────────────────────────────
    const session = getSession(callSid);
    if (!session) {
        console.error(`[GATHER] ❌ No session for CallSid: ${callSid}`);
        return res.send(buildSayTwiML(
            'We encountered a technical issue. Please try calling back. Thank you.'
        ));
    }

    // ── Handle empty speech ─────────────────────────────────────
    if (!speechResult) {
        if (isRetry) {
            // Second failure — end gracefully instead of looping
            console.log(`[GATHER] Empty speech on retry — ending call gracefully`);
            return res.send(buildSayTwiML(
                "I'm having trouble hearing you. Please try calling back at your convenience. Thank you for contacting Finfinity. Goodbye."
            ));
        }
        // First failure — one more chance via the TwiML fallback redirect
        console.log(`[GATHER] Empty speech received, will retry via TwiML fallback`);
        return res.send(buildGatherTwiML(`I didn't quite catch that. Could you say that again?`, BASE_URL()));
    }

    // Add user's exact speech to the session transcript
    addMessage(session, 'user', speechResult);
    broadcastTranscription(callSid, 'user', speechResult);

    // ── PHONE NUMBER PRE-EXTRACTION ──────────────────────────────
    // Only inject [INFO] when exactly 10 digits found — let LLM handle all other cases naturally.
    if (!session.collectedData.phone) {
        const rawDigits = speechResult.replace(/[^\d]/g, '');
        const digits = rawDigits.length === 12 && rawDigits.startsWith('91')
            ? rawDigits.slice(2)
            : rawDigits;

        if (digits.length === 10) {
            console.log(`[GATHER] ✅ Phone pre-extracted: ${digits}`);
            addMessage(session, 'system' as any, `[INFO: The customer's phone number has been automatically extracted and validated as: ${digits}. This is exactly 10 digits. Accept it as the phone number and move to the next question.]`);
        }
    }

    try {
        const llmResponse = await generateAgentReply(session.messages);

        // Merge any newly collected data
        if (llmResponse.collected_fields) {
            console.log(`[EXTRACT] Extracted Data: ${JSON.stringify(llmResponse.collected_fields)}`);
            updateCollectedData(session, llmResponse.collected_fields);
        }

        // Save the Agent's reply to the transcript
        addMessage(session, 'assistant', llmResponse.agent_reply);
        broadcastTranscription(callSid, 'assistant', llmResponse.agent_reply);

        // ── CHECK FOR RM INTENT ──────────────────────────────────
        if (llmResponse.rm_intent === 'now') {
            console.log(`[GATHER] 🔗 RM connect intent: NOW — bridging call to Conference`);
            return await handleConnectRMNow(session, res);
        }

        if (llmResponse.rm_intent === 'later') {
            console.log(`[GATHER] 📅 RM connect intent: LATER — scheduling callback for: ${llmResponse.scheduled_time}`);
            await scheduleRMCallback(session, llmResponse.scheduled_time || 'as soon as possible');
            // Agent already replied with confirmation — keep the call going
            return res.send(buildGatherTwiML(llmResponse.agent_reply, BASE_URL()));
        }

        // ── FINAL CONFIRMATION CHECK ────────────────────────────
        if (llmResponse.agent_reply.toUpperCase().includes('CONFIRMED')) {
            console.log(`[GATHER] 🎯 "CONFIRMED" detected. Completing call...`);
            session.isComplete = true;
            return await handleComplete(session, res);
        }

        // ── Send back the conversational reply ────────────────────
        return res.send(buildGatherTwiML(llmResponse.agent_reply, BASE_URL()));
    } catch (error: any) {
        console.error('[GATHER] ❌ LLM Error:', error.message);
        broadcastCallStatus(callSid, 'failed');
        return res.send(buildSayTwiML('I am sorry, but I encountered a connection issue. We will reach out to you shortly. Goodbye.'));
    }
});

// ─────────────────────────────────────────────────────────────
// POST /twilio/rm-join
// TwiML endpoint for the RM's call leg — joins the Conference room.
// Query param: confName (the conference room name)
// ─────────────────────────────────────────────────────────────
voiceRouter.post('/rm-join', (req: Request, res: Response) => {
    const confName = (req.query.confName as string) || req.body.confName || 'conf-unknown';
    console.log(`[RM-JOIN] 🤝 RM joining Conference: ${confName}`);

    const response = new twilio.twiml.VoiceResponse();
    response.say({ voice: 'Polly.Aditi' }, 'You are now connected to the customer. The AI agent has stepped off. Good luck!');
    response.start().stream({ url: streamUrl(confName, 'rm') });
    response.dial().conference({
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical',
        statusCallback: `${BASE_URL()}/twilio/rm-status?ngrok-skip-browser-warning=true`,
        statusCallbackEvent: ['start', 'end', 'join', 'leave'],
        statusCallbackMethod: 'POST',
        record: 'record-from-start',
        recordingStatusCallback: `${BASE_URL()}/twilio/recording-status?confName=${encodeURIComponent(confName)}&ngrok-skip-browser-warning=true`,
        recordingStatusCallbackMethod: 'POST',
        recordingStatusCallbackEvent: ['completed'],
    }, confName);

    res.type('text/xml').send(response.toString());
});


// ─────────────────────────────────────────────────────────────
// POST /twilio/direct-join
// TwiML for BOTH legs in a direct RM call (no AI agent).
// participant=customer → waits for RM to join
// participant=rm → starts the conference
// ─────────────────────────────────────────────────────────────
voiceRouter.post('/direct-join', (req: Request, res: Response) => {
    const confName = (req.query.confName as string) || req.body.confName || 'direct-unknown';
    const participant = (req.query.participant as string) || 'customer';

    console.log(`[DIRECT-JOIN] 🤝 ${participant.toUpperCase()} joining Conference: ${confName}`);

    const isRM = participant === 'rm';

    const response = new twilio.twiml.VoiceResponse();
    response.say(
        { voice: 'Polly.Aditi' },
        isRM
            ? 'You are being connected directly to the customer. Please wait a moment.'
            : 'Connecting you to our Relationship Manager right now. Please hold for a moment.'
    );
    response.start().stream({ url: streamUrl(confName, participant) });

    // Customer side sets the recording config — they start the conference first,
    // so their TwiML is what registers the recordingStatusCallback with Twilio.
    // RM side also sets it as a backup (Twilio deduplicates at conference level).
    const recordingCfg = {
        record: 'record-from-start' as const,
        recordingStatusCallback: `${BASE_URL()}/twilio/recording-status?confName=${encodeURIComponent(confName)}`,
        recordingStatusCallbackMethod: 'POST' as const,
        recordingStatusCallbackEvent: ['completed' as const],
    };

    response.dial().conference({
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical',
        beep: 'false',
        ...recordingCfg,
    }, confName);

    res.type('text/xml').send(response.toString());
});



// ─────────────────────────────────────────────────────────────
// POST /twilio/rm-status
// Status callback for the RM call leg events (join, leave, end).
// ─────────────────────────────────────────────────────────────
voiceRouter.post('/rm-status', (req: Request, res: Response) => {
    const { CallSid, CallStatus, StatusCallbackEvent } = req.body;
    console.log(`[RM-STATUS] 📊 CallSid: ${CallSid} | Status: ${CallStatus} | Event: ${StatusCallbackEvent}`);

    // Map Twilio conference events to our UI statuses
    if (StatusCallbackEvent === 'participant-join' || CallStatus === 'in-progress') {
        broadcastRMCallStatus(CallSid, 'in-progress');
    } else if (StatusCallbackEvent === 'participant-leave' || CallStatus === 'completed') {
        broadcastRMCallStatus(CallSid, 'completed');
    }

    res.sendStatus(200);
});

// ─────────────────────────────────────────────────────────────
// POST /twilio/status
// Twilio calls this whenever the customer call status changes.
// ─────────────────────────────────────────────────────────────
voiceRouter.post('/status', (req: Request, res: Response) => {
    const { CallSid, CallStatus, Duration, To } = req.body;
    console.log(`[STATUS] 📊 CallSid: ${CallSid} | Status: ${CallStatus} | Duration: ${Duration || 0}s | To: ${To}`);
    broadcastCallStatus(CallSid, CallStatus);
    res.sendStatus(200);
});

// ─────────────────────────────────────────────────────────────
// POST /twilio/rm-transcription
// Receives real-time transcription events from Twilio <Start><Transcription>.
// Query params: confName, participant (customer|rm)
// ─────────────────────────────────────────────────────────────
voiceRouter.post('/rm-transcription', (req: Request, res: Response) => {
    const { TranscriptionEvent, TranscriptionText, CallSid } = req.body;
    const confName = (req.query.confName as string) || '';
    const participant = (req.query.participant as string) || 'unknown';

    if (TranscriptionEvent === 'transcription-content' && TranscriptionText?.trim()) {
        const customerSid = resolveCustomerSid(confName, CallSid);
        const role = participant === 'rm' ? 'assistant' : 'user';
        broadcastRMTranscription(customerSid, role, TranscriptionText.trim());
        console.log(`[RM-TRANSCRIPT] ${participant.toUpperCase()}: "${TranscriptionText.trim()}"`);
    }

    res.sendStatus(200);
});

// ─────────────────────────────────────────────────────────────
// POST /twilio/recording-status
// Receives conference recording completion callbacks from Twilio.
// Query params: confName
// ─────────────────────────────────────────────────────────────
voiceRouter.post('/recording-status', (req: Request, res: Response) => {
    const { RecordingSid, RecordingStatus, RecordingDuration, CallSid, ConferenceSid } = req.body;
    const confName = (req.query.confName as string) || '';

    if (RecordingStatus === 'completed' && RecordingSid) {
        const customerSid = resolveCustomerSid(confName, CallSid);

        const recording = {
            id: RecordingSid,
            callSid: customerSid,
            conferenceSid: ConferenceSid || '',
            duration: parseInt(RecordingDuration || '0', 10),
            createdAt: new Date().toISOString(),
        };

        try {
            const existing: typeof recording[] = fs.existsSync(RECORDINGS_FILE)
                ? JSON.parse(fs.readFileSync(RECORDINGS_FILE, 'utf8'))
                : [];
            if (!existing.find(r => r.id === RecordingSid)) {
                existing.push(recording);
                fs.writeFileSync(RECORDINGS_FILE, JSON.stringify(existing, null, 2));
            }
        } catch (err) {
            console.error('[RECORDING] Failed to save:', err);
        }

        broadcastRecordingReady(recording);
        console.log(`[RECORDING] ✅ Saved: ${RecordingSid} (${recording.duration}s)`);
    }

    res.sendStatus(200);
});

// ─────────────────────────────────────────────────────────────
// handleConnectRMNow
// Bridges the customer's call into a Twilio Conference room and
// dials the RM as the second participant.
// ─────────────────────────────────────────────────────────────
async function handleConnectRMNow(session: SessionState, res: Response) {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, RM_PHONE_NUMBER, TWILIO_FROM_NUMBER } = process.env;

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !RM_PHONE_NUMBER || !TWILIO_FROM_NUMBER) {
        console.error('[RM-CONNECT] ❌ Missing Twilio or RM env vars');
        return res.send(buildGatherTwiML(
            "I'm sorry, I'm having trouble connecting you right now. Please try again shortly.",
            BASE_URL()
        ));
    }

    const confName = session.rmConferenceName || `conf-${session.callSid}`;
    session.rmConnectIntent = 'now';

    // 1. Broadcast "dialing" to frontend
    broadcastRMCallStatus(session.callSid, 'dialing');

    // 2. Build TwiML that moves the customer into the Conference room.
    //    <Start><Transcription> captures what the customer says.
    const customerResponse = new twilio.twiml.VoiceResponse();
    customerResponse.say({ voice: 'Polly.Aditi' }, 'Of course! Let me connect you to our Relationship Manager right away. Please hold for a moment while I transfer your call.');
    customerResponse.start().stream({ url: streamUrl(confName, 'customer') });
    customerResponse.dial().conference({
        startConferenceOnEnter: false,
        endConferenceOnExit: true,
        waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical',
        beep: 'false',
        record: 'record-from-start',
        recordingStatusCallback: `${BASE_URL()}/twilio/recording-status?confName=${encodeURIComponent(confName)}`,
        recordingStatusCallbackMethod: 'POST',
        recordingStatusCallbackEvent: ['completed'],
    }, confName);

    // 3. In parallel, dial the RM so they join the same Conference
    try {
        const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        const rmCallUrl = `${BASE_URL()}/twilio/rm-join?confName=${encodeURIComponent(confName)}&ngrok-skip-browser-warning=true`;

        const rmCall = await client.calls.create({
            to: RM_PHONE_NUMBER,
            from: TWILIO_FROM_NUMBER,
            url: rmCallUrl,
            method: 'POST',
            statusCallback: `${BASE_URL()}/twilio/rm-status?ngrok-skip-browser-warning=true`,
            statusCallbackMethod: 'POST',
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        });

        console.log(`[RM-CONNECT] ✅ RM call placed! CallSid: ${rmCall.sid} | To: ${RM_PHONE_NUMBER}`);
        broadcastRMCallStatus(session.callSid, 'dialing');
    } catch (err: any) {
        console.error('[RM-CONNECT] ❌ Failed to dial RM:', err.message);
        broadcastRMCallStatus(session.callSid, 'failed');
    }

    // 4. Return TwiML that moves the customer into the Conference room
    res.type('text/xml').send(customerResponse.toString());
}

// ─────────────────────────────────────────────────────────────
// scheduleRMCallback
// Logs a scheduled callback entry to a local JSON file and
// broadcasts it via socket so the frontend updates live.
// ─────────────────────────────────────────────────────────────
async function scheduleRMCallback(session: SessionState, scheduledTime: string) {
    session.rmConnectIntent = 'later';
    session.scheduledCallbackTime = scheduledTime;

    const entry = {
        id: `cb-${Date.now()}`,
        callSid: session.callSid,
        customerPhone: session.collectedData.phone || session.toNumber,
        customerName: session.collectedData.full_name || 'Unknown',
        scheduledTime,
        scheduledAt: new Date().toISOString(),
        status: 'pending',
    };

    // Persist to JSON file
    try {
        const existing = fs.existsSync(CALLBACKS_FILE)
            ? JSON.parse(fs.readFileSync(CALLBACKS_FILE, 'utf8'))
            : [];
        existing.push(entry);
        fs.writeFileSync(CALLBACKS_FILE, JSON.stringify(existing, null, 2));
        console.log(`[CALLBACK] 📅 Scheduled callback saved: ${JSON.stringify(entry)}`);
    } catch (err: any) {
        console.error('[CALLBACK] ❌ Failed to save callback:', err.message);
    }

    // Broadcast to frontend
    broadcastCallbackScheduled(entry);
}

// ─────────────────────────────────────────────────────────────
// handleComplete — Called when LLM outputs CONFIRMED.
// Creates the lead in DB and notifies RM via n8n.
// ─────────────────────────────────────────────────────────────
async function handleComplete(session: SessionState, res: Response) {
    try {
        console.log(`[COMPLETE] 🎯 Creating lead for CallSid: ${session.callSid}`);

        const transcript = session.messages
            .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
            .join('\n');

        const leadData = {
            callSid: session.callSid,
            phone: session.collectedData.phone || session.toNumber,
            ...session.collectedData,
            status: 'completed',
            raw_transcript: transcript,
        };

        // 1. Save to Prisma DB
        const lead = await createLead(leadData);
        console.log(`[COMPLETE] ✅ Lead created in Prisma: ${lead.id}`);

        broadcastCallStatus(session.callSid, 'completed', leadData);

        // 2. Save to local JSON log (Backup)
        try {
            const currentLogs = fs.existsSync(LOG_FILE)
                ? JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'))
                : [];
            currentLogs.push({ ...leadData, timestamp: new Date().toISOString() });
            fs.writeFileSync(LOG_FILE, JSON.stringify(currentLogs, null, 2));
            console.log(`[COMPLETE] 💾 Lead backed up to local log: ${LOG_FILE}`);
        } catch (logErr) {
            console.error('[COMPLETE] ❌ Failed to write local log:', logErr);
        }

        // 3. Notify RM via n8n 
        notifyRM(lead).catch((err) =>
            console.error('[RM NOTIFY] ❌', err.message)
        );

        return res.send(buildSayTwiML(
            `Perfect! Your loan enquiry has been successfully submitted. ` +
            `A relationship manager from Finfinity will contact you soon. ` +
            `Thank you for choosing Finfinity. Have a wonderful day. Goodbye!`
        ));
    } catch (err: any) {
        console.error('[COMPLETE] ❌ Error:', err.message);
        return res.send(buildSayTwiML(
            'Thank you for your time. Our team will be in touch shortly. Goodbye.'
        ));
    }
}
