# WhatsLater Automonitoring Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automatic health monitoring system that detects failures and alerts the operator via WhatsApp with email fallback.

**Architecture:** Single GET endpoint `/api/monitoring/health-check` runs 6 checks, alerts via cascade (WhatsApp → Resend email → DB log), with anti-spam cooldown. Dashboard at `/monitoring` shows status. All protected by `MONITORING_SECRET` env var.

**Tech Stack:** Next.js 14, Supabase, Evolution API, Resend (raw fetch), cron-job.org

**Spec:** `docs/superpowers/specs/2026-03-21-automonitoring-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `app/lib/monitoring.ts` | All 6 check functions, alert cascade, anti-spam, recovery logic |
| `app/api/monitoring/health-check/route.ts` | GET endpoint: auth, orchestrate checks, upsert results, trigger alerts |
| `app/monitoring/page.tsx` | Server-rendered dashboard: status grid + alert history |
| `__tests__/monitoring.test.ts` | Unit tests for check logic, alert cascade, anti-spam |

---

## Chunk 1: Core Monitoring Library + Tests

### Task 1: Create monitoring library with check functions

**Files:**
- Create: `app/lib/monitoring.ts`

- [ ] **Step 1: Create `app/lib/monitoring.ts` with types and all 6 check functions**

```typescript
import { createClient } from '@supabase/supabase-js';

// --- Types ---

export interface CheckResult {
  name: string;
  status: 'ok' | 'warning' | 'critical';
  message: string;
  checked_at: string;
}

// --- Supabase client ---

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// --- Individual Checks ---

export async function checkEvolutionApi(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(
        `${process.env.EVOLUTION_API_URL}/instance/fetchInstances`,
        {
          headers: { apikey: process.env.EVOLUTION_API_KEY! },
          signal: controller.signal,
        }
      );
      if (!res.ok) {
        return { name: 'evolution_api', status: 'critical', message: `HTTP ${res.status}`, checked_at: now };
      }
      return { name: 'evolution_api', status: 'ok', message: 'Raggiungibile', checked_at: now };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    const msg = err?.name === 'AbortError' ? 'Timeout 8s' : (err?.message || 'Errore connessione');
    return { name: 'evolution_api', status: 'critical', message: msg, checked_at: now };
  }
}

