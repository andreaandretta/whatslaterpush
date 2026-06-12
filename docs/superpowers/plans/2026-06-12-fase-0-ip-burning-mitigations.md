# Fase 0 — IP Burning Mitigations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Fase 0 mitigations per `docs/superpowers/specs/2026-06-12-fase-0-ip-burning-mitigations-design.md` v3: rate limit atomico (§1), ISP proxy per-istanza con 2 egress (§2), ToS disclaimer (§5), watchdog per-egress + freeze rule (§6). §3 test diagnostico e §4 runbook docs OUT OF SCOPE.

**Architecture:** Quattro PR isolate su `main`. PR 1 = solo statico (ToS), PR 2 = sblocco operativo (egress proxy), PR 3 = throttle + waitlist, PR 4 = watchdog discriminatore. Ogni PR è auto-contenuta, rollback indipendente, mergiabile in qualunque ordine se l'unico dipendente è il proprio env var.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + service-role client), Jest 30 (`ts-jest` preset), Tailwind. Test path: `__tests__/*` (flat, suffix `.test.ts` / `.integration.test.ts` / `.test.tsx`). Existing patterns to reuse: `hashContactRefSync` (`app/lib/audit.ts:58`), `clientIpFromHeaders` (`app/lib/audit.ts:93`), `logAuditEvent` (`app/lib/audit.ts:68`), `rate_limit_record` RPC (`supabase/migrations/20260526_rate_limit_state.sql:30`).

**User constraints:**
- Branch: `main` (no worktree).
- **Diff prima di ogni commit** — Andrea OK esplicito richiesto prima di ogni `git commit`.
- Baseline 555+ Jest verdi da preservare.
- No breaking changes API esistente.

---

## File structure overview

| File | Action | PR | Purpose |
|---|---|---|---|
| `app/terms/page.tsx` | Modify | 1 | §5 Sezione Service-Level + bump update date |
| `app/lib/egress-pool.ts` | Create | 2 | §2 Egress selection, quarantine idempotente, error classes |
| `app/api/auth/init/route.ts` | Modify | 2, 3 | §2 proxy fields + 3-case fail mode; §1 rate limit + hash |
| `__tests__/egress-pool.test.ts` | Create | 2 | §2 unit |
| `__tests__/auth-init-egress.integration.test.ts` | Create | 2 | §2 integration |
| `supabase/migrations/20260612_activation_requests.sql` | Create | 3 | §1 schema overflow form |
| `app/lib/rate-limit-pairing.ts` | Create | 3 | §1 atomic enforcement via RPC esistente |
| `app/api/auth/request-activation/route.ts` | Create | 3 | §1 form endpoint |
| `app/components/connect/StepRichiestaAttivazione.tsx` | Create | 3 | §1 form UI |
| `app/connect/page.tsx` | Modify | 3 | §1 status-aware fetch + step 1b machine |
| `app/api/cron/daily-report/route.ts` | Modify | 3 | §1 pending activations count alert |
| `__tests__/rate-limit-pairing.test.ts` | Create | 3 | §1 unit |
| `__tests__/request-activation.integration.test.ts` | Create | 3 | §1 integration |
| `app/lib/monitoring.ts` | Modify | 4 | §6 checkPairingBlackout split + checkAllEgressDown |
| `app/api/ops/egress/unquarantine/route.ts` | Create | 4 | §6 manual override |
| `__tests__/monitoring-egress.test.ts` | Create | 4 | §6 unit |
| `__tests__/ops-egress-unquarantine.integration.test.ts` | Create | 4 | §6 integration |

---

## PR sequencing strategy

```
PR 1 (ToS, ~30 min)
   ↓ [zero rischio, deploy immediato]
PR 2 (Egress proxy, ~3h)
   ↓ [SBLOCCO operativo — flip env PAIRING_PROXY_ENABLED=true sblocca pairing]
PR 3 (Throttle + form, ~4h)
   ↓ [richiede PR 2 mergiato per share di /api/auth/init]
PR 4 (Watchdog + ops, ~2h)
   ↓ [richiede PR 2 mergiato per `egress_id` in payload]
```

PR 3 e PR 4 sono indipendenti l'uno dall'altro ma entrambi dipendono da PR 2 (per il campo `egress_id` in payload audit). PR 1 può andare in qualsiasi momento.

Totale ~9-10h founder-solo time.

---

# PR 1 — §5 ToS disclaimer

**Branch:** main (commit diretto).
**Files touched:** 1.
**Risk:** Zero — statico.
**Effort:** ~20 min.

### Task 1.1: Bump update date + add Service-Level section

**Files:**
- Modify: `app/terms/page.tsx`

- [ ] **Step 1: Open file and locate insertion point**

Read `app/terms/page.tsx` fully. Identify:
- Line con `Ultimo aggiornamento: 17 marzo 2026` (around line 31) — da aggiornare.
- Numerazione corrente sezioni (cerca `text-2xl font-bold` headings) — la nuova sezione "Service-Level e Limitazioni Tecniche" va inserita PRIMA di "Limitazione di Responsabilità". Conta i numeri esistenti.

- [ ] **Step 2: Update "Ultimo aggiornamento" date**

```tsx
// Old:
<p className="text-gray-500 mb-12">Ultimo aggiornamento: 17 marzo 2026</p>

// New:
<p className="text-gray-500 mb-12">Ultimo aggiornamento: 12 giugno 2026</p>
```

- [ ] **Step 3: Insert Service-Level section before Limitazione di Responsabilità**

Aggiungi nuova `<section>` (sostituisci `N` con il numero risultante dalla numerazione corrente):

```tsx
<section>
  <h2 className="text-2xl font-bold text-text-primary mb-4">N. Service-Level e Limitazioni Tecniche</h2>
  <p>
    Il Servizio si appoggia su API non ufficiali di WhatsApp (Meta Platforms Ireland Ltd.) per
    inviare messaggi dal tuo numero personale. Questa scelta tecnica è la sola che consente di
    preservare l&apos;identità personale del mittente, ma comporta limitazioni e rischi che accetti
    esplicitamente utilizzando il Servizio:
  </p>
  <ul className="list-disc pl-6 space-y-3 mt-4">
    <li>
      <strong>Nessuna garanzia di uptime.</strong> Il Servizio è fornito &ldquo;as-is&rdquo; e
      in modalità best-effort. Non garantiamo continuità del servizio, e non esistono SLA
      contrattuali. Interruzioni anche prolungate (fino a 72 ore o più in caso di incident
      upstream) sono possibili e non danno diritto a rimborsi parziali, salvo dove imposto
      dalla normativa applicabile.
    </li>
    <li>
      <strong>Nessuna garanzia di delivery.</strong> Non garantiamo che i messaggi programmati
      vengano consegnati. Variabili fuori dal nostro controllo (stato del tuo account WhatsApp,
      modifiche unilaterali Meta delle policy o delle API, blocchi temporanei o permanenti
      imposti da Meta, indisponibilità della rete) possono causare perdita o ritardo dei
      messaggi.
    </li>
    <li>
      <strong>Dipendenza da Meta.</strong> Il Servizio può essere sospeso, degradato o
      terminato in qualsiasi momento per cause esterne, incluse modifiche tecniche di Meta o
      decisioni commerciali della stessa. In caso di interruzione strutturale e permanente
      non risarcibile, il Servizio cessa con preavviso minimo di 14 giorni; la quota residua
      del periodo prepagato in corso viene rimborsata pro-rata.
    </li>
    <li>
      <strong>Responsabilità sull&apos;account WhatsApp.</strong> L&apos;utilizzo del Servizio
      comporta il rischio teorico che Meta classifichi il tuo account come automatizzato e
      applichi limitazioni (riduzione capacità di invio) o sospensione. Il Servizio è disegnato
      per minimizzare questo rischio (rate limiting, distribuzione temporale, no broadcast), ma
      non lo elimina. Non siamo responsabili per blocchi o sospensioni del tuo account
      WhatsApp derivanti dall&apos;utilizzo del Servizio.
    </li>
    <li>
      <strong>Esclusione casi d&apos;uso vietati.</strong> Confermi che non userai il Servizio
      per: messaggi commerciali a destinatari non consenzienti, attività di marketing massivo,
      contatti freddi (cold outreach), o qualsiasi attività in violazione delle WhatsApp
      Business Terms o della normativa europea (GDPR, ePrivacy). La violazione è giusta causa
      di risoluzione del Servizio senza rimborso.
    </li>
  </ul>
</section>
```

- [ ] **Step 4: Renumber subsequent sections**

Tutte le sezioni che seguono (es. "N+1. Limitazione di Responsabilità", "N+2. Modifiche...") incrementano di 1 il loro numero.

- [ ] **Step 5: Visual smoke test**

```bash
npm run dev
# Apri http://localhost:3000/terms in browser
# Verifica:
#   - "Ultimo aggiornamento: 12 giugno 2026"
#   - Nuova sezione "Service-Level e Limitazioni Tecniche" presente
#   - Numerazione successive coerente
#   - Layout invariato (font, spacing, prose styling)
```

- [ ] **Step 6: Show diff to Andrea**

```bash
git diff app/terms/page.tsx
```

Wait for Andrea OK.

- [ ] **Step 7: Commit**

```bash
git add app/terms/page.tsx
git commit -m "feat(legal): add Service-Level limitations section to ToS

Documents best-effort delivery, no SLA, dipendenza Meta, account responsibility
disclaimer, and prohibited-use exclusion. Pre-launch legal coverage for Baileys-
based unofficial API risk per spec Fase 0 §5."
```

---

# PR 2 — §2 ISP Proxy Egress Pool

**Branch:** main.
**Files touched:** 4 (1 new lib, 1 modified route, 2 new test files).
**Risk:** Medium — modifica `/api/auth/init` ma con feature flag `PAIRING_PROXY_ENABLED=false` di default = no behavior change finché non flippiamo env.
**Effort:** ~3h.

### Task 2.1: Create egress-pool.ts helper with types and env loader

**Files:**
- Create: `app/lib/egress-pool.ts`
- Create: `__tests__/egress-pool.test.ts`

- [ ] **Step 1: Write failing test for loadEgressFromEnv (empty pool)**

Create `__tests__/egress-pool.test.ts`:

