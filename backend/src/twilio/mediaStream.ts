// ============================================================
// mediaStream.ts — Twilio Media Stream WebSocket handler
//
// Flow:
// 1. Twilio calls <Start><Stream url="wss://..."> in TwiML
// 2. Twilio opens a WebSocket to /twilio/stream
// 3. We receive μ-law 8kHz audio chunks via WebSocket
// 4. Every 8s (or on call end), we decode to WAV and send
//    to Groq Whisper for transcription
// 5. We broadcast the transcription via socket.io
// ============================================================

import { WebSocket } from 'ws';
import { resolveCustomerSid } from './voiceRoutes';
import { broadcastRMTranscription } from '../socket';

// ── μ-law (G.711) → 16-bit linear PCM ────────────────────────
function buildMulawTable(): Int16Array {
    const table = new Int16Array(256);
    for (let i = 0; i < 256; i++) {
        const ulaw = ~i & 0xFF;
        const sign = ulaw & 0x80;
        const exponent = (ulaw >> 4) & 0x07;
        const mantissa = ulaw & 0x0F;
        const sample = ((mantissa << 1) + 33) << (exponent + 2);
        table[i] = sign ? -sample : sample;
    }
    return table;
}
const MULAW_TABLE = buildMulawTable();

function mulawToLinear16(src: Buffer): Buffer {
    const out = Buffer.alloc(src.length * 2);
    for (let i = 0; i < src.length; i++) {
        out.writeInt16LE(MULAW_TABLE[src[i]], i * 2);
    }
    return out;
}

// ── Build a minimal PCM WAV file ──────────────────────────────
function buildWav(pcm: Buffer, sampleRate = 8000): Buffer {
    const hdr = Buffer.alloc(44);
    hdr.write('RIFF', 0, 'ascii');
    hdr.writeUInt32LE(36 + pcm.length, 4);
    hdr.write('WAVE', 8, 'ascii');
    hdr.write('fmt ', 12, 'ascii');
    hdr.writeUInt32LE(16, 16);               // PCM subchunk size
    hdr.writeUInt16LE(1, 20);               // AudioFormat = PCM
    hdr.writeUInt16LE(1, 22);               // NumChannels = mono
    hdr.writeUInt32LE(sampleRate, 24);
    hdr.writeUInt32LE(sampleRate * 2, 28);  // ByteRate
    hdr.writeUInt16LE(2, 32);               // BlockAlign
    hdr.writeUInt16LE(16, 34);              // BitsPerSample
    hdr.write('data', 36, 'ascii');
    hdr.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([hdr, pcm]);
}

// ── Groq Whisper transcription via OpenAI-compatible REST API ─
async function transcribeWithGroq(wav: Buffer): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return '';

    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', 'whisper-large-v3-turbo'); // Fast & free
    form.append('language', 'en');
    form.append('response_format', 'text');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Groq ${res.status}: ${body.slice(0, 200)}`);
    }

    return (await res.text()).trim();
}

// Constants for flush thresholds (8kHz μ-law = 1 byte/sample)
const MIN_BYTES_FOR_TRANSCRIPTION = 8000 * 2;  // 2 seconds minimum
const BYTES_PER_FLUSH = 8000 * 8;               // flush every ~8 seconds
const SILENCE_TIMEOUT_MS = 4000;               // flush if silent for 4s

// ── Main WebSocket handler ────────────────────────────────────
export function handleMediaStream(ws: WebSocket, params: URLSearchParams) {
    const confName = params.get('confName') || '';
    const participantParam = params.get('participant') || 'unknown';
    let callSid = '';
    // Role determined by callSid comparison once we receive the 'start' event.
    // Falls back to the URL param if the conference isn't registered yet.
    let role: 'user' | 'assistant' = participantParam === 'rm' ? 'assistant' : 'user';

    let chunks: Buffer[] = [];
    let totalBytes = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    async function flush() {
        if (totalBytes < MIN_BYTES_FOR_TRANSCRIPTION) {
            chunks = [];
            totalBytes = 0;
            return;
        }

        const mulaw = Buffer.concat(chunks);
        chunks = [];
        totalBytes = 0;

        try {
            const wav = buildWav(mulawToLinear16(mulaw));
            const text = await transcribeWithGroq(wav);
            if (!text) return;

            const customerSid = resolveCustomerSid(confName, callSid);
            broadcastRMTranscription(customerSid, role, text);
            console.log(`[STREAM] ${role === 'assistant' ? 'RM' : 'CUSTOMER'}: "${text}"`);
        } catch (err: any) {
            console.error('[STREAM] Transcription error:', err.message);
        }
    }

    function resetTimer() {
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(() => { flushTimer = null; flush(); }, SILENCE_TIMEOUT_MS);
    }

    ws.on('message', (raw: Buffer) => {
        let msg: any;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        switch (msg.event) {
            case 'start':
                callSid = msg.start.callSid;
                // Determine role by comparing this stream's callSid against the
                // registered customer callSid for this conference. This is more
                // reliable than the URL ?participant= param which can be unreliable.
                const knownCustomerSid = resolveCustomerSid(confName, '');
                if (knownCustomerSid) {
                    role = callSid === knownCustomerSid ? 'user' : 'assistant';
                }
                console.log(`[STREAM] Started — callSid: ${callSid}, role: ${role}, confName: ${confName}, paramWas: ${participantParam}`);
                break;

            case 'media': {
                const chunk = Buffer.from(msg.media.payload, 'base64');
                chunks.push(chunk);
                totalBytes += chunk.length;
                if (totalBytes >= BYTES_PER_FLUSH) {
                    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
                    flush();
                } else {
                    resetTimer();
                }
                break;
            }

            case 'stop':
                if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
                flush();
                console.log(`[STREAM] Stopped — participant: ${participantParam}`);
                break;
        }
    });

    ws.on('error', (err: Error) => console.error(`[STREAM] WS error (${participantParam}):`, err.message));

    ws.on('close', () => {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        if (totalBytes > 0) flush();
    });
}
