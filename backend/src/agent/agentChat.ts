// ============================================================
// agentChat.ts — The Conversational LLM Engine
// WHY: We send the entire conversation history to Groq (Llama 3)
// on every turn. The LLM decides what to say next AND extracts
// any loan data the user mentioned.
// ============================================================

import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { Message, CollectedData } from './stateMachine';
import { SYSTEM_PROMPT } from './prompts';

dotenv.config();

// Initialise Groq client once at module level
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface AgentResponse {
    agent_reply: string;
    collected_fields?: Partial<CollectedData>;
    rm_intent?: 'now' | 'later';    // Set when customer wants to speak to an RM
    scheduled_time?: string;         // Only when rm_intent === 'later'
}

// Core function: send the transcript to Groq, get back the reply and data
export async function generateAgentReply(
    transcript: Message[]
): Promise<AgentResponse> {
    try {
        // Construct the full message array for Groq
        const messagesToSend: any[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...transcript
        ];

        console.log(`[GROQ] 📤 Sending ${transcript.length} messages to Llama 3...`);

        const completion = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: messagesToSend,
            temperature: 0.3,    // Slight warmth for conversational tone, but strict enough for JSON
            max_tokens: 400,
            response_format: { type: 'json_object' }, // Force JSON output
        });

        const raw = completion.choices[0]?.message?.content || '{}';
        console.log(`[GROQ] 📥 Raw response:\n${raw}`);

        const parsed = JSON.parse(raw) as AgentResponse;

        // Fallback in case the LLM returned weird JSON keys
        if (!parsed.agent_reply) {
            parsed.agent_reply = "I'm sorry, I encountered a brief issue. Could you repeat that?";
        }

        return parsed;
    } catch (err: any) {
        console.error('[GROQ] ❌ Error:', err.message);
        return {
            agent_reply: "I'm having a little trouble hearing you. Could you please repeat that?",
        };
    }
}