export async function checkCronStalled(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const { count, error } = await supabase
      .from('scheduled_messages')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lt('scheduled_at', new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());
    if (error) return { name: 'cron_stalled', status: 'critical', message: `Query error: ${error.message}`, checked_at: now };
    if ((count ?? 0) > 0) return { name: 'cron_stalled', status: 'critical', message: `${count} messaggi pending da >25h`, checked_at: now };
    return { name: 'cron_stalled', status: 'ok', message: 'Nessun messaggio bloccato', checked_at: now };
  } catch (err: any) {
    return { name: 'cron_stalled', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

export async function checkWebhookInactive(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    // Step 1: any active instances?
    const { count: activeCount, error: e1 } = await supabase
      .from('user_instances')
      .select('id', { count: 'exact', head: true })
      .eq('connection_status', 'open');
    if (e1) return { name: 'webhook_inactive', status: 'critical', message: `Query error: ${e1.message}`, checked_at: now };
    if ((activeCount ?? 0) === 0) return { name: 'webhook_inactive', status: 'ok', message: 'Nessuna istanza attiva', checked_at: now };

    // Step 2: newest message
    const { data, error: e2 } = await supabase
      .from('scheduled_messages')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);
    if (e2) return { name: 'webhook_inactive', status: 'critical', message: `Query error: ${e2.message}`, checked_at: now };

    if (!data || data.length === 0) {
      return { name: 'webhook_inactive', status: 'warning', message: `Nessun messaggio nel DB con ${activeCount} istanze attive`, checked_at: now };
    }

    const latest = new Date(data[0].created_at).getTime();
    const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
    if (latest < twelveHoursAgo) {
      return { name: 'webhook_inactive', status: 'warning', message: `Ultimo messaggio ${new Date(data[0].created_at).toLocaleString('it-IT')} con ${activeCount} istanze attive`, checked_at: now };
    }
    return { name: 'webhook_inactive', status: 'ok', message: 'Webhook attivo', checked_at: now };
  } catch (err: any) {
    return { name: 'webhook_inactive', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

export async function checkSupabaseDown(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('user_instances').select('id').limit(1);
    if (error) return { name: 'supabase_down', status: 'critical', message: `DB error: ${error.message}`, checked_at: now };
    return { name: 'supabase_down', status: 'ok', message: 'Database raggiungibile', checked_at: now };
  } catch (err: any) {
    return { name: 'supabase_down', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

export async function checkMessagesStalled(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const { count, error } = await supabase
      .from('scheduled_messages')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sending')
      .lt('updated_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());
    if (error) return { name: 'messages_stalled', status: 'critical', message: `Query error: ${error.message}`, checked_at: now };
    if ((count ?? 0) > 0) return { name: 'messages_stalled', status: 'critical', message: `${count} messaggi bloccati in 'sending'`, checked_at: now };
    return { name: 'messages_stalled', status: 'ok', message: 'Nessun messaggio bloccato', checked_at: now };
  } catch (err: any) {
    return { name: 'messages_stalled', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

export async function checkFailedSpike(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const { count, error } = await supabase
      .from('scheduled_messages')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gt('updated_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
    if (error) return { name: 'failed_spike', status: 'critical', message: `Query error: ${error.message}`, checked_at: now };
    const c = count ?? 0;
    if (c > 10) return { name: 'failed_spike', status: 'critical', message: `${c} messaggi falliti nelle ultime 2h`, checked_at: now };
    if (c > 5) return { name: 'failed_spike', status: 'warning', message: `${c} messaggi falliti nelle ultime 2h`, checked_at: now };
    return { name: 'failed_spike', status: 'ok', message: `${c} falliti nelle ultime 2h`, checked_at: now };
  } catch (err: any) {
    return { name: 'failed_spike', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

// --- Run All Checks ---

export async function runAllChecks(): Promise<CheckResult[]> {
  const checks = [
    checkEvolutionApi,
    checkCronStalled,
    checkWebhookInactive,
    checkSupabaseDown,
    checkMessagesStalled,
    checkFailedSpike,
  ];
  const results: CheckResult[] = [];
  for (const checkFn of checks) {
    try {
      results.push(await checkFn());
    } catch (err: any) {
      results.push({
        name: checkFn.name.replace('check', '').replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, ''),
        status: 'critical',
        message: `Uncaught: ${err?.message || 'unknown'}`,
        checked_at: new Date().toISOString(),
      });
    }
  }
  return results;
}

// --- Anti-spam ---

export async function shouldAlert(checkName: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('monitoring_alerts')
      .select('created_at')
      .eq('check_name', checkName)
      .in('channel', ['whatsapp', 'email'])
      .order('created_at', { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return true;
    const lastAlert = new Date(data[0].created_at).getTime();
    return Date.now() - lastAlert > 60 * 60 * 1000; // 1 hour cooldown
  } catch {
    return true; // if we can't check, better to alert
  }
}

// --- Alert Cascade ---

const OPERATOR_PHONE = '393442582226';
const OPERATOR_EMAIL = 'musicizthekey@gmail.com';

const CHECK_DESCRIPTIONS: Record<string, string> = {
  evolution_api: 'Evolution API non raggiungibile',
  cron_stalled: 'Cron bloccato — messaggi pending da >25h',
  webhook_inactive: 'Webhook inattivo — nessun messaggio recente',
  supabase_down: 'Database Supabase non raggiungibile',
  messages_stalled: 'Messaggi bloccati in stato "sending"',
  failed_spike: 'Picco di messaggi falliti',
};

function formatItalianTime(): string {
  return new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
}

function buildAlertText(check: CheckResult): string {
  return `⚠️ WhatsLater Alert\n━━━━━━━━━━━━━━━━\nProblema: ${CHECK_DESCRIPTIONS[check.name] || check.name}\nDettaglio: ${check.message}\nOra: ${formatItalianTime()}\n━━━━━━━━━━━━━━━━\nControlla: whatslaterpush.vercel.app/monitoring?secret=...`;
}

function buildRecoveryText(check: CheckResult): string {
  return `✅ WhatsLater Risolto\n━━━━━━━━━━━━━━━━\nRisolto: ${CHECK_DESCRIPTIONS[check.name] || check.name}\nOra: ${formatItalianTime()}`;
}

async function getOperatorInstance(): Promise<string | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_instances')
      .select('instance_name')
      .eq('phone_number', OPERATOR_PHONE)
      .limit(1);
    if (error || !data || data.length === 0) return null;
    return data[0].instance_name;
  } catch {
    return null;
  }
}

async function sendWhatsApp(text: string): Promise<boolean> {
  try {
    const instanceName = await getOperatorInstance();
    if (!instanceName) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(
        `${process.env.EVOLUTION_API_URL}/message/sendText/${instanceName}`,
        {
          method: 'POST',
          headers: { apikey: process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: OPERATOR_PHONE, text }),
          signal: controller.signal,
        }
      );
      return res.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

async function sendEmail(check: CheckResult, text: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'onboarding@resend.dev',
        to: OPERATOR_EMAIL,
        subject: `⚠️ WhatsLater: ${check.name} — ${check.status}`,
        text,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function logAlert(check: CheckResult, channel: string): Promise<void> {
  try {
    const supabase = getSupabase();
    await supabase.from('monitoring_alerts').insert({
      check_name: check.name,
      status: check.status,
      message: check.message,
      channel,
    });
  } catch {
    console.error('Failed to log monitoring alert:', check.name);
  }
}

export async function sendAlert(check: CheckResult): Promise<void> {
  const text = buildAlertText(check);

  // Cascade: WhatsApp → Email → DB only
  if (await sendWhatsApp(text)) {
    await logAlert(check, 'whatsapp');
    return;
  }
  if (await sendEmail(check, text)) {
    await logAlert(check, 'email');
    return;
  }
  await logAlert(check, 'db_only');
}

export async function sendRecovery(check: CheckResult): Promise<void> {
  const text = buildRecoveryText(check);

  if (await sendWhatsApp(text)) {
    await logAlert({ ...check, status: 'ok' }, 'whatsapp');
    return;
  }
  if (await sendEmail({ ...check, status: 'ok' }, text)) {
    await logAlert({ ...check, status: 'ok' }, 'email');
    return;
  }
  await logAlert({ ...check, status: 'ok' }, 'db_only');
}
```

- [ ] **Step 2: Verify file was created correctly**

Run: `npx tsc --noEmit app/lib/monitoring.ts 2>&1 | head -5`
Expected: May show env var warnings but no syntax errors

- [ ] **Step 3: Commit**

```bash
git add app/lib/monitoring.ts
git commit -m "feat: add monitoring library with 6 checks and alert cascade"
```

---

### Task 2: Write unit tests for monitoring checks

**Files:**
- Create: `__tests__/monitoring.test.ts`

- [ ] **Step 1: Create `__tests__/monitoring.test.ts`**

```typescript
/**
 * Tests for app/lib/monitoring.ts
 * Mocks Supabase and fetch to test check logic, alert cascade, anti-spam.
 */

import { createMockSupabase, createFetchMock } from './helpers/mocks';

// Set up mocks BEFORE importing
const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const fetchMock = createFetchMock();

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'test-key',
    SUPABASE_URL: 'https://supa.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-role-key',
    RESEND_API_KEY: 'test-resend-key',
    MONITORING_SECRET: 'test-secret',
  };
  (global as any).fetch = fetchMock.mockFetch;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// Helper to import fresh module each test
async function getMonitoring() {
  return await import('../app/lib/monitoring');
}

// --- Check 1: Evolution API ---

describe('checkEvolutionApi', () => {
  test('returns ok when API responds 200', async () => {
    fetchMock.setJsonResponse('/instance/fetchInstances', [{ id: 1 }], 200);
    const { checkEvolutionApi } = await getMonitoring();
    const result = await checkEvolutionApi();
    expect(result.name).toBe('evolution_api');
    expect(result.status).toBe('ok');
  });

  test('returns critical when API responds 500', async () => {
    fetchMock.setJsonResponse('/instance/fetchInstances', { error: 'down' }, 500);
    const { checkEvolutionApi } = await getMonitoring();
    const result = await checkEvolutionApi();
    expect(result.status).toBe('critical');
    expect(result.message).toContain('500');
  });

  test('returns critical on fetch error', async () => {
    fetchMock.setHandler('/instance/fetchInstances', () => { throw new Error('Network error'); });
    const { checkEvolutionApi } = await getMonitoring();
    const result = await checkEvolutionApi();
    expect(result.status).toBe('critical');
    expect(result.message).toContain('Network error');
  });
});

// --- Check 2: Cron Stalled ---

describe('checkCronStalled', () => {
  test('returns ok when no stalled messages', async () => {
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 0 });
    const { checkCronStalled } = await getMonitoring();
    const result = await checkCronStalled();
    expect(result.status).toBe('ok');
  });

  test('returns critical when stalled messages exist', async () => {
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 3 });
    const { checkCronStalled } = await getMonitoring();
    const result = await checkCronStalled();
    expect(result.status).toBe('critical');
    expect(result.message).toContain('3');
  });
});

// --- Check 3: Webhook Inactive ---

describe('checkWebhookInactive', () => {
  test('returns ok when no active instances', async () => {
    mockSupa.setResponse('user_instances:select', null, null, { count: 0 });
    const { checkWebhookInactive } = await getMonitoring();
    const result = await checkWebhookInactive();
    expect(result.status).toBe('ok');
    expect(result.message).toContain('Nessuna istanza attiva');
  });

  test('returns ok when recent messages exist with active instances', async () => {
    mockSupa.setResponse('user_instances:select', null, null, { count: 2 });
    mockSupa.setResponse('scheduled_messages:select', [{ created_at: new Date().toISOString() }]);
    const { checkWebhookInactive } = await getMonitoring();
    const result = await checkWebhookInactive();
    expect(result.status).toBe('ok');
  });
});

// --- Check 4: Supabase Down ---

describe('checkSupabaseDown', () => {
  test('returns ok when query succeeds', async () => {
    mockSupa.setResponse('user_instances:select', [{ id: '1' }]);
    const { checkSupabaseDown } = await getMonitoring();
    const result = await checkSupabaseDown();
    expect(result.status).toBe('ok');
  });

  test('returns critical on query error', async () => {
    mockSupa.setResponse('user_instances:select', null, { message: 'connection refused' });
    const { checkSupabaseDown } = await getMonitoring();
    const result = await checkSupabaseDown();
    expect(result.status).toBe('critical');
    expect(result.message).toContain('connection refused');
  });
});

// --- Check 5: Messages Stalled ---

describe('checkMessagesStalled', () => {
  test('returns ok when no stalled messages', async () => {
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 0 });
    const { checkMessagesStalled } = await getMonitoring();
    const result = await checkMessagesStalled();
    expect(result.status).toBe('ok');
  });

  test('returns critical when messages stuck in sending', async () => {
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 2 });
    const { checkMessagesStalled } = await getMonitoring();
    const result = await checkMessagesStalled();
    expect(result.status).toBe('critical');
  });
});

// --- Check 6: Failed Spike ---

describe('checkFailedSpike', () => {
  test('returns ok when count <= 5', async () => {
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 3 });
    const { checkFailedSpike } = await getMonitoring();
    const result = await checkFailedSpike();
    expect(result.status).toBe('ok');
  });

  test('returns warning when count 6-10', async () => {
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 8 });
    const { checkFailedSpike } = await getMonitoring();
    const result = await checkFailedSpike();
    expect(result.status).toBe('warning');
  });

  test('returns critical when count > 10', async () => {
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 15 });
    const { checkFailedSpike } = await getMonitoring();
    const result = await checkFailedSpike();
    expect(result.status).toBe('critical');
  });
});

