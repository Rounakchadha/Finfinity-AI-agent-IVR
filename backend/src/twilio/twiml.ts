// ============================================================
// twiml.ts — TwiML (Twilio Markup Language) builder helpers
// WHY: TwiML is XML that tells Twilio what to do on a call.
// <Say> speaks text, <Gather> listens for speech, <Hangup> ends.
// We centralise all TwiML building here so voiceRoutes.ts stays
// clean and readable.
// ============================================================

// Using Polly.Kajal-Neural — Premium Twilio native neuronal Indian English female voice
// Alternatives: 'alice' (Twilio default US), 'Polly.Aditi' (Standard Indian English)
const VOICE = 'Polly.Kajal-Neural';

/**
 * buildGatherTwiML — Speak a question and wait for speech input.
 *
 * HOW IT WORKS:
 * 1. <Say> speaks the question to the caller
 * 2. <Gather input="speech"> starts listening
 * 3. When the caller pauses, Twilio POSTs the transcript to /twilio/gather
 * 4. speechTimeout="auto" = Twilio decides when caller finished speaking
 * 5. timeout="10" = if no speech for 10s, give up and use the fallback
 */
export function buildGatherTwiML(message: string, baseUrl: string): string {
  const safe = sanitize(message);
  const bypass = baseUrl.includes('ngrok') ? '?ngrok-skip-browser-warning=true' : '';
  const retryBypass = baseUrl.includes('ngrok') ? '&amp;ngrok-skip-browser-warning=true' : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf speech" action="${baseUrl}/twilio/gather${bypass}" method="POST" speechTimeout="3" timeout="10" language="en-IN" numDigits="10" hints="zero,one,two,three,four,five,six,seven,eight,nine,0,1,2,3,4,5,6,7,8,9">
    <Say voice="${VOICE}">${safe}</Say>
  </Gather>
  <!-- Fallback if no speech detected: give one more chance -->
  <Say voice="${VOICE}">I didn't catch that. Could you say that again?</Say>
  <Redirect method="POST">${baseUrl}/twilio/gather?retry=true${retryBypass}</Redirect>
</Response>`;
}

/**
 * buildSayTwiML — Speak a final message and hang up.
 * Used for: farewell, consent refused, error messages.
 */
export function buildSayTwiML(message: string): string {
  const safe = sanitize(message);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">${safe}</Say>
  <Hangup/>
</Response>`;
}

/**
 * buildPauseTwiML — Speak, pause briefly, then gather.
 * Used after CONFIRM to give user time to process the recap.
 */
export function buildPauseThenGatherTwiML(message: string, baseUrl: string): string {
  const safe = sanitize(message);
  const bypass = baseUrl.includes('ngrok') ? '?ngrok-skip-browser-warning=true' : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${baseUrl}/twilio/gather${bypass}" method="POST" speechTimeout="auto" timeout="15" language="en-IN">
    <Say voice="${VOICE}">${safe}</Say>
    <Pause length="1"/>
  </Gather>
  <Say voice="${VOICE}">I didn't get your response. Our team will contact you shortly.</Say>
  <Hangup/>
</Response>`;
}

// Sanitize text to prevent XML injection (& < > must be escaped in XML)
function sanitize(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
