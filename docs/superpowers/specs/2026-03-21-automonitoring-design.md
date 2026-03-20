# WhatsLater Automonitoring System — Design Spec

## Goal

Automatically detect system failures (Evolution API, cron, webhooks, database, message delivery) and alert the operator via WhatsApp with email fallback, without manual checking.

## Architecture

Single endpoint `/api/monitoring/health-check` runs 6 checks every 15 minutes (via cron-job.org). Alerts cascade: WhatsApp → Email (Resend) → DB log. A dashboard at `/monitoring` shows real-time status. Both protected by `MONITORING_SECRET` env var.

## Tech Stack

- Next.js 14 API routes (existing)
- Supabase (existing) — 2 new tables
- Evolution API (existing) — for WhatsApp alerts
- Resend (new) — email fallback, free tier, no SDK (raw fetch)
- cron-job.org (existing) — 15-minute schedule

---

## Alert Recipient

- **WhatsApp:** 393442582226 (operator's personal number)
- **Email:** musicizthekey@gmail.com (Resend fallback)

## Environment Variables (new)

- `MONITORING_SECRET` — query param auth for health-check and dashboard
- `RESEND_API_KEY` — Resend API key for email fallback

## WhatsApp Alert Instance

Alerts are sent using the operator's own instance. To find it:

```sql
SELECT instance_name FROM user_instances WHERE owner_phone = '393442582226' LIMIT 1;
```

The `sendAlert` function queries this at runtime — no hardcoded instance name needed. Uses the existing `EVOLUTION_API_URL` and `EVOLUTION_API_KEY` env vars.

---

## The 6 Checks

Each check runs inside its own try/catch — a single check failure must not prevent remaining checks from executing.

### Check 1: `evolution_api`

```typescript
// GET with 8s timeout + EVOLUTION_API_KEY header
const res = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
  headers: { apikey: EVOLUTION_API_KEY },
  signal: AbortSignal.timeout(8000),
});
// critical if !res.ok or timeout
```

### Check 2: `cron_stalled`

```sql
SELECT COUNT(*) FROM scheduled_messages
WHERE status = 'pending' AND scheduled_at < NOW() - INTERVAL '25 hours';
-- critical if count > 0
```

### Check 3: `webhook_inactive`

```sql
-- Step 1: any active instances?
SELECT COUNT(*) FROM user_instances WHERE connection_status = 'open';
-- If 0 → ok (no active instances, nothing to monitor)

-- Step 2: newest message created
SELECT MAX(created_at) AS latest FROM scheduled_messages;
-- warning if latest < NOW() - INTERVAL '12 hours' AND active_count > 0
```

Note: `connection_status = 'open'` (not `'connected'`) — matches the value set in `app/api/connect/route.ts`.
The 12-hour threshold avoids false positives on quiet days/nights. The cron runs every 15 minutes so the operator will be alerted within 15 minutes after the 12-hour window passes.

### Check 4: `supabase_down`

```sql
SELECT 1 FROM user_instances LIMIT 1;
-- critical if query throws any error
```

### Check 5: `messages_stalled`

```sql
SELECT COUNT(*) FROM scheduled_messages
WHERE status = 'sending' AND updated_at < NOW() - INTERVAL '10 minutes';
-- critical if count > 0
```

### Check 6: `failed_spike`

```sql
SELECT COUNT(*) FROM scheduled_messages
WHERE status = 'failed' AND updated_at > NOW() - INTERVAL '2 hours';
-- warning if count 6-10, critical if count > 10, ok if count <= 5
```

### Check Result Structure

```typescript
interface CheckResult {
  name: string;
  status: 'ok' | 'warning' | 'critical';
  message: string;
  checked_at: string;
}
```

- Check 1, 4: `critical` on failure
- Check 2, 5: `critical` (messages not being delivered)
- Check 3: `warning` (possible issue, not confirmed)
- Check 6: `warning` if count 6-10, `critical` if count > 10, `ok` if <= 5

---

## Alert Cascade

```
Problem detected
  └→ Try WhatsApp (Evolution API → 393442582226)
       ├→ Success → log to monitoring_alerts (channel='whatsapp')
       └→ Fails → Try Email (Resend → musicizthekey@gmail.com)
            ├→ Success → log to monitoring_alerts (channel='email')
            └→ Fails → log to monitoring_alerts (channel='db_only')
```

### Anti-spam

- Before sending, query `monitoring_alerts` for last alert with same `check_name` AND `channel IN ('whatsapp', 'email')` (ignore `db_only` — operator never saw those)
- If last alert was sent less than **1 hour ago** → skip
- When status returns to `ok` → send **recovery** message and reset cooldown

### WhatsApp Alert Format

```
⚠️ WhatsLater Alert
━━━━━━━━━━━━━━━━
Problema: {check description}
Dettaglio: {message}
Ora: {timestamp Italian format}
━━━━━━━━━━━━━━━━
Controlla: whatslaterpush.vercel.app/monitoring?secret=...
```

### Recovery Format

```
✅ WhatsLater Risolto
━━━━━━━━━━━━━━━━
Risolto: {check description}
Ora: {timestamp Italian format}
```

### Email Format (Resend fallback)

- From: `onboarding@resend.dev` (Resend default, no custom domain needed)
- To: `musicizthekey@gmail.com`
- Subject: `⚠️ WhatsLater: {check_name} — {status}`
- Body: same content as WhatsApp message, plain text
- API: `POST https://api.resend.com/emails` with `Authorization: Bearer RESEND_API_KEY`
- No SDK — raw fetch call

---

## Database Tables (new)

### `monitoring_checks`

Stores latest status for each check (upserted on every run).

```sql
CREATE TABLE monitoring_checks (
  check_name TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  message TEXT,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `monitoring_alerts`

Historical log of all alerts sent.

```sql
CREATE TABLE monitoring_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  check_name TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  channel TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for anti-spam cooldown query (check_name + created_at)
CREATE INDEX idx_monitoring_alerts_cooldown ON monitoring_alerts (check_name, created_at DESC);
```

---

## Files

### New Files

1. **`app/lib/monitoring.ts`** — Shared logic:
   - `runAllChecks()` — executes all 6 checks, returns `CheckResult[]`
   - `sendAlert(check)` — cascade: WhatsApp → Email → DB log
   - `sendRecovery(check)` — sends recovery notification
   - `shouldAlert(checkName)` — anti-spam check (1 hour cooldown)
   - Individual check functions: `checkEvolutionApi()`, `checkCronStalled()`, etc.

2. **`app/api/monitoring/health-check/route.ts`** — GET endpoint:
   - Validates `MONITORING_SECRET`
   - Calls `runAllChecks()`
   - For each result: **read current row** from `monitoring_checks` (to get previous status), **then** upsert new result
   - For each non-ok result: calls `sendAlert()` if not in cooldown
   - For each ok result where **previous row** had non-ok status: calls `sendRecovery()`
   - Returns JSON with all check results
   - Important: read-before-upsert order is critical for recovery detection

3. **`app/monitoring/page.tsx`** — Dashboard:
   - Server component, reads `monitoring_checks` and last 20 `monitoring_alerts`
   - Protected by `secret` query param
   - Minimal styling, status indicators, alert history

### No Modified Files

This feature is entirely additive — no existing files need changes.

---

## Dashboard `/monitoring`

- **URL:** `/monitoring?secret=MONITORING_SECRET`
- **Protection:** Redirect to `/` if secret missing or wrong
- **Layout:** 6 status rows + last 20 alerts
- **Rendering:** Server-side (no client JS needed)
- **No auto-refresh** — manual page reload

---

## External Configuration

### cron-job.org

New cron job:
- URL: `https://whatslaterpush.vercel.app/api/monitoring/health-check?secret=MONITORING_SECRET`
- Schedule: every 15 minutes
- Method: GET

### Vercel Environment Variables

Add:
- `MONITORING_SECRET` — random string for auth
- `RESEND_API_KEY` — from Resend dashboard

### Resend Setup

1. Create free account at resend.com
2. Get API key
3. No domain verification needed (uses `onboarding@resend.dev` sender)

---

## Out of Scope

- No Vercel deployment monitoring (use Vercel native email notifications)
- No auto-remediation (alerts only, human fixes)
- No metrics aggregation or graphs
- No Slack/Telegram integration
- No custom Resend domain