```typescript
import { loadEgressFromEnv } from '../app/lib/egress-pool';

describe('loadEgressFromEnv', () => {
  const origEnv = process.env;
  beforeEach(() => { process.env = { ...origEnv }; });
  afterAll(() => { process.env = origEnv; });

  it('returns empty array when PAIRING_EGRESS_POOL unset', () => {
    delete process.env.PAIRING_EGRESS_POOL;
    expect(loadEgressFromEnv()).toEqual([]);
  });

  it('returns empty array when PAIRING_EGRESS_POOL is empty string', () => {
    process.env.PAIRING_EGRESS_POOL = '';
    expect(loadEgressFromEnv()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npx jest __tests__/egress-pool.test.ts
```
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Create minimal app/lib/egress-pool.ts**

```typescript
export type EgressProtocol = 'http' | 'https' | 'socks4' | 'socks5';

export interface Egress {
  id: string;
  host: string;
  port: number;
  protocol: EgressProtocol;
  username?: string;
  password?: string;
  label?: string;
}

export class MisconfigError extends Error {
  constructor(msg: string) { super(msg); this.name = 'MisconfigError'; }
}
export class FrozenError extends Error {
  constructor(msg: string) { super(msg); this.name = 'FrozenError'; }
}

export function loadEgressFromEnv(): Egress[] {
  const pool = (process.env.PAIRING_EGRESS_POOL || '').trim();
  if (!pool) return [];
  const ids = pool.split(',').map(s => s.trim()).filter(Boolean);
  const result: Egress[] = [];
  for (const id of ids) {
    const envPrefix = `PAIRING_EGRESS_${id.toUpperCase().replace(/-/g, '_')}_`;
    const host = process.env[envPrefix + 'HOST'];
    const portStr = process.env[envPrefix + 'PORT'];
    const protocol = (process.env[envPrefix + 'PROTOCOL'] || 'http') as EgressProtocol;
    const username = process.env[envPrefix + 'USERNAME'];
    const password = process.env[envPrefix + 'PASSWORD'];
    const label = process.env[envPrefix + 'LABEL'];
    if (!host || !portStr) continue; // skip malformed entry
    const port = Number(portStr);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) continue;
    if (!['http','https','socks4','socks5'].includes(protocol)) continue;
    result.push({
      id, host, port, protocol,
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
      ...(label ? { label } : {}),
    });
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
npx jest __tests__/egress-pool.test.ts
```
Expected: PASS.

- [ ] **Step 5: Add tests for full happy-path + malformed entries**

Add to `__tests__/egress-pool.test.ts`:

```typescript
it('parses single egress with all fields', () => {
  process.env.PAIRING_EGRESS_POOL = 'ipr-fra-01';
  process.env.PAIRING_EGRESS_IPR_FRA_01_HOST = 'proxy.iproyal.com';
  process.env.PAIRING_EGRESS_IPR_FRA_01_PORT = '12321';
  process.env.PAIRING_EGRESS_IPR_FRA_01_PROTOCOL = 'http';
  process.env.PAIRING_EGRESS_IPR_FRA_01_USERNAME = 'u';
  process.env.PAIRING_EGRESS_IPR_FRA_01_PASSWORD = 'p';
  process.env.PAIRING_EGRESS_IPR_FRA_01_LABEL = 'IPRoyal FRA';
  const pool = loadEgressFromEnv();
  expect(pool).toHaveLength(1);
  expect(pool[0]).toEqual({
    id: 'ipr-fra-01',
    host: 'proxy.iproyal.com',
    port: 12321,
    protocol: 'http',
    username: 'u',
    password: 'p',
    label: 'IPRoyal FRA',
  });
});

it('parses multiple egress', () => {
  process.env.PAIRING_EGRESS_POOL = 'ipr-fra-01,web-mil-01';
  process.env.PAIRING_EGRESS_IPR_FRA_01_HOST = 'p1.example.com';
  process.env.PAIRING_EGRESS_IPR_FRA_01_PORT = '8080';
  process.env.PAIRING_EGRESS_WEB_MIL_01_HOST = 'p2.example.com';
  process.env.PAIRING_EGRESS_WEB_MIL_01_PORT = '8081';
  const pool = loadEgressFromEnv();
  expect(pool.map(e => e.id)).toEqual(['ipr-fra-01', 'web-mil-01']);
});

it('skips egress missing host', () => {
  process.env.PAIRING_EGRESS_POOL = 'broken-01';
  process.env.PAIRING_EGRESS_BROKEN_01_PORT = '8080';
  // HOST not set
  expect(loadEgressFromEnv()).toEqual([]);
});

it('skips egress with invalid port', () => {
  process.env.PAIRING_EGRESS_POOL = 'broken-02';
  process.env.PAIRING_EGRESS_BROKEN_02_HOST = 'x.com';
  process.env.PAIRING_EGRESS_BROKEN_02_PORT = 'not-a-number';
  expect(loadEgressFromEnv()).toEqual([]);
});

it('skips egress with invalid protocol', () => {
  process.env.PAIRING_EGRESS_POOL = 'broken-03';
  process.env.PAIRING_EGRESS_BROKEN_03_HOST = 'x.com';
  process.env.PAIRING_EGRESS_BROKEN_03_PORT = '80';
  process.env.PAIRING_EGRESS_BROKEN_03_PROTOCOL = 'ftp';
  expect(loadEgressFromEnv()).toEqual([]);
});

it('defaults protocol to http when unspecified', () => {
  process.env.PAIRING_EGRESS_POOL = 'min-01';
  process.env.PAIRING_EGRESS_MIN_01_HOST = 'x.com';
  process.env.PAIRING_EGRESS_MIN_01_PORT = '80';
  const pool = loadEgressFromEnv();
  expect(pool[0].protocol).toBe('http');
});
```

- [ ] **Step 6: Run tests to verify all pass**

```bash
npx jest __tests__/egress-pool.test.ts
```
Expected: PASS (all 7 tests).

### Task 2.2: Add quarantine state helpers

**Files:**
- Modify: `app/lib/egress-pool.ts`
- Modify: `__tests__/egress-pool.test.ts`

- [ ] **Step 1: Write failing test for isEgressQuarantined**

Add to `__tests__/egress-pool.test.ts`:

```typescript
import { isEgressQuarantined, quarantineEgress } from '../app/lib/egress-pool';

// Mock supabase client. The helpers use the service-role pattern via
// getSupabase() — we'll mock that.
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

describe('isEgressQuarantined / quarantineEgress', () => {
  let mockSupabase: any;
  let mockFrom: jest.Mock;

  beforeEach(() => {
    mockFrom = jest.fn();
    mockSupabase = { from: mockFrom };
    const { createClient } = require('@supabase/supabase-js');
    (createClient as jest.Mock).mockReturnValue(mockSupabase);
  });

  it('returns false when no audit event found', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ in: () => ({ filter: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => ({ data: null, error: null }) }) }) }) }) }),
    } as any);
    const result = await isEgressQuarantined('ipr-fra-01');
    expect(result).toBe(false);
  });

  it('returns true when latest event is quarantine and until > now', async () => {
    const futureIso = new Date(Date.now() + 3600_000).toISOString();
    mockFrom.mockReturnValue({
      select: () => ({ in: () => ({ filter: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => ({
        data: { event_type: 'egress_quarantine', payload: { egress_id: 'ipr-fra-01', until: futureIso } },
        error: null,
      }) }) }) }) }) }),
    } as any);
    const result = await isEgressQuarantined('ipr-fra-01');
    expect(result).toBe(true);
  });

  it('returns false when latest event is unquarantine', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ in: () => ({ filter: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => ({
        data: { event_type: 'egress_unquarantine', payload: { egress_id: 'ipr-fra-01' } },
        error: null,
      }) }) }) }) }) }),
    } as any);
    const result = await isEgressQuarantined('ipr-fra-01');
    expect(result).toBe(false);
  });

  it('returns false when quarantine TTL has expired', async () => {
    const pastIso = new Date(Date.now() - 1000).toISOString();
    mockFrom.mockReturnValue({
      select: () => ({ in: () => ({ filter: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => ({
        data: { event_type: 'egress_quarantine', payload: { egress_id: 'ipr-fra-01', until: pastIso } },
        error: null,
      }) }) }) }) }) }),
    } as any);
    const result = await isEgressQuarantined('ipr-fra-01');
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx jest __tests__/egress-pool.test.ts
```
Expected: FAIL with "isEgressQuarantined is not a function".

- [ ] **Step 3: Add helpers to egress-pool.ts**

Append to `app/lib/egress-pool.ts`:

```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface LatestEgressEvent {
  event_type: 'egress_quarantine' | 'egress_unquarantine';
  payload: { egress_id: string; reason?: string; until?: string };
}

async function getLatestEgressEvent(egressId: string): Promise<LatestEgressEvent | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('audit_events')
    .select('event_type,payload')
    .in('event_type', ['egress_quarantine', 'egress_unquarantine'])
    .filter('payload->>egress_id', 'eq', egressId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`[egress-pool] getLatestEgressEvent err=${error.message}`);
    return null;
  }
  return (data as unknown as LatestEgressEvent) || null;
}

export async function isEgressQuarantined(egressId: string): Promise<boolean> {
  const latest = await getLatestEgressEvent(egressId);
  if (!latest) return false;
  if (latest.event_type === 'egress_unquarantine') return false;
  if (!latest.payload.until) return false;
  return new Date(latest.payload.until).getTime() > Date.now();
}

export async function quarantineEgress(
  egressId: string,
  reason: string,
  ttlHours: number = 24,
): Promise<void> {
  // Idempotent: skip if already actively quarantined (avoid audit spam from
  // multiple cron runs hitting the same threshold simultaneously).
  if (await isEgressQuarantined(egressId)) return;

  const until = new Date(Date.now() + ttlHours * 3600_000).toISOString();
  // Use direct insert (not logAuditEvent) to bypass the sentry-pii scrubObject —
  // egress_id and until are not PII and must round-trip cleanly.
  const supabase = getSupabase();
  const { error } = await supabase.from('audit_events').insert({
    event_type: 'egress_quarantine',
    payload: { egress_id: egressId, reason, until },
  });
  if (error) {
    console.warn(`[egress-pool] quarantine insert err=${error.message}`);
  }
}

export async function unquarantineEgress(egressId: string, reason: string = 'manual'): Promise<void> {
  if (!(await isEgressQuarantined(egressId))) return; // idempotent
  const supabase = getSupabase();
  const { error } = await supabase.from('audit_events').insert({
    event_type: 'egress_unquarantine',
    payload: { egress_id: egressId, reason },
  });
  if (error) {
    console.warn(`[egress-pool] unquarantine insert err=${error.message}`);
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx jest __tests__/egress-pool.test.ts
```
Expected: PASS (all tests).

