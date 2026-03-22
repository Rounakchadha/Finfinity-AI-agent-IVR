// ============================================================
// rmNotify.ts — Sends lead data to the RM via n8n webhook
// WHY: We decouple the "notify RM" action from the call flow.
// n8n handles routing — Slack, email, CRM, WhatsApp — without
// changing backend code. Just update the n8n workflow.
//
// This is FIRE-AND-FORGET: if n8n is down, the lead is still
// saved in SQLite. The agent always says goodbye successfully.
// ============================================================

import axios from 'axios';

export async function notifyRM(lead: any): Promise<void> {
    const webhookUrl = process.env.N8N_WEBHOOK_URL;

    if (!webhookUrl) {
        console.warn('[RM NOTIFY] ⚠️  N8N_WEBHOOK_URL not set. Skipping RM notification.');
        return;
    }

    // Shape the payload clearly for n8n to process
    const payload = {
        event: 'new_lead',
        timestamp: new Date().toISOString(),
        source: 'finfinity-voice-agent',
        lead: {
            id: lead.id,
            callSid: lead.callSid,
            full_name: lead.full_name || 'Unknown',
            phone: lead.phone || 'Unknown',
            city: lead.city || 'Unknown',
            pincode: lead.pincode || '',
            product_interest: lead.product_interest || 'Unknown',
            loan_amount_range: lead.loan_amount_range || '',
            timeline: lead.timeline || '',
            employment_type: lead.employment_type || '',
            monthly_income: lead.monthly_income || '',
            callback_time: lead.callback_time || '',
            email: lead.email || '',
            status: lead.status || 'new',
            createdAt: lead.createdAt,
        },
        // A pre-formatted summary string for Slack/Email notifications
        summary: [
            `📋 *New Lead — ${lead.product_interest || 'Loan Enquiry'}*`,
            `👤 Name: ${lead.full_name || 'N/A'}`,
            `📱 Phone: ${lead.phone || 'N/A'}`,
            `📍 City: ${lead.city || 'N/A'} — ${lead.pincode || ''}`,
            `💰 Amount: ${lead.loan_amount_range || 'N/A'}`,
            `⏱  Timeline: ${lead.timeline || 'N/A'}`,
            `💼 Employment: ${lead.employment_type || 'N/A'}`,
            `📞 Callback: ${lead.callback_time || 'N/A'}`,
        ].join('\n'),
    };

    try {
        const response = await axios.post(webhookUrl, payload, {
            timeout: 10_000, // 10 second timeout — don't hold up the call
            headers: { 'Content-Type': 'application/json' },
        });
        console.log(`[RM NOTIFY] ✅ n8n webhook called. Status: ${response.status}`);
    } catch (err: any) {
        // Log but do NOT throw — call must complete regardless
        console.error(`[RM NOTIFY] ❌ Failed to notify n8n: ${err.message}`);
    }
}