// --- runAllChecks ---

describe('runAllChecks', () => {
  test('returns 6 results', async () => {
    // Set up all mocks for a clean run
    fetchMock.setJsonResponse('/instance/fetchInstances', [{ id: 1 }], 200);
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 0 });
    mockSupa.setResponse('user_instances:select', [{ id: '1' }], null, { count: 0 });
    const { runAllChecks } = await getMonitoring();
    const results = await runAllChecks();
    expect(results).toHaveLength(6);
    results.forEach((r: any) => {
      expect(['ok', 'warning', 'critical']).toContain(r.status);
      expect(r.name).toBeTruthy();
    });
  });
});

// --- shouldAlert (anti-spam) ---

describe('shouldAlert', () => {
  test('returns true when no previous alerts', async () => {
    mockSupa.setResponse('monitoring_alerts:select', []);
    const { shouldAlert } = await getMonitoring();
    const result = await shouldAlert('evolution_api');
    expect(result).toBe(true);
  });

  test('returns false when alert was sent recently', async () => {
    mockSupa.setResponse('monitoring_alerts:select', [
      { created_at: new Date().toISOString() }, // just now
    ]);
    const { shouldAlert } = await getMonitoring();
    const result = await shouldAlert('evolution_api');
    expect(result).toBe(false);
  });

  test('returns true when last alert was >1h ago', async () => {
    mockSupa.setResponse('monitoring_alerts:select', [
      { created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }, // 2h ago
    ]);
    const { shouldAlert } = await getMonitoring();
    const result = await shouldAlert('evolution_api');
    expect(result).toBe(true);
  });
});

