// ============================================================
// leadService.ts — Database operations for Leads using Prisma
// WHY: All DB logic lives here so routes stay thin. If you
// ever switch from SQLite to Postgres, you only change this file.
// ============================================================

import { PrismaClient } from '@prisma/client';

// Prisma client is a singleton — one connection pool for the app
const prisma = new PrismaClient({
    log: ['error', 'warn'], // Log errors and warnings, not every query
});

export interface LeadInput {
    callSid: string;
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
    status?: string;
    raw_transcript?: string;
}

// Create a new lead record in SQLite
export async function createLead(data: LeadInput) {
    return prisma.lead.create({ data });
}

// Get a single lead by its internal ID
export async function getLeadById(id: string) {
    return prisma.lead.findUnique({ where: { id } });
}

// Get a lead by the Twilio CallSid (useful for looking up mid-call)
export async function getLeadByCallSid(callSid: string) {
    return prisma.lead.findUnique({ where: { callSid } });
}

// Update any fields on an existing lead
export async function updateLead(id: string, data: Partial<LeadInput>) {
    return prisma.lead.update({ where: { id }, data });
}

// Get all leads, newest first (for dashboard/admin views)
export async function getAllLeads() {
    return prisma.lead.findMany({
        orderBy: { createdAt: 'desc' },
    });
}