- [ ] **Step 5: Add idempotency test for quarantineEgress**

```typescript
it('quarantineEgress is idempotent (no insert when already quarantined)', async () => {
  const futureIso = new Date(Date.now() + 3600_000).toISOString();
  const insertSpy = jest.fn().mockResolvedValue({ error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'audit_events') {
      return {
        select: () => ({ in: () => ({ filter: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => ({
          data: { event_type: 'egress_quarantine', payload: { egress_id: 'ipr-fra-01', until: futureIso } },
          error: null,
        }) }) }) }) }) }),
        insert: insertSpy,
      };
    }
    return {} as any;
  });
  await quarantineEgress('ipr-fra-01', 'test-reason');
  expect(insertSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Run tests to verify pass**

```bash
npx jest __tests__/egress-pool.test.ts
```
Expected: PASS.

### Task 2.3: Implement getEgressForPairing

**Files:**
- Modify: `app/lib/egress-pool.ts`
- Modify: `__tests__/egress-pool.test.ts`

- [ ] **Step 1: Write failing tests for getEgressForPairing 4 branches**

```typescript
import { getEgressForPairing, MisconfigError, FrozenError } from '../app/lib/egress-pool';

describe('getEgressForPairing', () => {
  const origEnv = process.env;
  beforeEach(() => { process.env = { ...origEnv }; });
  afterAll(() => { process.env = origEnv; });

  it('returns null when PAIRING_PROXY_ENABLED=false', async () => {
    process.env.PAIRING_PROXY_ENABLED = 'false';
    const result = await getEgressForPairing();
    expect(result).toBeNull();
  });

  it('returns null when PAIRING_PROXY_ENABLED unset', async () => {
    delete process.env.PAIRING_PROXY_ENABLED;
    const result = await getEgressForPairing();
    expect(result).toBeNull();
  });

  it('throws MisconfigError when enabled but pool empty', async () => {
    process.env.PAIRING_PROXY_ENABLED = 'true';
    process.env.PAIRING_EGRESS_POOL = '';
    await expect(getEgressForPairing()).rejects.toThrow(MisconfigError);
  });

  it('throws MisconfigError when enabled but all entries malformed', async () => {
    process.env.PAIRING_PROXY_ENABLED = 'true';
    process.env.PAIRING_EGRESS_POOL = 'broken-01';
    // no HOST/PORT set → loadEgressFromEnv returns []
    await expect(getEgressForPairing()).rejects.toThrow(MisconfigError);
  });

  // FrozenError and happy-path tests added next
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx jest __tests__/egress-pool.test.ts -t getEgressForPairing
```
Expected: FAIL with "is not a function".

- [ ] **Step 3: Implement getEgressForPairing**

Append to `app/lib/egress-pool.ts`:

```typescript
export async function getEgressForPairing(): Promise<Egress | null> {
  if (process.env.PAIRING_PROXY_ENABLED !== 'true') return null;

  const pool = loadEgressFromEnv();
  if (pool.length === 0) {
    throw new MisconfigError(
      'PAIRING_PROXY_ENABLED=true but pool is empty or malformed. Check PAIRING_EGRESS_POOL + per-egress vars.'
    );
  }

  // Check quarantine state sequentially (pool is small, ~2-4 entries).
  // Returns first non-quarantined; throws FrozenError if all are out.
  for (const e of pool) {
    if (!(await isEgressQuarantined(e.id))) return e;
  }
  throw new FrozenError(`All ${pool.length} egress quarantined. Pairing frozen.`);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx jest __tests__/egress-pool.test.ts -t getEgressForPairing
```
Expected: PASS (4 tests).

- [ ] **Step 5: Add happy-path + frozen tests**

```typescript
it('returns first egress when none quarantined', async () => {
  process.env.PAIRING_PROXY_ENABLED = 'true';
  process.env.PAIRING_EGRESS_POOL = 'ipr-fra-01,web-mil-01';
  process.env.PAIRING_EGRESS_IPR_FRA_01_HOST = 'p1.x.com';
  process.env.PAIRING_EGRESS_IPR_FRA_01_PORT = '8080';
  process.env.PAIRING_EGRESS_WEB_MIL_01_HOST = 'p2.x.com';
  process.env.PAIRING_EGRESS_WEB_MIL_01_PORT = '8081';
  // Mock both isEgressQuarantined calls to return false:
  mockFrom.mockReturnValue({
    select: () => ({ in: () => ({ filter: () => ({ order: () => ({ limit: () => ({ maybeSingle: () =>
      ({ data: null, error: null })
    }) }) }) }) }),
  } as any);
  const result = await getEgressForPairing();
  expect(result?.id).toBe('ipr-fra-01');
});

it('returns second egress when first is quarantined', async () => {
  process.env.PAIRING_PROXY_ENABLED = 'true';
  process.env.PAIRING_EGRESS_POOL = 'ipr-fra-01,web-mil-01';
  process.env.PAIRING_EGRESS_IPR_FRA_01_HOST = 'p1.x.com';
  process.env.PAIRING_EGRESS_IPR_FRA_01_PORT = '8080';
  process.env.PAIRING_EGRESS_WEB_MIL_01_HOST = 'p2.x.com';
  process.env.PAIRING_EGRESS_WEB_MIL_01_PORT = '8081';

  const futureIso = new Date(Date.now() + 3600_000).toISOString();
  let callCount = 0;
  mockFrom.mockReturnValue({
    select: () => ({ in: () => ({ filter: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => {
      callCount++;
      // First call (ipr-fra-01) → quarantined; second call (web-mil-01) → null
      if (callCount === 1) {
        return { data: { event_type: 'egress_quarantine', payload: { egress_id: 'ipr-fra-01', until: futureIso } }, error: null };
      }
      return { data: null, error: null };
    } }) }) }) }) }),
  } as any);
  const result = await getEgressForPairing();
  expect(result?.id).toBe('web-mil-01');
});

it('throws FrozenError when all egress quarantined', async () => {
  process.env.PAIRING_PROXY_ENABLED = 'true';
  process.env.PAIRING_EGRESS_POOL = 'ipr-fra-01,web-mil-01';
  process.env.PAIRING_EGRESS_IPR_FRA_01_HOST = 'p1.x.com';
  process.env.PAIRING_EGRESS_IPR_FRA_01_PORT = '8080';
  process.env.PAIRING_EGRESS_WEB_MIL_01_HOST = 'p2.x.com';
  process.env.PAIRING_EGRESS_WEB_MIL_01_PORT = '8081';

  const futureIso = new Date(Date.now() + 3600_000).toISOString();
  mockFrom.mockReturnValue({
    select: () => ({ in: () => ({ filter: (col: string, op: string, val: string) => ({ order: () => ({ limit: () => ({ maybeSingle: () =>
      ({ data: { event_type: 'egress_quarantine', payload: { egress_id: val, until: futureIso } }, error: null })
    }) }) }) }) }),
  } as any);
  await expect(getEgressForPairing()).rejects.toThrow(FrozenError);
});
```

- [ ] **Step 6: Run tests to verify pass**

```bash
npx jest __tests__/egress-pool.test.ts
```
Expected: PASS (all egress-pool tests).

### Task 2.4: Integrate egress into /api/auth/init

**Files:**
- Modify: `app/api/auth/init/route.ts`
- Create: `__tests__/auth-init-egress.integration.test.ts`

- [ ] **Step 1: Write failing integration test (smoke proxy fields injected)**

Create `__tests__/auth-init-egress.integration.test.ts`:

```typescript
/**
 * Smoke test that POST /api/auth/init injects proxy fields when an egress
 * is available, and that 500/503 are returned on misconfig/frozen.
 *
 * NB: this test is a HIGH-level smoke. It mocks Evolution fetch and Supabase.
 * Full E2E is manual (Sprint 1 smoke step in spec).
 */

import { NextRequest } from 'next/server';

const mockEvolutionFetch = jest.fn();
const mockSupabaseInsert = jest.fn().mockResolvedValue({ error: null });

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      insert: mockSupabaseInsert,
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })),
        in: jest.fn(() => ({ filter: jest.fn(() => ({ order: jest.fn(() => ({ limit: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })) })) })) })),
      })),
      delete: jest.fn(() => ({
        eq: jest.fn(() => ({
          neq: jest.fn().mockResolvedValue({ error: null }),
        })),
      })),
      upsert: jest.fn().mockResolvedValue({ error: null }),
    })),
    rpc: jest.fn(),
  })),
}));

global.fetch = mockEvolutionFetch as any;

