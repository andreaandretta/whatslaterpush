# WhatsLater Admin Dashboard — Design Spec

## Goal

Single admin page `/admin?secret=...` replacing `/monitoring` with 4 sections: system health (6 checks + AI chatbot), business metrics, Stripe data, and alert history. Auto-refreshes every 5 minutes.

## Architecture

3 new files, 1 deleted:

| File | Responsibility |
|------|---------------|
| `app/api/admin/data/route.ts` | GET — returns JSON with system checks, business metrics, Stripe data, alerts |
| `app/api/admin/chat/route.ts` | POST — receives question, builds context from current data, calls Groq/OpenAI, returns answer |
| `app/admin/page.tsx` | Client component — 4 sections + chatbot, auto-refresh 5min, protected by secret |

**Deleted:** `app/monitoring/page.tsx` — replaced by `/admin`

**Kept:** `app/api/monitoring/health-check/route.ts` — cron-job.org continues calling it every 15min for checks and alerts.

`app/lib/monitoring.ts` unchanged — `runAllChecks()` called by both health-check (cron) and `/api/admin/data` (dashboard).

### Data Flow

```
cron-job.org (every 15min) → /api/monitoring/health-check → checks + alerts + upsert DB
Browser (every 5min)       → /api/admin/data → reads DB (checks, alerts, user_instances) + Stripe API
Browser (on demand)        → /api/admin/chat → context + Groq/OpenAI → answer
```

---

## API: `/api/admin/data`

GET endpoint protected by `MONITORING_SECRET` query param.

### Response Structure

```typescript
{
  system: CheckResult[],           // 6 checks from runAllChecks()
  business: {
    totalUsers: number,
    byPlan: { free: number, trial: number, personal: number, business: number },
    trialExpiring: { phone_number: string, trial_ends_at: string }[],
    trialChurned: { phone_number: string, trial_ends_at: string }[],
    mrr: number,                   // (personal_count * 4.99) + (business_count * 19.99)
    recentUsers: { phone_number: string, subscription_plan: string, connection_status: string, created_at: string }[],
  },
  stripe: {
    recentPayments: { amount: number, plan: string, date: string, status: string }[],
    activeSubscriptions: number,
    failedPayments: { amount: number, date: string, error: string }[],
    monthlyRevenue: number,
  },
  alerts: { check_name: string, status: string, message: string, channel: string, created_at: string }[],
}
```

### Business Queries (Supabase)

```sql
SELECT COUNT(*) FROM user_instances;

SELECT subscription_plan, COUNT(*) FROM user_instances GROUP BY subscription_plan;

SELECT phone_number, trial_ends_at FROM user_instances
WHERE subscription_plan = 'trial' AND trial_ends_at BETWEEN NOW() AND NOW() + INTERVAL '7 days';

SELECT phone_number, trial_ends_at FROM user_instances
WHERE subscription_plan = 'free' AND trial_ends_at IS NOT NULL AND trial_ends_at < NOW();

SELECT phone_number, subscription_plan, connection_status, trial_ends_at, created_at
FROM user_instances ORDER BY created_at DESC LIMIT 10;
```

### Stripe Queries (raw fetch, no SDK)

All calls use `Authorization: Bearer STRIPE_SECRET_KEY`. If `STRIPE_SECRET_KEY` is not set, the stripe block returns empty values without error.

- `GET /v1/charges?limit=10` — recent payments
- `GET /v1/subscriptions?status=active` — active subscription count
- `GET /v1/charges?created[gte]=month_start_unix` — monthly revenue
- `GET /v1/charges?limit=10&paid=false` — failed payments

### Alerts Query

```sql
SELECT * FROM monitoring_alerts ORDER BY created_at DESC LIMIT 20;
```

---

## API: `/api/admin/chat`

POST endpoint. Secret passed in JSON body.

### Request/Response

```typescript
// Request
{ secret: string, question: string }

// Response
{ answer: string }
```

### Flow

1. Validate secret
2. Fetch current data using shared logic (same functions as `/api/admin/data`, not HTTP call)
3. Build system prompt with data context
4. Call Groq (llama-3.3-70b) with OpenAI fallback — same pattern as `app/api/webhook/route.ts`
5. Return answer

### System Prompt

```
Sei l'assistente tecnico di WhatsLater. Rispondi SEMPRE in italiano semplice, mai tecnico.
Se non hai abbastanza dati per rispondere, dì "Non ho abbastanza dati per rispondere".

STATO SISTEMA ATTUALE:
{JSON dei 6 check con status e message}

DATI BUSINESS:
- Utenti totali: {n}
- Per piano: Free={n}, Trial={n}, Personal={n}, Business={n}
- MRR: €{n}
- Trial in scadenza (7gg): {lista telefoni}
- Trial scaduti non convertiti: {lista telefoni}

ULTIMI ALERT:
{ultimi 5 alert con timestamp e canale}

DATI STRIPE:
- Abbonamenti attivi: {n}
- Revenue mese: €{n}
- Pagamenti falliti recenti: {n}

Rispondi alla domanda dell'operatore in modo conciso e utile.
Se chiede cosa fare per risolvere un problema, dai istruzioni pratiche passo-passo.
```

### AI Provider Pattern

Same as webhook: Groq primary (`GROQ_API_KEY`, model `llama-3.3-70b-versatile`), OpenAI fallback (`OPENAI_API_KEY`, model `gpt-4o-mini`). Raw fetch to provider APIs.

---

## UI: `/admin`

### Sections

**Section 1 — Sistema:** 6 check status cards (3x2 grid) with colored dots + chatbot input below.

**Section 2 — Business & Clienti:** 3 KPI cards (total users, MRR, expiring trials) + plan distribution bars (CSS, no chart library) + trial expiring/churned lists + recent users table.

**Section 3 — Stripe:** 3 KPI cards (active subs, monthly revenue, failed payments) + recent payments table.

**Section 4 — Alert Recenti:** Last 20 alerts table (timestamp, check, status, channel, message).

### Styling

- Background: `bg-gray-50`, cards: `bg-white border border-gray-200 rounded-lg shadow-sm`
- KPI numbers: `text-3xl font-bold`
- Status dots: `bg-green-500` / `bg-yellow-500` / `bg-red-500`
- Trial expiring: `bg-yellow-50` background
- Trial churned: `bg-red-50` background
- Failed payments: red badge
- Mobile responsive: grid collapses to 1 column
- Plan distribution: CSS width bars, no chart library

### Auto-refresh

- `setInterval` every 300000ms (5 minutes)
- Fetches `/api/admin/data?secret=...`
- Green pulsing dot in header when active
- First load shows loading spinner

### Protection

- Secret read from URL `searchParams` on first render
- If missing or wrong (first fetch returns 401), redirect to `/`

### Chatbot UI

- Text input + "Chiedi" button at bottom of Section 1
- Shows last 5 Q&A pairs in session (local state, not persisted)
- Loading indicator during AI call
- Resets on page refresh

---

## Environment Variables

No new env vars needed. Uses existing:
- `MONITORING_SECRET` — auth for all admin endpoints
- `GROQ_API_KEY` — chatbot primary
- `OPENAI_API_KEY` — chatbot fallback
- `STRIPE_SECRET_KEY` — Stripe data (optional, graceful degradation)
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — DB queries

---

## Out of Scope

- No user authentication (secret-based only)
- No data export
- No charts (CSS bars only)
- No real-time websocket updates
- No chat history persistence
