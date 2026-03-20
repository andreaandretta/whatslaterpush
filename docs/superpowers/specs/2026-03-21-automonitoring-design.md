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

---

## The 6 Checks

| # | Name | Logic | Alert Threshold |
|---|------|-------|-----------------|
| 1 | `evolution_api` | `GET {EVOLUTION_API_URL}/instance/fetchInstances` with 8s timeout | Any error or timeout |
| 2 | `cron_stalled` | Query `scheduled_messages` where `status='pending' AND scheduled_at < NOW() - INTERVAL '25 hours'` | count > 0 |
| 3 | `webhook_inactive` | Query `scheduled_messages` for newest `created_at`. Alert if no records in last 12 hours AND there are `user_instances` with `connection_status='connected'` | No new messages + active instances |
| 4 | `supabase_down` | `SELECT 1 FROM user_instances LIMIT 1` | Any query error |
| 5 | `messages_stalled` | Query `scheduled_messages` where `status='sending' AND updated_at < NOW() - INTERVAL '10 minutes'` | count > 0 |
| 6 | `failed_spike` | Query `scheduled_messages` where `status='failed' AND updated_at > NOW() - INTERVAL '2 hours'` | count > 5 |

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
- Check 6: `warning` if count 6-10, `critical` if count > 10

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

- Before sending, query `monitoring_alerts` for last alert with same `check_name`
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
   - Upserts results into `monitoring_checks`
   - For each non-ok result: calls `sendAlert()` if not in cooldown
   - For each ok result that was previously non-ok: calls `sendRecovery()`
   - Returns JSON with all check results

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