describe('POST /api/auth/init — egress integration', () => {
  const origEnv = process.env;
  beforeEach(() => {
    process.env = { ...origEnv };
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.EVOLUTION_API_URL = 'https://test.evo';
    process.env.EVOLUTION_API_KEY = 'test-evo-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://test.app';
    mockEvolutionFetch.mockReset();
    mockSupabaseInsert.mockClear();
  });
  afterAll(() => { process.env = origEnv; });

  it('returns 500 misconfig when proxy enabled but pool empty', async () => {
    process.env.PAIRING_PROXY_ENABLED = 'true';
    process.env.PAIRING_EGRESS_POOL = '';

    const { POST } = await import('../app/api/auth/init/route');
    const req = new NextRequest('http://localhost/api/auth/init', {
      method: 'POST',
      body: JSON.stringify({ phone: '393331234567' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('server_misconfiguration');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npx jest __tests__/auth-init-egress.integration.test.ts
```
Expected: FAIL (current route doesn't return 500 misconfig).

- [ ] **Step 3: Modify /api/auth/init/route.ts to integrate egress**

Read current `app/api/auth/init/route.ts` (especially lines 60-225). Add imports at top:

```typescript
import * as Sentry from '@sentry/nextjs';
import { getEgressForPairing, MisconfigError, FrozenError, type Egress } from '../../../lib/egress-pool';
import { clientIpFromHeaders, hashContactRefSync } from '../../../lib/audit';
```

After `validatePhone` block (around line 73), BEFORE the existing `pending_auth_sessions.insert` (around line 86), add egress selection:

```typescript
// === Egress selection (Fase 0 §2) ===
let egress: Egress | null;
try {
  egress = await getEgressForPairing();
} catch (e) {
  if (e instanceof MisconfigError) {
    Sentry.captureException(e, { tags: { kind: 'pairing_misconfig' } });
    return NextResponse.json(
      { error: 'server_misconfiguration', message: 'Errore di configurazione. Stiamo verificando.' },
      { status: 500 },
    );
  }
  if (e instanceof FrozenError) {
    return NextResponse.json(
      {
        error: 'pairing_frozen',
        message: 'Sistema momentaneamente in sovraccarico. Ti contattiamo via WhatsApp.',
        next_steps: { form_path: '/connect?step=activation-request' },
      },
      { status: 503 },
    );
  }
  throw e;
}
```

In the existing `fetch(${evoUrl}/instance/create, ...)` block (around line 140-171), add proxy fields BEFORE `webhook:` field:

```typescript
body: JSON.stringify({
  instanceName,
  number: cleanPhone,
  qrcode: true,
  integration: 'WHATSAPP-BAILEYS',
  syncFullHistory: false,
  alwaysOnline: true,
  groupsIgnore: false,
  // Egress proxy fields (Fase 0 §2) — injected only when proxy is enabled.
  ...(egress ? {
    proxyHost: egress.host,
    proxyPort: egress.port,
    proxyProtocol: egress.protocol,
    ...(egress.username ? { proxyUsername: egress.username } : {}),
    ...(egress.password ? { proxyPassword: egress.password } : {}),
  } : {}),
  webhook: { /* ... unchanged ... */ },
}),
```

Modify the `logAuditEvent('pairing_started')` call (around line 221):

```typescript
const sourceIp = clientIpFromHeaders(req.headers);
const phoneHash = hashContactRefSync(cleanPhone);
void logAuditEvent({
  eventType: 'pairing_started',
  payload: {
    instance_name: instanceName,
    egress_id: egress?.id || null,
    phone_hash: phoneHash,
  },
  ipAddress: sourceIp,
});
```

- [ ] **Step 4: Run integration test to verify 500 path**

```bash
npx jest __tests__/auth-init-egress.integration.test.ts
```
Expected: PASS (500 misconfig test).

- [ ] **Step 5: Add test for 503 frozen path**

Add to `__tests__/auth-init-egress.integration.test.ts`:

```typescript
it('returns 503 frozen when proxy enabled and all egress quarantined', async () => {
  process.env.PAIRING_PROXY_ENABLED = 'true';
  process.env.PAIRING_EGRESS_POOL = 'ipr-fra-01';
  process.env.PAIRING_EGRESS_IPR_FRA_01_HOST = 'p.x.com';
  process.env.PAIRING_EGRESS_IPR_FRA_01_PORT = '8080';

  // Mock supabase to return quarantine event for ipr-fra-01
  const futureIso = new Date(Date.now() + 3600_000).toISOString();
  const { createClient } = require('@supabase/supabase-js');
  (createClient as jest.Mock).mockReturnValueOnce({
    from: jest.fn((table: string) => ({
      select: jest.fn(() => ({
        in: jest.fn(() => ({ filter: jest.fn(() => ({ order: jest.fn(() => ({ limit: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({
          data: { event_type: 'egress_quarantine', payload: { egress_id: 'ipr-fra-01', until: futureIso } },
          error: null,
        }) })) })) })) })),
        eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })),
      })),
      insert: jest.fn().mockResolvedValue({ error: null }),
      delete: jest.fn(() => ({ eq: jest.fn(() => ({ neq: jest.fn().mockResolvedValue({ error: null }) })) })),
      upsert: jest.fn().mockResolvedValue({ error: null }),
    })),
    rpc: jest.fn(),
  });

  const { POST } = await import('../app/api/auth/init/route');
  jest.resetModules(); // re-import to pick up mocked createClient
  const fresh = await import('../app/api/auth/init/route');
  const req = new NextRequest('http://localhost/api/auth/init', {
    method: 'POST',
    body: JSON.stringify({ phone: '393331234567' }),
  });
  const res = await fresh.POST(req);
  expect(res.status).toBe(503);
  const body = await res.json();
  expect(body.error).toBe('pairing_frozen');
});
```

- [ ] **Step 6: Run all egress-pool + integration tests**

```bash
npx jest __tests__/egress-pool.test.ts __tests__/auth-init-egress.integration.test.ts
```
Expected: PASS (all).

- [ ] **Step 7: Run full Jest suite to verify no regression**

```bash
npm test
```
Expected: All 555+ tests pass, plus new ones.

### Task 2.5: Commit PR 2

- [ ] **Step 1: Show diff to Andrea**

```bash
git diff --stat
git diff app/lib/egress-pool.ts app/api/auth/init/route.ts __tests__/egress-pool.test.ts __tests__/auth-init-egress.integration.test.ts
```

Wait for Andrea OK.

- [ ] **Step 2: Stage and commit**

```bash
git add app/lib/egress-pool.ts \
        app/api/auth/init/route.ts \
        __tests__/egress-pool.test.ts \
        __tests__/auth-init-egress.integration.test.ts
git commit -m "feat(pairing): A1 ISP proxy per-istanza con egress pool

Adds Fase 0 §2 unlock — pairing-only egress proxy injected nel payload
Evolution /instance/create when PAIRING_PROXY_ENABLED=true. Steady-state
sessions stay direct on droplet (no proxy uptime dependency).

- app/lib/egress-pool.ts: loadEgressFromEnv, getEgressForPairing (4-case
  fail mode), idempotent quarantineEgress/unquarantineEgress, isEgressQuarantined
- app/api/auth/init: integrate egress selection, 500 misconfig, 503 frozen,
  audit pairing_started con egress_id+phone_hash+source_ip
- Tests: 11 unit + 2 integration

Defaults to disabled (PAIRING_PROXY_ENABLED=false) so deploy è no-op
finché flip env. Flip plan in spec rollout Sprint 1."
```

- [ ] **Step 3: Post-merge env config (manual, not in commit)**

After merge, Andrea sets in Vercel env (one-shot, not committed):
- `PAIRING_PROXY_ENABLED=true`
- `PAIRING_EGRESS_POOL=ipr-fra-01,web-mil-01`
- `PAIRING_EGRESS_IPR_FRA_01_{HOST,PORT,PROTOCOL,USERNAME,PASSWORD,LABEL}` (from IPRoyal dashboard)
- `PAIRING_EGRESS_WEB_MIL_01_*` (from Webshare dashboard)
- `PAIRING_PROXY_ENABLED_SINCE=<ISO timestamp now>` (per §6 watchdog transition)

Then smoke: 2 pairing reali, uno per egress. Se entrambi state=open → SBLOCCATO.

---

# PR 3 — §1 Rate Limit Atomico + Activation Form + Daily-Report Ext

**Branch:** main.
**Files touched:** 7 (1 migration, 2 new lib/route, 1 new component, 2 modify, 2 test files).
**Risk:** Medium — modifica `/api/auth/init` ulteriormente + nuovo endpoint pubblico.
**Effort:** ~4h.
**Depends on:** PR 2 mergiato (audit payload include `egress_id`).

### Task 3.1: Create activation_requests migration

**Files:**
- Create: `supabase/migrations/20260612_activation_requests.sql`

- [ ] **Step 1: Write migration**

Create `supabase/migrations/20260612_activation_requests.sql`:

```sql
-- Migration: activation_requests
-- Stores overflow form submissions when /api/auth/init returns 429 (rate limit)
-- or 503 (pairing_frozen). Andrea contacts pending entries manually within 24h.
--
-- PII policy (coerent with 20260527_audit_events.sql comment): phone_hash è
-- mandatory (SHA-256 8-char dedup); phone_e164_enc è opzionale, cifrato
-- simmetricamente se Andrea vuole contattare l'utente con la chiave
-- ACTIVATION_PHONE_ENC_KEY env.
--
-- Date: 2026-06-12

CREATE TABLE IF NOT EXISTS public.activation_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash      TEXT NOT NULL,
  phone_e164_enc  TEXT,
  display_name    TEXT,
  note            TEXT,
  source_ip       TEXT,
  user_agent      TEXT,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','contacted','onboarded','rejected','spam')),
  contacted_at    TIMESTAMPTZ,
  notes_admin     TEXT,
  trigger_reason  TEXT CHECK (trigger_reason IN ('rate_limit_ip','rate_limit_phone','pairing_freeze','direct')),
  CONSTRAINT name_len CHECK (display_name IS NULL OR char_length(display_name) <= 100),
  CONSTRAINT note_len CHECK (note IS NULL OR char_length(note) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_activation_requests_status
  ON public.activation_requests(status, requested_at);
CREATE INDEX IF NOT EXISTS idx_activation_requests_phone_hash
  ON public.activation_requests(phone_hash);

ALTER TABLE public.activation_requests ENABLE ROW LEVEL SECURITY;
-- No anon access. Service-role bypasses RLS automatically.
```

- [ ] **Step 2: Apply migration manually via Supabase Studio**

```bash
# Show migration content for review
cat supabase/migrations/20260612_activation_requests.sql
```

Andrea: apply via Supabase Studio SQL editor (project dashboard → SQL Editor → paste migration → run). Verify table exists:

```sql
SELECT * FROM activation_requests LIMIT 0;
\d activation_requests
```

- [ ] **Step 3: Commit migration file**

```bash
git diff supabase/migrations/20260612_activation_requests.sql
# Andrea OK?
git add supabase/migrations/20260612_activation_requests.sql
git commit -m "feat(db): add activation_requests table for overflow form

Coerent with Sprint 6 PII policy: phone_hash mandatory, phone_e164_enc
optional encrypted. RLS enabled, service-role only access."
```

### Task 3.2: Create rate-limit-pairing.ts helper

**Files:**
- Create: `app/lib/rate-limit-pairing.ts`
- Create: `__tests__/rate-limit-pairing.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/rate-limit-pairing.test.ts`:

```typescript
import { enforcePairingRateLimit } from '../app/lib/rate-limit-pairing';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

describe('enforcePairingRateLimit', () => {
  let mockRpc: jest.Mock;
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    mockRpc = jest.fn();
    const { createClient } = require('@supabase/supabase-js');
    (createClient as jest.Mock).mockReturnValue({ rpc: mockRpc });
  });
  afterAll(() => { process.env = origEnv; });

  it('passes when both IP and phone are under cap', async () => {
    mockRpc.mockResolvedValue({ data: { daily_count: 1, minute_count: 1, blocked: false }, error: null });
    const result = await enforcePairingRateLimit({ sourceIp: '1.2.3.4', phoneHash: 'h:abcd1234' });
    expect(result.ok).toBe(true);
  });

  it('blocks when IP daily_count hits cap', async () => {
    mockRpc.mockResolvedValueOnce({ data: { daily_count: 3, minute_count: 0, blocked: false }, error: null }); // IP
    mockRpc.mockResolvedValueOnce({ data: { daily_count: 0, minute_count: 1, blocked: false }, error: null }); // phone
    const result = await enforcePairingRateLimit({ sourceIp: '1.2.3.4', phoneHash: 'h:abcd1234' });
    expect(result).toEqual({ ok: false, reason: 'ip_quota' });
  });

  it('blocks when phone minute_count hits hour cap', async () => {
    mockRpc.mockResolvedValueOnce({ data: { daily_count: 0, minute_count: 0, blocked: false }, error: null }); // IP
    mockRpc.mockResolvedValueOnce({ data: { daily_count: 0, minute_count: 3, blocked: false }, error: null }); // phone
    const result = await enforcePairingRateLimit({ sourceIp: '1.2.3.4', phoneHash: 'h:abcd1234' });
    expect(result).toEqual({ ok: false, reason: 'phone_quota' });
  });

  it('returns ok when PAIRING_RATE_LIMIT_ENABLED=false', async () => {
    process.env.PAIRING_RATE_LIMIT_ENABLED = 'false';
    const result = await enforcePairingRateLimit({ sourceIp: '1.2.3.4', phoneHash: 'h:abcd1234' });
    expect(result.ok).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('respects PAIRING_RATE_LIMIT_BYPASS_IPS', async () => {
    process.env.PAIRING_RATE_LIMIT_BYPASS_IPS = '1.2.3.4,5.6.7.8';
    const result = await enforcePairingRateLimit({ sourceIp: '1.2.3.4', phoneHash: 'h:abcd1234' });
    expect(result.ok).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npx jest __tests__/rate-limit-pairing.test.ts
```
Expected: FAIL "Cannot find module".

- [ ] **Step 3: Implement rate-limit-pairing.ts**

Create `app/lib/rate-limit-pairing.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';

const HOUR_MS = 3600_000;
const DAY_MS = 86_400_000;

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface EnforceInput {
  sourceIp: string;
  phoneHash: string;
}

type EnforceResult =
  | { ok: true }
  | { ok: false; reason: 'ip_quota' | 'phone_quota' };

function isBypassIp(ip: string): boolean {
  const bypass = (process.env.PAIRING_RATE_LIMIT_BYPASS_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
  return bypass.includes(ip);
}

// Use rate_limit_record RPC (existing migration 20260526). The RPC has a
// "daily" slot (24h reset) — we use this for the IP key (cap 3/24h).
// It also has a "minute" slot (60s default reset) — we abuse this as a 1h
// slot by passing minute_reset = now + 3600000. Semantics: first window of
// the row. Cap policy is enforced client-side by reading the returned counts.
export async function enforcePairingRateLimit(input: EnforceInput): Promise<EnforceResult> {
  if (process.env.PAIRING_RATE_LIMIT_ENABLED === 'false') return { ok: true };
  if (isBypassIp(input.sourceIp)) return { ok: true };

  const capIp = Number(process.env.PAIRING_RATE_LIMIT_PER_DAY || '3');
  const capPhone = Number(process.env.PAIRING_RATE_LIMIT_PER_PHONE_PER_HOUR || '3');
  const now = Date.now();
  const supabase = getSupabase();

  const ipKey = `pairing_ip:${input.sourceIp}`;
  const phoneKey = `pairing_phone:${input.phoneHash}`;

  // Increment both atomically (parallel)
  const [ipRes, phoneRes] = await Promise.all([
    supabase.rpc('rate_limit_record', {
      p_key: ipKey,
      p_now: now,
      p_minute_reset: now + HOUR_MS, // unused conceptually but RPC requires it
      p_daily_reset: now + DAY_MS,
    }),
    supabase.rpc('rate_limit_record', {
      p_key: phoneKey,
      p_now: now,
      p_minute_reset: now + HOUR_MS, // 1h window via "minute" slot
      p_daily_reset: now + DAY_MS, // unused but RPC requires it
    }),
  ]);

  if (ipRes.error) {
    console.warn('[rate-limit-pairing] IP RPC err: ' + ipRes.error.message);
    return { ok: true }; // fail-open: don't block legitimate users on infra hiccup
  }
  if (phoneRes.error) {
    console.warn('[rate-limit-pairing] phone RPC err: ' + phoneRes.error.message);
    return { ok: true };
  }

  if ((ipRes.data as any)?.daily_count > capIp) return { ok: false, reason: 'ip_quota' };
  if ((phoneRes.data as any)?.minute_count > capPhone) return { ok: false, reason: 'phone_quota' };
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx jest __tests__/rate-limit-pairing.test.ts
```
Expected: PASS.

### Task 3.3: Wire rate limit into /api/auth/init

**Files:**
- Modify: `app/api/auth/init/route.ts`

- [ ] **Step 1: Add rate limit check before egress selection**

In `app/api/auth/init/route.ts`, add import:

```typescript
import { enforcePairingRateLimit } from '../../../lib/rate-limit-pairing';
```

After `validatePhone` block, BEFORE egress selection (the block added in PR 2), insert:

```typescript
// === Rate limit check (Fase 0 §1) ===
// Bypass via OPS_SECRET header (Andrea admin testing).
const bypassHeader = req.headers.get('x-pairing-bypass');
const isAdminBypass = bypassHeader && bypassHeader === process.env.OPS_SECRET;

if (!isAdminBypass) {
  const sourceIp = clientIpFromHeaders(req.headers) || 'unknown';
  const phoneHash = hashContactRefSync(cleanPhone);
  const rateCheck = await enforcePairingRateLimit({ sourceIp, phoneHash });
  if (!rateCheck.ok) {
    return NextResponse.json(
      {
        error: 'pairing_quota_exceeded',
        reason: rateCheck.reason,
        message: 'Hai già provato il pairing più volte. Richiedi attivazione manuale.',
        next_steps: { form_path: '/connect?step=activation-request' },
        retry_after_hours: rateCheck.reason === 'ip_quota' ? 24 : 1,
      },
      { status: 429 },
    );
  }
}
```

Note: `sourceIp` + `phoneHash` were computed at audit logging only in PR 2. Refactor so they're computed once near the top of the handler and reused both for rate limit AND audit logging. Move the existing PR 2 lines:

```typescript
const sourceIp = clientIpFromHeaders(req.headers) || 'unknown';
const phoneHash = hashContactRefSync(cleanPhone);
```

…to immediately after `validatePhone` block, so both rate limit and audit can use them.

- [ ] **Step 2: Add integration test for 429**

Add to `__tests__/auth-init-egress.integration.test.ts` (or new file):

```typescript
it('returns 429 when IP rate limit hit', async () => {
  process.env.PAIRING_PROXY_ENABLED = 'false';

  // Mock createClient.rpc to return daily_count=4 (over cap 3)
  const { createClient } = require('@supabase/supabase-js');
  (createClient as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      insert: jest.fn().mockResolvedValue({ error: null }),
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })),
      })),
      delete: jest.fn(() => ({ eq: jest.fn(() => ({ neq: jest.fn().mockResolvedValue({ error: null }) })) })),
      upsert: jest.fn().mockResolvedValue({ error: null }),
    })),
    rpc: jest.fn().mockResolvedValue({ data: { daily_count: 4, minute_count: 0, blocked: false }, error: null }),
  });
  jest.resetModules();
  const { POST } = await import('../app/api/auth/init/route');
  const req = new NextRequest('http://localhost/api/auth/init', {
    method: 'POST',
    body: JSON.stringify({ phone: '393331234567' }),
  });
  const res = await POST(req);
  expect(res.status).toBe(429);
  const body = await res.json();
  expect(body.error).toBe('pairing_quota_exceeded');
  expect(body.reason).toBe('ip_quota');
});
```

- [ ] **Step 3: Run test to verify pass**

```bash
npx jest __tests__/auth-init-egress.integration.test.ts -t "429"
```
Expected: PASS.

### Task 3.4: Create /api/auth/request-activation endpoint

**Files:**
- Create: `app/api/auth/request-activation/route.ts`
- Create: `__tests__/request-activation.integration.test.ts`

- [ ] **Step 1: Write failing test for happy path**

Create `__tests__/request-activation.integration.test.ts`:

```typescript
import { NextRequest } from 'next/server';

