// ============================================================
// stateMachine.ts — Call Session & Transcript Manager
// WHY: We've upgraded from a strict State Machine to a dynamic
// Conversational LLM. This file now simply holds the current
// state of the conversation (the transcript) and the data
// the LLM has successfully extracted so far.
// ============================================================

export interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// All the data we want to collect from the customer
export interface CollectedData {
    full_name?: string;
    phone?: string;
    city?: string;
    pincode?: string;
    product_interest?: string;
    loan_amount_range?: string;
    timeline?: string;
    employment_type?: string;
    monthly_income?: string;
    callback_time?: string;
    email?: string;
    language_pref?: string;
}

// One session = one phone call
export interface SessionState {
    callSid: string;       // Unique ID Twilio gives each call
    toNumber: string;      // The phone number we called (or the customer's number for inbound)
    createdAt: Date;
    messages: Message[];   // The full conversation transcript
    collectedData: CollectedData;
    isComplete: boolean;   // Set to true when the LLM decides the form is finished
    // RM Connect state
    rmConnectIntent: 'now' | 'later' | null;  // Customer's preference for RM connection
    scheduledCallbackTime?: string;            // When RM should call back (if 'later')
    rmConferenceName?: string;                 // Twilio Conference room name for this call
}

// -----------------------------------------------------------
// SESSION STORE — In-memory Map: CallSid → SessionState
// -----------------------------------------------------------
const sessions = new Map<string, SessionState>();

// Auto-cleanup: remove sessions older than 30 minutes
setInterval(() => {
    const now = Date.now();
    for (const [sid, session] of sessions) {
        if (now - session.createdAt.getTime() > 30 * 60 * 1000) {
            sessions.delete(sid);
            console.log(`[SESSION] 🧹 Cleaned up expired session: ${sid}`);
        }
    }
}, 5 * 60 * 1000); // Run every 5 minutes

export function createSession(callSid: string, toNumber: string): SessionState {
    const session: SessionState = {
        callSid,
        toNumber,
        createdAt: new Date(),
        messages: [],
        collectedData: {},
        isComplete: false,
        rmConnectIntent: null,
        rmConferenceName: `conf-${callSid}`,
    };
    sessions.set(callSid, session);
    console.log(`[SESSION] ✅ Created: ${callSid}`);
    return session;
}

export function getSession(callSid: string): SessionState | undefined {
    return sessions.get(callSid);
}

export function deleteSession(callSid: string): void {
    sessions.delete(callSid);
    console.log(`[SESSION] 🗑️  Deleted: ${callSid}`);
}

/**
 * Append a new message to the session's conversation transcript.
 */
export function addMessage(session: SessionState, role: 'user' | 'assistant', content: string) {
    session.messages.push({ role, content });
}

/**
 * Update the session's collected data with newly extracted fields from the LLM.
 */
export function updateCollectedData(session: SessionState, newData: Partial<CollectedData>) {
    // Only merge defined values
    for (const [key, value] of Object.entries(newData)) {
        if (value !== undefined && value !== null && value !== '') {
            (session.collectedData as any)[key] = value;
        }
    }
}

// Build a spoken recap of everything collected (for logging or final confirmation)
export function buildRecap(data: CollectedData): string {
    const parts: string[] = [];
    if (data.full_name) parts.push(`Name: ${data.full_name}`);
    if (data.phone) parts.push(`Phone: ${data.phone}`);
    if (data.city) parts.push(`${data.city}`);
    if (data.pincode) parts.push(`Pincode ${data.pincode}`);
    if (data.product_interest) parts.push(`${data.product_interest}`);
    if (data.loan_amount_range) parts.push(`${data.loan_amount_range}`);
    if (data.timeline) parts.push(`needed ${data.timeline}`);
    if (data.employment_type) parts.push(`${data.employment_type}`);
    if (data.monthly_income) parts.push(`income ${data.monthly_income}`);
    if (data.callback_time) parts.push(`callback ${data.callback_time}`);
    if (data.email) parts.push(`email ${data.email}`);
    return parts.join(', ');
}
