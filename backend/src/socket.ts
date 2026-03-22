import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: Server;

export function initSocket(server: HttpServer) {
    io = new Server(server, {
        cors: {
            origin: '*', // Allow Vite frontend during development
            methods: ['GET', 'POST']
        }
    });

    io.on('connection', (socket) => {
        console.log(`[SOCKET] 🟢 Frontend client connected: ${socket.id}`);
        socket.on('disconnect', () => {
            console.log(`[SOCKET] 🔴 Frontend client disconnected: ${socket.id}`);
        });
    });

    return io;
}

// ── Agent call events ──────────────────────────────────────────
export function broadcastTranscription(callSid: string, role: string, content: string) {
    if (io) {
        io.emit('transcription_update', { callSid, role, content });
    }
}

export function broadcastCallStatus(callSid: string, status: string, leadData?: any) {
    if (io) {
        io.emit('call_status_update', { callSid, status, leadData });
    }
}

// ── RM call events ─────────────────────────────────────────────
export function broadcastRMCallStatus(callSid: string, status: string) {
    if (io) {
        io.emit('rm_call_status', { callSid, status });
    }
}

export function broadcastRMTranscription(callSid: string, role: string, content: string) {
    if (io) {
        io.emit('rm_transcription_update', { callSid, role, content });
    }
}

// ── Recording events ───────────────────────────────────────────
export function broadcastRecordingReady(data: {
    id: string;
    callSid: string;
    conferenceSid?: string;
    duration: number;
    createdAt: string;
}) {
    if (io) {
        io.emit('recording_ready', data);
    }
}

// ── Scheduled callback events ──────────────────────────────────
export function broadcastCallbackScheduled(data: {
    callSid: string;
    customerPhone: string;
    customerName?: string;
    scheduledTime: string;
    scheduledAt: string;
}) {
    if (io) {
        io.emit('callback_scheduled', data);
    }
}
