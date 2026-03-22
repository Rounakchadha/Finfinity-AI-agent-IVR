# n8n Workflow — Finfinity Lead Intake

## What This Workflow Does

When the voice agent completes a call, it POSTs the lead JSON to n8n. This workflow:

1. **Receives** the lead via webhook
2. **Reshapes** the data into clean fields
3. **Persists** the lead to your backend DB
4. **Routes** by product (Home Loan vs. others)
5. **Notifies** RM (logs to console for MVP — replace with Slack/Email)
6. **Responds** with success to the backend

---

## Import Steps

### 1. Start n8n via Docker

```bash
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -v ~/.n8n:/home/node/.n8n \
  n8nio/n8n
```

Then open: **http://localhost:5678**

### 2. Import the Workflow

1. In n8n, click **"+"** → **"Import from File"**
2. Select `workflow-finfinity-lead-intake.json`
3. Click **"Import"**

### 3. Activate the Workflow

- Toggle the **Active** switch in the top-right corner
- The webhook URL will be: `http://localhost:5678/webhook/finfinity-lead`

### 4. Update .env

```bash
N8N_WEBHOOK_URL=http://localhost:5678/webhook/finfinity-lead
```

---

## Testing the Workflow Without a Call

You can test n8n independently using curl:

```bash
curl -X POST http://localhost:5678/webhook/finfinity-lead \
  -H "Content-Type: application/json" \
  -d '{
    "event": "new_lead",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "lead": {
      "id": "test-001",
      "callSid": "CA_test",
      "full_name": "Rounak Chadha",
      "phone": "9876543210",
      "city": "Mumbai",
      "pincode": "400001",
      "product_interest": "Home Loan",
      "loan_amount_range": "20-50 Lakhs",
      "timeline": "This week",
      "employment_type": "Salaried",
      "monthly_income": "50K-1L",
      "callback_time": "Evening",
      "email": "rounak@example.com",
      "status": "new"
    },
    "summary": "New Home Loan enquiry from Rounak Chadha in Mumbai"
  }'
```

---

## Production Upgrades

To send real RM notifications, replace the **"Notify RM"** Function nodes with:

| Node Type | Use Case |
|---|---|
| Slack | Message a `#new-leads` channel |
| Gmail / SendGrid | Email to RM with lead summary |
| WhatsApp (Twilio) | WhatsApp message to RM's phone |
| HubSpot / Salesforce | Create a CRM contact/deal |
| Google Sheets | Append row to a leads spreadsheet |
