// ============================================================
// leadRoutes.ts — REST API for Leads
// Exposes endpoints for:
// - Creating leads (called by n8n or directly)
// - Fetching leads (for a future dashboard or RM portal)
// ============================================================

import { Router, Request, Response } from 'express';
import { createLead, getLeadById, getAllLeads } from './leadService';

export const leadRouter = Router();

// GET /api/leads — List all leads (no pagination for MVP)
// PRODUCTION UPGRADE: Add pagination, filtering by status/city/product
leadRouter.get('/', async (_req: Request, res: Response) => {
    try {
        const leads = await getAllLeads();
        res.json({ success: true, count: leads.length, leads });
    } catch (err: any) {
        console.error('[LEADS] GET / error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/leads/:id — Get a single lead by ID
leadRouter.get('/:id', async (req: Request, res: Response) => {
    try {
        const lead = await getLeadById(req.params.id);
        if (!lead) return res.status(404).json({ error: 'Lead not found' });
        res.json({ success: true, lead });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/leads — Create a lead manually or from n8n
// n8n calls this endpoint after receiving the webhook from the agent
leadRouter.post('/', async (req: Request, res: Response) => {
    try {
        const lead = await createLead(req.body);
        console.log(`[LEADS] ✅ Lead created via API: ${lead.id}`);
        res.status(201).json({ success: true, lead });
    } catch (err: any) {
        console.error('[LEADS] POST / error:', err.message);
        res.status(400).json({ error: err.message });
    }
});