const mockInsert = jest.fn().mockResolvedValue({ error: null });
const mockSelect = jest.fn();
const mockRpc = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      insert: mockInsert,
      select: mockSelect,
    })),
    rpc: mockRpc,
  })),
}));

global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => ({}) }) as any;

describe('POST /api/auth/request-activation', () => {
  const origEnv = process.env;
  beforeEach(() => {
    process.env = { ...origEnv };
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    mockInsert.mockClear();
    mockSelect.mockReset();
    mockRpc.mockReset();
  });
  afterAll(() => { process.env = origEnv; });

  it('happy path: inserts row + returns 200', async () => {
    mockSelect.mockReturnValue({
      eq: jest.fn(() => ({ in: jest.fn(() => ({ gte: jest.fn().mockResolvedValue({ data: [], count: 0, error: null }) })) })),
    });
    mockRpc.mockResolvedValue({ data: { daily_count: 1, minute_count: 1, blocked: false }, error: null });

    const { POST } = await import('../app/api/auth/request-activation/route');
    const req = new NextRequest('http://localhost/api/auth/request-activation', {
      method: 'POST',
      body: JSON.stringify({
        phone: '393331234567',
        display_name: 'Mario Rossi',
        note: 'Allenatore U12',
        trigger_reason: 'rate_limit_ip',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npx jest __tests__/request-activation.integration.test.ts
```
Expected: FAIL "Cannot find module".

- [ ] **Step 3: Implement /api/auth/request-activation/route.ts**

Create `app/api/auth/request-activation/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validatePhone } from '../../../lib/phone';
import { clientIpFromHeaders, hashContactRefSync, logAuditEvent } from '../../../lib/audit';
import * as Sentry from '@sentry/nextjs';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const HOUR_MS = 3600_000;
const DAY_MS = 86_400_000;

interface RequestBody {
  phone: string;
  display_name?: string;
  note?: string;
  trigger_reason?: 'rate_limit_ip' | 'rate_limit_phone' | 'pairing_freeze' | 'direct';
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const cleanPhone = validatePhone(body.phone || '');
  if (!cleanPhone) {
    return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
  }

  const sourceIp = clientIpFromHeaders(req.headers) || 'unknown';
  const userAgent = req.headers.get('user-agent') || null;
  const phoneHash = hashContactRefSync(cleanPhone);

  // Anti-spam: max 1 submission per IP per hour. Reuse rate_limit_state RPC.
  const supabase = getSupabase();
  const now = Date.now();
  const antiSpamKey = `activation_ip:${sourceIp}`;
  const { data: antiSpam, error: antiSpamErr } = await supabase.rpc('rate_limit_record', {
    p_key: antiSpamKey,
    p_now: now,
    p_minute_reset: now + HOUR_MS,
    p_daily_reset: now + DAY_MS,
  });
  if (!antiSpamErr && (antiSpam as any)?.minute_count > 1) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'Hai già inviato una richiesta nell\'ultima ora.' },
      { status: 429 },
    );
  }

  // Anti-duplicate: skip if phone has pending/contacted request in last 7d
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { count } = await supabase
    .from('activation_requests')
    .select('id', { count: 'exact', head: true })
    .eq('phone_hash', phoneHash)
    .in('status', ['pending', 'contacted'])
    .gte('requested_at', sevenDaysAgo);

  if ((count || 0) >= 1) {
    return NextResponse.json({ ok: true, status: 'already_pending' });
  }

  // Sanitize input
  const display_name = (body.display_name || '').trim().slice(0, 100) || null;
  const note = (body.note || '').trim().slice(0, 500) || null;
  const trigger_reason = body.trigger_reason || 'direct';

  // Optional encryption of plaintext phone for outreach (env-gated)
  let phone_e164_enc: string | null = null;
  const encKey = process.env.ACTIVATION_PHONE_ENC_KEY;
  if (encKey) {
    try {
      const crypto = await import('node:crypto');
      const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encKey, 'hex').slice(0, 32), Buffer.alloc(12, 0));
      let enc = cipher.update(cleanPhone, 'utf8', 'hex');
      enc += cipher.final('hex');
      const tag = cipher.getAuthTag().toString('hex');
      phone_e164_enc = enc + ':' + tag;
    } catch (e) {
      Sentry.captureException(e, { tags: { kind: 'activation_enc' } });
    }
  }

  const { error: insertErr } = await supabase.from('activation_requests').insert({
    phone_hash: phoneHash,
    phone_e164_enc,
    display_name,
    note,
    source_ip: sourceIp,
    user_agent: userAgent,
    trigger_reason,
  });

  if (insertErr) {
    console.error('[request-activation] insert err: ' + insertErr.message);
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 });
  }

  // Fire-and-forget webhook notification (3s timeout)
  const notifyUrl = process.env.ACTIVATION_NOTIFY_WEBHOOK_URL;
  if (notifyUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    fetch(notifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'activation_requested',
        phone_hash: phoneHash,
        display_name,
        note,
        trigger_reason,
        requested_at: new Date().toISOString(),
      }),
      signal: controller.signal,
    }).catch(e => {
      Sentry.captureException(e, { tags: { kind: 'activation_notify' } });
    }).finally(() => clearTimeout(timeout));
  }

  void logAuditEvent({
    eventType: 'activation_requested',
    payload: { phone_hash: phoneHash, trigger_reason },
    ipAddress: sourceIp,
  });

  return NextResponse.json({ ok: true, message: 'Richiesta ricevuta. Ti contattiamo entro 24h.' });
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx jest __tests__/request-activation.integration.test.ts
```
Expected: PASS.

- [ ] **Step 5: Add tests for anti-spam and anti-duplicate**

```typescript
it('blocks 2nd submission from same IP within 1h', async () => {
  mockSelect.mockReturnValue({
    eq: jest.fn(() => ({ in: jest.fn(() => ({ gte: jest.fn().mockResolvedValue({ data: [], count: 0, error: null }) })) })),
  });
  mockRpc.mockResolvedValue({ data: { daily_count: 1, minute_count: 2, blocked: false }, error: null });

  const { POST } = await import('../app/api/auth/request-activation/route');
  const req = new NextRequest('http://localhost/api/auth/request-activation', {
    method: 'POST',
    body: JSON.stringify({ phone: '393331234567' }),
  });
  const res = await POST(req);
  expect(res.status).toBe(429);
});