// --- Alert Cascade ---

describe('sendAlert', () => {
  test('sends WhatsApp first, logs whatsapp channel', async () => {
    // Mock: operator instance found
    mockSupa.setResponse('user_instances:select', [{ instance_name: 'SchedWhats-test' }]);
    // Mock: WhatsApp send succeeds
    fetchMock.setJsonResponse('/message/sendText/', { key: { id: '1' } }, 200);
    // Mock: alert insert
    mockSupa.setResponse('monitoring_alerts:insert', { id: '1' });

    const { sendAlert } = await getMonitoring();
    await sendAlert({ name: 'evolution_api', status: 'critical', message: 'down', checked_at: new Date().toISOString() });

    // Should have called sendText
    const sendTextCalls = fetchMock.calls.filter(c => c.url.includes('sendText'));
    expect(sendTextCalls.length).toBe(1);

    // Should have logged to monitoring_alerts
    const insertCalls = mockSupa.calls.filter(c => c.table === 'monitoring_alerts' && c.operation === 'insert');
    expect(insertCalls.length).toBe(1);
  });

  test('falls back to email when WhatsApp fails', async () => {
    // Mock: no operator instance found
    mockSupa.setResponse('user_instances:select', []);
    // Mock: Resend succeeds
    fetchMock.setJsonResponse('api.resend.com', { id: 'email-1' }, 200);
    // Mock: alert insert
    mockSupa.setResponse('monitoring_alerts:insert', { id: '1' });

    const { sendAlert } = await getMonitoring();
    await sendAlert({ name: 'supabase_down', status: 'critical', message: 'unreachable', checked_at: new Date().toISOString() });

    // Should have called Resend
    const resendCalls = fetchMock.calls.filter(c => c.url.includes('resend.com'));
    expect(resendCalls.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest __tests__/monitoring.test.ts --verbose`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add __tests__/monitoring.test.ts
git commit -m "test: add monitoring unit tests for checks and alert cascade"
```

---

## Chunk 2: Health Check Endpoint + Dashboard

### Task 3: Create health-check API route

**Files:**
- Create: `app/api/monitoring/health-check/route.ts`

- [ ] **Step 1: Create `app/api/monitoring/health-check/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runAllChecks, shouldAlert, sendAlert, sendRecovery, CheckResult } from '../../../lib/monitoring';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  // Auth
  const secret = new URL(req.url).searchParams.get('secret');
  if (!secret || secret !== process.env.MONITORING_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const results = await runAllChecks();

  for (const check of results) {
    // Read previous status BEFORE upserting
    const { data: prev } = await supabase
      .from('monitoring_checks')
      .select('status')
      .eq('check_name', check.name)
      .limit(1);

    const previousStatus = prev?.[0]?.status || null;

    // Upsert current result
    await supabase.from('monitoring_checks').upsert(
      {
        check_name: check.name,
        status: check.status,
        message: check.message,
        checked_at: check.checked_at,
      },
      { onConflict: 'check_name' }
    );

    // Alert logic
    if (check.status !== 'ok') {
      const canAlert = await shouldAlert(check.name);
      if (canAlert) {
        await sendAlert(check);
      }
    } else if (previousStatus && previousStatus !== 'ok') {
      // Recovery: was bad, now ok
      await sendRecovery(check);
    }
  }

  const hasIssues = results.some(r => r.status !== 'ok');
  return NextResponse.json(
    { status: hasIssues ? 'issues_detected' : 'all_ok', checks: results },
    { status: 200 }
  );
}
```

- [ ] **Step 2: Verify no syntax errors**

Run: `npx tsc --noEmit app/api/monitoring/health-check/route.ts 2>&1 | head -10`

- [ ] **Step 3: Commit**

```bash
git add app/api/monitoring/health-check/route.ts
git commit -m "feat: add /api/monitoring/health-check endpoint"
```

---

### Task 4: Create monitoring dashboard page

**Files:**
- Create: `app/monitoring/page.tsx`

- [ ] **Step 1: Create `app/monitoring/page.tsx`**

```tsx
import { createClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const STATUS_COLORS: Record<string, string> = {
  ok: 'bg-green-500',
  warning: 'bg-yellow-500',
  critical: 'bg-red-500',
};

const STATUS_TEXT: Record<string, string> = {
  ok: 'OK',
  warning: 'Attenzione',
  critical: 'Critico',
};

export default async function MonitoringPage({
  searchParams,
}: {
  searchParams: { secret?: string };
}) {
  const secret = searchParams.secret;
  if (!secret || secret !== process.env.MONITORING_SECRET) {
    redirect('/');
  }

  const supabase = getSupabase();

  const { data: checks } = await supabase
    .from('monitoring_checks')
    .select('*')
    .order('check_name');

  const { data: alerts } = await supabase
    .from('monitoring_alerts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">WhatsLater Monitoring</h1>
        <p className="text-sm text-gray-500 mb-6">
          Ultimo aggiornamento: {checks?.[0]?.checked_at ? new Date(checks[0].checked_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) : 'Mai'}
        </p>

        {/* Status Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {(checks || []).map((check: any) => (
            <div key={check.check_name} className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[check.status] || 'bg-gray-400'}`} />
                <span className="text-sm font-semibold text-gray-900">{check.check_name}</span>
              </div>
              <p className="text-xs text-gray-600">{check.message}</p>
              <p className="text-xs text-gray-400 mt-1">
                {STATUS_TEXT[check.status] || check.status} — {new Date(check.checked_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}
              </p>
            </div>
          ))}
          {(!checks || checks.length === 0) && (
            <p className="text-gray-500 col-span-3">Nessun check eseguito ancora. Attendi il primo ciclo di monitoraggio.</p>
          )}
        </div>

        {/* Alert History */}
        <h2 className="text-lg font-bold text-gray-900 mb-3">Ultimi Alert</h2>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-4 py-2">Ora</th>
                <th className="px-4 py-2">Check</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Canale</th>
                <th className="px-4 py-2 hidden sm:table-cell">Messaggio</th>
              </tr>
            </thead>
            <tbody>
              {(alerts || []).map((alert: any) => (
                <tr key={alert.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">
                    {new Date(alert.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{alert.check_name}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs text-white ${STATUS_COLORS[alert.status] || 'bg-gray-400'}`}>
                      {alert.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">{alert.channel}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 hidden sm:table-cell truncate max-w-[200px]">{alert.message}</td>
                </tr>
              ))}
              {(!alerts || alerts.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-center text-gray-400">Nessun alert inviato</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/monitoring/page.tsx
git commit -m "feat: add /monitoring dashboard page"
```

---

### Task 5: Create database tables in Supabase

- [ ] **Step 1: Run SQL in Supabase Dashboard**

Go to Supabase Dashboard → SQL Editor and run:

```sql
CREATE TABLE IF NOT EXISTS monitoring_checks (
  check_name TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  message TEXT,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitoring_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  check_name TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  channel TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitoring_alerts_cooldown
  ON monitoring_alerts (check_name, created_at DESC);
```

- [ ] **Step 2: Verify tables exist**

Run in SQL Editor: `SELECT * FROM monitoring_checks LIMIT 1; SELECT * FROM monitoring_alerts LIMIT 1;`
Expected: Empty results (no error)

---

### Task 6: Run all tests and deploy

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass (previous 88 + new monitoring tests)

- [ ] **Step 2: Deploy**

Run: `git push origin main`
Vercel will auto-deploy.

- [ ] **Step 3: Set environment variables on Vercel**

In Vercel Dashboard → Settings → Environment Variables, add:
- `MONITORING_SECRET` — generate a random string (e.g., `openssl rand -hex 16`)
- `RESEND_API_KEY` — from Resend dashboard (create account at resend.com if needed)

- [ ] **Step 4: Trigger redeploy after env vars are set**

Redeploy from Vercel Dashboard (or push empty commit).

- [ ] **Step 5: Test the health-check endpoint**

Visit: `https://whatslaterpush.vercel.app/api/monitoring/health-check?secret=YOUR_SECRET`
Expected: JSON with `status` and `checks` array of 6 results

- [ ] **Step 6: Test the dashboard**

Visit: `https://whatslaterpush.vercel.app/monitoring?secret=YOUR_SECRET`
Expected: Dashboard with 6 status cards

- [ ] **Step 7: Configure cron-job.org**

Create new cron job:
- URL: `https://whatslaterpush.vercel.app/api/monitoring/health-check?secret=YOUR_SECRET`
- Schedule: every 15 minutes
- Method: GET

- [ ] **Step 8: Final commit if any fixes needed**