it('returns already_pending for duplicate phone in last 7d', async () => {
  mockSelect.mockReturnValue({
    eq: jest.fn(() => ({ in: jest.fn(() => ({ gte: jest.fn().mockResolvedValue({ data: [{id: 'x'}], count: 1, error: null }) })) })),
  });
  mockRpc.mockResolvedValue({ data: { daily_count: 1, minute_count: 1, blocked: false }, error: null });

  const { POST } = await import('../app/api/auth/request-activation/route');
  const req = new NextRequest('http://localhost/api/auth/request-activation', {
    method: 'POST',
    body: JSON.stringify({ phone: '393331234567' }),
  });
  const res = await POST(req);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('already_pending');
});
```

- [ ] **Step 6: Run all activation tests**

```bash
npx jest __tests__/request-activation.integration.test.ts
```
Expected: PASS.

### Task 3.5: Frontend Step 1b form

**Files:**
- Create: `app/components/connect/StepRichiestaAttivazione.tsx`
- Modify: `app/connect/page.tsx`

- [ ] **Step 1: Create StepRichiestaAttivazione component**

Create `app/components/connect/StepRichiestaAttivazione.tsx`:

```tsx
'use client';

import React, { useState } from 'react';

type TriggerReason = 'rate_limit_ip' | 'rate_limit_phone' | 'pairing_freeze' | 'direct';

interface Props {
  phoneNumber: string;
  triggerReason: TriggerReason;
  onBack: () => void;
}

export default function StepRichiestaAttivazione({ phoneNumber, triggerReason, onBack }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const message = triggerReason === 'pairing_freeze'
    ? 'Il sistema è momentaneamente in sovraccarico. Lasciaci nome e contesto, ti raggiungiamo entro 24h.'
    : 'Hai già provato il pairing più volte oggi. Per attivare manualmente, lasciaci nome e contesto.';

  async function submit() {
    if (state === 'submitting') return;
    setState('submitting');
    setErrorMsg('');
    try {
      const res = await fetch('/api/auth/request-activation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phoneNumber,
          display_name: displayName,
          note,
          trigger_reason: triggerReason,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setState('success');
      } else {
        setState('error');
        setErrorMsg(data.message || data.error || 'Errore. Riprova più tardi.');
      }
    } catch {
      setState('error');
      setErrorMsg('Errore di rete. Riprova.');
    }
  }

  if (state === 'success') {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <div className="text-5xl">✉️</div>
        <h2 className="text-xl font-bold">Richiesta ricevuta!</h2>
        <p className="text-gray-600">Ti contattiamo via WhatsApp entro 24h per attivare il tuo numero.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6 max-w-md mx-auto">
      <button onClick={onBack} className="text-sm text-gray-500 self-start">← Torna indietro</button>
      <h2 className="text-xl font-bold">Richiedi attivazione</h2>
      <p className="text-gray-600">{message}</p>
      <p className="text-sm text-gray-500">Numero: <span className="font-mono">{phoneNumber}</span></p>
      <input
        type="text"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="Il tuo nome (es. Mario Rossi)"
        maxLength={100}
        className="border border-gray-300 rounded px-3 py-2"
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Contesto (opzionale): es. allenatore U12 a Bergamo"
        maxLength={500}
        rows={3}
        className="border border-gray-300 rounded px-3 py-2"
      />
      <button
        onClick={submit}
        disabled={!displayName.trim() || state === 'submitting'}
        className="bg-[#25D366] text-white px-4 py-2 rounded font-bold disabled:opacity-50"
      >
        {state === 'submitting' ? 'Invio...' : 'Invia richiesta'}
      </button>
      {errorMsg && <p className="text-red-600 text-sm">{errorMsg}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Modify connect/page.tsx — add step 1b state + activation flow**

Modify `app/connect/page.tsx`:

- Import: `import StepRichiestaAttivazione from '../components/connect/StepRichiestaAttivazione';`
- Change step state type:
  ```typescript
  const [step, setStep] = useState<'1' | '1b' | '2' | '3'>(initialStep);
  const [activationTrigger, setActivationTrigger] = useState<'rate_limit_ip' | 'rate_limit_phone' | 'pairing_freeze' | 'direct'>('direct');
  ```
- Replace `handleNumeroSubmit` body to handle 429/503:
  ```typescript
  const handleNumeroSubmit = async (rawNumber: string) => {
    const number = rawNumber.replace(/\s/g, '');
    setPhoneNumber(number);
    try {
      const res = await fetch('/api/auth/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: number }),
      });
      const data = await res.json();
      if (res.status === 429) {
        setActivationTrigger(data.reason === 'phone_quota' ? 'rate_limit_phone' : 'rate_limit_ip');
        setStep('1b');
        return;
      }
      if (res.status === 503 && data.error === 'pairing_frozen') {
        setActivationTrigger('pairing_freeze');
        setStep('1b');
        return;
      }
      if (data.pairingCode && data.sessionId) {
        setPairingCode(data.pairingCode);
        setSessionId(data.sessionId);
        setCodeExpiresAt(Date.now() + 600 * 1000);
        setStep('2');
      } else {
        alert(data.error || 'Errore di connessione. Riprova.');
      }
    } catch {
      alert('Errore di rete. Riprova.');
    }
  };
  ```
- Also handle `initialStep === 'activation-request'`:
  ```typescript
  const initialStep = ((searchParams.get('step') as '1' | '1b' | '2' | '3') ||
    (searchParams.get('step') === 'activation-request' ? '1b' : '1'));
  ```
- Add render branch:
  ```tsx
  {step === '1b' && (
    <StepRichiestaAttivazione
      phoneNumber={phoneNumber}
      triggerReason={activationTrigger}
      onBack={() => setStep('1')}
    />
  )}
  ```

- [ ] **Step 3: Visual smoke**

```bash
npm run dev
# Apri http://localhost:3000/connect
# Inserisci 393331234567, submit (verifica flow normale)
# Apri http://localhost:3000/connect?step=activation-request → vede form
```

### Task 3.6: Daily-report extension for pending activations

**Files:**
- Modify: `app/api/cron/daily-report/route.ts`

- [ ] **Step 1: Read current daily-report**

```bash
sed -n '1,80p' app/api/cron/daily-report/route.ts
```

Identify the response payload shape. We'll add a `pending_activations_24h` field.

- [ ] **Step 2: Add pending count query before response**

Near the end of the handler (before `return NextResponse.json(...)`), add:

```typescript
// Fase 0 §1 I5: alert if activation_requests pending notifications were lost
const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
const { count: pendingActivations } = await supabase
  .from('activation_requests')
  .select('id', { count: 'exact', head: true })
  .eq('status', 'pending')
  .gte('requested_at', dayAgo);

const pendingCount = pendingActivations || 0;

if (pendingCount > 0) {
  Sentry.captureMessage(`Pending activation_requests in last 24h: ${pendingCount}`, {
    level: 'warning',
    tags: { kind: 'pending_activations' },
  });
}
```

Add to response payload: `pending_activations_24h: pendingCount`.

- [ ] **Step 3: Manual smoke**

After deploy + 1 fake activation request inserted manually:
```bash
curl "https://whatslaterpush.vercel.app/api/cron/daily-report?secret=$CRON_SECRET" | jq '.pending_activations_24h'
```
Expected: > 0.

### Task 3.7: Commit PR 3

- [ ] **Step 1: Run full test suite**

```bash
npm test
```
Expected: All tests pass (existing 555+ + new ~15).

- [ ] **Step 2: Show diff**

```bash
git status
git diff --stat
git diff app/lib/rate-limit-pairing.ts \
        app/api/auth/init/route.ts \
        app/api/auth/request-activation/route.ts \
        app/components/connect/StepRichiestaAttivazione.tsx \
        app/connect/page.tsx \
        app/api/cron/daily-report/route.ts \
        __tests__/rate-limit-pairing.test.ts \
        __tests__/request-activation.integration.test.ts
```

Wait for Andrea OK.

- [ ] **Step 3: Commit**

```bash
git add app/lib/rate-limit-pairing.ts \
        app/api/auth/init/route.ts \
        app/api/auth/request-activation/route.ts \
        app/components/connect/StepRichiestaAttivazione.tsx \
        app/connect/page.tsx \
        app/api/cron/daily-report/route.ts \
        __tests__/rate-limit-pairing.test.ts \
        __tests__/request-activation.integration.test.ts
git commit -m "feat(pairing): atomic rate limit + activation queue form

Fase 0 §1: rate_limit_record RPC enforces 3 pairing/IP/24h and 3 pairing/
phone-hash/1h on /api/auth/init. Overflow shows /connect step 1b form
which POSTs to /api/auth/request-activation, persisting to new
activation_requests table with PII-safe phone_hash + optional encrypted
phone_e164_enc.

Daily-report cron extended (I5): counts pending activations last 24h
and emits Sentry warning if >0, so missed webhook notifications still
reach Andrea within a day.

Defaults: PAIRING_RATE_LIMIT_ENABLED=true (set to false on Vercel for
first 24h smoke, then remove env to take code default)."
```

---

# PR 4 — §6 Watchdog Per-Egress + Freeze Rule + Ops Unquarantine

**Branch:** main.
**Files touched:** 3 (1 modified monitoring, 1 new route, 1 test file).
**Risk:** Low — extends existing watchdog without breaking legacy.
**Effort:** ~2-3h.
**Depends on:** PR 2 mergiato (audit `pairing_started` ha `egress_id` in payload).

### Task 4.1: Extend checkPairingBlackout into per-egress + legacy

**Files:**
- Modify: `app/lib/monitoring.ts`
- Create: `__tests__/monitoring-egress.test.ts`

- [ ] **Step 1: Write failing test for per-egress quarantine trigger**

Create `__tests__/monitoring-egress.test.ts`:

```typescript
import { checkPairingBlackout } from '../app/lib/monitoring';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

describe('checkPairingBlackout per-egress', () => {
  let mockFrom: jest.Mock;
  let mockInsert: jest.Mock;

  beforeEach(() => {
    mockInsert = jest.fn().mockResolvedValue({ error: null });
    mockFrom = jest.fn();
    const { createClient } = require('@supabase/supabase-js');
    (createClient as jest.Mock).mockReturnValue({
      from: mockFrom,
    });
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  });

  it('quarantines egress with 5+ started and 0 completed in 24h', async () => {
    // Mock: 5 pairing_started events with egress_id=A, 0 completed
    mockFrom.mockImplementation((table: string) => {
      if (table === 'audit_events') {
        return {
          select: jest.fn(() => ({
            in: jest.fn(() => ({
              gte: jest.fn().mockResolvedValue({
                data: [
                  { event_type: 'pairing_started', payload: { egress_id: 'ipr-fra-01' } },
                  { event_type: 'pairing_started', payload: { egress_id: 'ipr-fra-01' } },
                  { event_type: 'pairing_started', payload: { egress_id: 'ipr-fra-01' } },
                  { event_type: 'pairing_started', payload: { egress_id: 'ipr-fra-01' } },
                  { event_type: 'pairing_started', payload: { egress_id: 'ipr-fra-01' } },
                ],
                error: null,
              }),
              filter: jest.fn(() => ({ order: jest.fn(() => ({ limit: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })) })) })),
            })),
          })),
          insert: mockInsert,
        };
      }
      return {} as any;
    });

    const result = await checkPairingBlackout();
    expect(result.status).toBe('critical');
    // Verify quarantine audit was inserted
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'egress_quarantine',
      payload: expect.objectContaining({ egress_id: 'ipr-fra-01' }),
    }));
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npx jest __tests__/monitoring-egress.test.ts
```
Expected: FAIL (current checkPairingBlackout doesn't quarantine).

- [ ] **Step 3: Modify checkPairingBlackout in monitoring.ts**

Replace `checkPairingBlackout` function (lines ~252-284) with:

```typescript
import { isEgressQuarantined, quarantineEgress, loadEgressFromEnv } from './egress-pool';

// 24h pairing blackout. Now split per-egress (when PAIRING_PROXY_ENABLED=true)
// + legacy global check for backwards compat. Auto-disables legacy 25h after
// PAIRING_PROXY_ENABLED_SINCE so transition period doesn't false-positive.
export async function checkPairingBlackout(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('audit_events')
      .select('event_type,payload')
      .in('event_type', ['pairing_started', 'pairing_completed'])
      .gte('created_at', windowStart);
    if (error) {
      return { name: 'pairing_blackout', status: 'critical', message: `Query error: ${error.message}`, checked_at: now };
    }

    const rows = (data || []) as Array<{ event_type: string; payload: any }>;

    // === (a) Per-egress check ===
    const proxyEnabled = process.env.PAIRING_PROXY_ENABLED === 'true';
    if (proxyEnabled) {
      const perEgress = new Map<string, { started: number; completed: number }>();
      for (const r of rows) {
        const eid = r.payload?.egress_id;
        if (!eid) continue;
        const slot = perEgress.get(eid) || { started: 0, completed: 0 };
        if (r.event_type === 'pairing_started') slot.started++;
        else if (r.event_type === 'pairing_completed') slot.completed++;
        perEgress.set(eid, slot);
      }
      const quarantined: string[] = [];
      for (const [eid, { started, completed }] of perEgress.entries()) {
        if (started >= 5 && completed === 0) {
          await quarantineEgress(eid, 'blackout_24h', 24);
          quarantined.push(eid);
        }
      }
      if (quarantined.length > 0) {
        return { name: 'pairing_blackout', status: 'critical', message: `Egress quarantined: ${quarantined.join(', ')}`, checked_at: now };
      }
    }

    // === (b) Legacy global check (auto-disable post-25h after proxy go-live) ===
    const since = process.env.PAIRING_PROXY_ENABLED_SINCE;
    const legacyExpired = since && (Date.now() - new Date(since).getTime() > 25 * 60 * 60 * 1000);
    if (proxyEnabled && legacyExpired) {
      return { name: 'pairing_blackout', status: 'ok', message: 'Per-egress monitoring active; legacy skipped', checked_at: now };
    }

    // Legacy filters only rows without egress_id (pre-A1 era)
    const legacyRows = rows.filter(r => !r.payload?.egress_id);
    let started = 0, completed = 0;
    for (const r of legacyRows) {
      if (r.event_type === 'pairing_started') started++;
      else if (r.event_type === 'pairing_completed') completed++;
    }
    if (completed >= 1) return { name: 'pairing_blackout', status: 'ok', message: `${completed}/${started} pairing riusciti in 24h`, checked_at: now };
    if (started === 0) return { name: 'pairing_blackout', status: 'ok', message: 'Nessun tentativo di pairing nelle 24h', checked_at: now };
    if (started >= 5) return { name: 'pairing_blackout', status: 'critical', message: `${started} tentativi, 0 successi in 24h — pairing rotto`, checked_at: now };
    return { name: 'pairing_blackout', status: 'warning', message: `${started} tentativi, 0 successi in 24h — monitora`, checked_at: now };
  } catch (err: any) {
    return { name: 'pairing_blackout', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
npx jest __tests__/monitoring-egress.test.ts
```
Expected: PASS.

### Task 4.2: Add checkAllEgressDown check + register in runAllChecks

**Files:**
- Modify: `app/lib/monitoring.ts`
- Modify: `__tests__/monitoring-egress.test.ts`

- [ ] **Step 1: Write test for checkAllEgressDown critical**

```typescript
import { checkAllEgressDown } from '../app/lib/monitoring';

describe('checkAllEgressDown', () => {
  const origEnv = process.env;
  beforeEach(() => {
    process.env = { ...origEnv };
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  });
  afterAll(() => { process.env = origEnv; });

  it('returns ok when pool empty', async () => {
    delete process.env.PAIRING_EGRESS_POOL;
    const result = await checkAllEgressDown();
    expect(result.status).toBe('ok');
  });

  it('returns critical when all egress quarantined', async () => {
    process.env.PAIRING_EGRESS_POOL = 'ipr-fra-01,web-mil-01';
    process.env.PAIRING_EGRESS_IPR_FRA_01_HOST = 'p1.x.com';
    process.env.PAIRING_EGRESS_IPR_FRA_01_PORT = '8080';
    process.env.PAIRING_EGRESS_WEB_MIL_01_HOST = 'p2.x.com';
    process.env.PAIRING_EGRESS_WEB_MIL_01_PORT = '8081';

    const futureIso = new Date(Date.now() + 3600_000).toISOString();
    const { createClient } = require('@supabase/supabase-js');
    (createClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          in: jest.fn(() => ({ filter: jest.fn(() => ({ order: jest.fn(() => ({ limit: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({
            data: { event_type: 'egress_quarantine', payload: { until: futureIso } },
            error: null,
          }) })) })) })) })),
        })),
        insert: jest.fn().mockResolvedValue({ error: null }),
      })),
    });

    const result = await checkAllEgressDown();
    expect(result.status).toBe('critical');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Expected: FAIL "is not a function".

- [ ] **Step 3: Add checkAllEgressDown to monitoring.ts**

```typescript
export async function checkAllEgressDown(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const pool = loadEgressFromEnv();
    if (pool.length === 0) {
      return { name: 'all_egress_down', status: 'ok', message: 'No egress pool configured', checked_at: now };
    }
    const states = await Promise.all(pool.map(e => isEgressQuarantined(e.id)));
    const quarantinedCount = states.filter(Boolean).length;
    if (quarantinedCount === pool.length) {
      // Side-effect: emit audit event so freeze is loggato indipendentemente
      const supabase = getSupabase();
      await supabase.from('audit_events').insert({
        event_type: 'pairing_freeze_activated',
        payload: { pool_size: pool.length, triggered_at: now },
      });
      return {
        name: 'all_egress_down',
        status: 'critical',
        message: `All ${pool.length} egress quarantined. Pairing frozen.`,
        checked_at: now,
      };
    }
    return {
      name: 'all_egress_down',
      status: 'ok',
      message: `${pool.length - quarantinedCount}/${pool.length} egress available`,
      checked_at: now,
    };
  } catch (err: any) {
    return { name: 'all_egress_down', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}
```

Update `runAllChecks`:

```typescript
const checks = [
  checkEvolutionApi,
  checkCronStalled,
  checkWebhookInactive,
  checkSupabaseDown,
  checkMessagesStalled,
  checkFailedSpike,
  checkDropletRam,
  checkInstanceFlapping,
  checkPairingBlackout,
  checkAllEgressDown, // NEW
];
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx jest __tests__/monitoring-egress.test.ts
```
Expected: PASS.

### Task 4.3: Create ops unquarantine endpoint

**Files:**
- Create: `app/api/ops/egress/unquarantine/route.ts`
- Create: `__tests__/ops-egress-unquarantine.integration.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/ops-egress-unquarantine.integration.test.ts`:

```typescript
import { NextRequest } from 'next/server';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

describe('POST /api/ops/egress/unquarantine', () => {
  const origEnv = process.env;
  beforeEach(() => {
    process.env = { ...origEnv };
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    process.env.OPS_SECRET = 'secret123';
  });
  afterAll(() => { process.env = origEnv; });

  it('rejects request without OPS_SECRET', async () => {
    const { POST } = await import('../app/api/ops/egress/unquarantine/route');
    const req = new NextRequest('http://localhost/api/ops/egress/unquarantine?id=ipr-fra-01');
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('accepts request with correct OPS_SECRET', async () => {
    const futureIso = new Date(Date.now() + 3600_000).toISOString();
    const mockInsert = jest.fn().mockResolvedValue({ error: null });
    const { createClient } = require('@supabase/supabase-js');
    (createClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn(() => ({ in: jest.fn(() => ({ filter: jest.fn(() => ({ order: jest.fn(() => ({ limit: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({
          data: { event_type: 'egress_quarantine', payload: { egress_id: 'ipr-fra-01', until: futureIso } },
          error: null,
        }) })) })) })) })) })),
        insert: mockInsert,
      })),
    });
    jest.resetModules();
    const { POST } = await import('../app/api/ops/egress/unquarantine/route');
    const req = new NextRequest('http://localhost/api/ops/egress/unquarantine?id=ipr-fra-01&secret=secret123');
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'egress_unquarantine',
    }));
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Expected: FAIL "Cannot find module".

- [ ] **Step 3: Implement endpoint**

Create `app/api/ops/egress/unquarantine/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { unquarantineEgress } from '../../../../lib/egress-pool';

export const dynamic = 'force-dynamic';

function requireOpsSecret(req: NextRequest): boolean {
  const param = new URL(req.url).searchParams.get('secret');
  const header = req.headers.get('x-ops-secret');
  const expected = process.env.OPS_SECRET;
  return !!expected && (param === expected || header === expected);
}

export async function POST(req: NextRequest) {
  if (!requireOpsSecret(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }
  await unquarantineEgress(id, 'manual_ops');
  return NextResponse.json({ ok: true, egress_id: id });
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx jest __tests__/ops-egress-unquarantine.integration.test.ts
```
Expected: PASS.

### Task 4.4: Add route to middleware ops path whitelist

**Files:**
- Modify: `app/middleware.ts` (or equivalent)

- [ ] **Step 1: Locate ops path whitelist**

```bash
grep -rn "\/api\/ops" app/middleware.ts middleware.ts 2>/dev/null
```

The middleware should already exempt `/api/ops/*` from `sw_session` cookie auth (per CLAUDE.md Sprint 7.5 description). Verify the new route `/api/ops/egress/unquarantine` falls under the existing wildcard. If middleware uses `startsWith('/api/ops/')`, no change needed.

- [ ] **Step 2: Smoke**

If no change needed, no commit for this task. Otherwise, add `'/api/ops/egress/unquarantine'` to the explicit whitelist.

### Task 4.5: Commit PR 4

- [ ] **Step 1: Run full test suite**

```bash
npm test
```
Expected: All 555+ baseline + new tests pass.

- [ ] **Step 2: Show diff**

```bash
git status
git diff --stat
git diff app/lib/monitoring.ts \
        app/api/ops/egress/unquarantine/route.ts \
        __tests__/monitoring-egress.test.ts \
        __tests__/ops-egress-unquarantine.integration.test.ts
```

Wait for Andrea OK.

- [ ] **Step 3: Commit**

```bash
git add app/lib/monitoring.ts \
        app/api/ops/egress/unquarantine/route.ts \
        __tests__/monitoring-egress.test.ts \
        __tests__/ops-egress-unquarantine.integration.test.ts
git commit -m "feat(watchdog): per-egress blackout + freeze rule + ops unquarantine

Fase 0 §6: checkPairingBlackout splits into (a) per-egress when
PAIRING_PROXY_ENABLED=true (auto-quarantines egress with 5+ started/
0 completed in 24h) + (b) legacy global preserved for backwards compat
(auto-disabled 25h after PAIRING_PROXY_ENABLED_SINCE).

NEW checkAllEgressDown emits pairing_freeze_activated audit when 100%
of pool is quarantined — /api/auth/init returns 503 (via FrozenError
from getEgressForPairing).

POST /api/ops/egress/unquarantine?id=<egress_id>&secret=\$OPS_SECRET
for manual recovery after IP buy or ASN refresh."
```

---

## Self-review checklist (run after writing plan)

### 1. Spec coverage

| Spec section | Task implementing | Notes |
|---|---|---|
| §1 Rate limit atomico | Task 3.2, 3.3 | RPC rate_limit_record, hash via hashContactRefSync |
| §1 Activation form schema | Task 3.1 | Migration with phone_hash + optional phone_e164_enc |
| §1 Endpoint + form UI | Task 3.4, 3.5 | request-activation route + StepRichiestaAttivazione |
| §1 Daily-report fallback (I5) | Task 3.6 | pending_activations_24h + Sentry warning |
| §2 Egress pool helper | Task 2.1, 2.2, 2.3 | load/get/quarantine/unquarantine/is, MisconfigError + FrozenError |
| §2 Auth/init integration (3-case) | Task 2.4 | 500 misconfig + 503 frozen + normal proxy fields |
| §2 Pool default 2 egress | Task 2.5 Step 3 (post-merge env) | Andrea sets IPRoyal + Webshare manually |
| §5 ToS disclaimer | Task 1.1 | Section + date bump |
| §6 Per-egress watchdog | Task 4.1 | checkPairingBlackout split |
| §6 Freeze rule + checkAllEgressDown | Task 4.2 | Emits pairing_freeze_activated |
| §6 Ops unquarantine | Task 4.3 | OPS_SECRET-guarded endpoint |
| §6 Idempotent quarantine | Task 2.2 (in egress-pool.ts) | read-latest-then-skip |
| §6 Legacy auto-disable | Task 4.1 | PAIRING_PROXY_ENABLED_SINCE 25h gate |

§3 test diagnostico — out of scope (deferred scenario A). ✓
§4 runbook docs — out of scope (separate cycle). ✓

### 2. Placeholder scan

No "TBD" / "TODO" / "implement later" in task code blocks. ✓
All test snippets have actual assertions. ✓
All commit messages are full. ✓

### 3. Type consistency

- `Egress` type used identically across `egress-pool.ts` and integration test.
- `MisconfigError`, `FrozenError` exported from `egress-pool.ts`, imported in `auth/init/route.ts`.
- `enforcePairingRateLimit` signature: `{ sourceIp, phoneHash }` consistent.
- `clientIpFromHeaders` returns `string | null`, callers always `|| 'unknown'`.
- `hashContactRefSync` returns `'h:' + 8hex`, used as rate limit key suffix.

### 4. Identified gaps fixed

- Refactored Task 2.4 + 3.3 to compute `sourceIp` + `phoneHash` once at top of `/api/auth/init` handler, reused by both rate limit AND audit logging (avoid double-call).
- Confirmed `app/lib/audit.ts:30-37` `hashContactRefSync` exists — no new module needed.
- Confirmed `rate_limit_record` RPC signature: `p_key, p_now, p_minute_reset, p_daily_reset` matches usage in `app/lib/rate-limit.ts:68-70`.

---

## Execution handoff

**Plan complete and saved to** `docs/superpowers/plans/2026-06-12-fase-0-ip-burning-mitigations.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task. Each task = 1 subagent that gets only the relevant task context, executes TDD steps, returns diff. I review between tasks. Fast iteration, smaller context per agent.

**2. Inline Execution** — Execute tasks in this session. Batch with checkpoints (1 PR = 1 checkpoint). I show diffs before each commit, Andrea approves, I commit.

**Which approach?**

(For solo founder + "diff prima di ogni commit": Inline Execution is the natural fit. Subagent-Driven is overkill given Andrea wants to review every commit himself.)
