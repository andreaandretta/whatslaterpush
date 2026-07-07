// RRULE subset (RFC 5545) for WhatsLater recurring messages.
// Supported:
//   FREQ=DAILY
//   FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU  (one or more days)
//   FREQ=MONTHLY;BYMONTHDAY=N               (1-31; months without N are skipped)
//
// Not supported (intentionally): COUNT, UNTIL, INTERVAL>1, BYSETPOS, etc.
// Keep the subset narrow until users actually ask for more.

// (date-fns dropped here: nextOccurrence now does Europe/Rome-wall-clock-preserving
// math via Intl, so DAILY/WEEKLY/MONTHLY keep the user's local time across DST.)

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
type DayCode = typeof DAY_CODES[number];

export interface ParsedRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  byDay?: DayCode[];
  byMonthDay?: number;
}

export function parseRule(rule: string): ParsedRule | null {
  if (typeof rule !== 'string' || rule.length === 0) return null;
  const parts = new Map<string, string>();
  for (const seg of rule.split(';')) {
    const eq = seg.indexOf('=');
    if (eq < 0) return null;
    parts.set(seg.slice(0, eq).toUpperCase(), seg.slice(eq + 1).toUpperCase());
  }
  const freq = parts.get('FREQ');

  if (freq === 'DAILY') return { freq: 'DAILY' };

  if (freq === 'WEEKLY') {
    const byDayRaw = parts.get('BYDAY');
    if (!byDayRaw) return null;
    const days = byDayRaw.split(',').map(d => d.trim());
    if (days.length === 0) return null;
    if (days.some(d => !(DAY_CODES as readonly string[]).includes(d))) return null;
    // Dedupe and keep canonical order.
    const set = new Set(days as DayCode[]);
    const ordered = (DAY_CODES as readonly DayCode[]).filter(d => set.has(d));
    return { freq: 'WEEKLY', byDay: ordered };
  }

  if (freq === 'MONTHLY') {
    const mdRaw = parts.get('BYMONTHDAY');
    if (!mdRaw) return null;
    const day = parseInt(mdRaw, 10);
    if (!Number.isFinite(day) || day < 1 || day > 31) return null;
    return { freq: 'MONTHLY', byMonthDay: day };
  }

  return null;
}

export function isValidRule(rule: string): boolean {
  return parseRule(rule) !== null;
}

// ── Europe/Rome wall-clock helpers (DST-correct) ──
// The Rome wall-clock components of an instant.
function romeParts(d: Date): { y: number; mo: number; dd: number; h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => Number(parts.find(p => p.type === t)!.value);
  return { y: g('year'), mo: g('month'), dd: g('day'), h: g('hour'), mi: g('minute'), s: g('second') };
}

// The UTC instant whose Europe/Rome wall-clock is exactly (y, mo, dd, h, mi, s)
// with `ms` milliseconds. ms is threaded through both Date.UTC calls so it
// cancels in the offset (Rome offsets are whole minutes) and survives to the
// result — Intl only resolves to seconds, so we carry sub-second precision here.
function romeWallClockToUtc(y: number, mo: number, dd: number, h: number, mi: number, s: number, ms = 0): Date {
  const guess = Date.UTC(y, mo - 1, dd, h, mi, s, ms);
  const p = romeParts(new Date(guess));
  const romeAsUtc = Date.UTC(p.y, p.mo - 1, p.dd, p.h, p.mi, p.s, ms);
  const offset = romeAsUtc - guess; // Rome UTC-offset at `guess`
  return new Date(guess - offset);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// The next Europe/Rome midnight strictly after `from` — the instant the daily
// quota resets (reset_daily_counters and claim_daily_quota are both keyed to
// the Rome calendar date). DST-safe: 00:00 always exists in Rome (transitions
// happen at 02:00/03:00), and Date.UTC inside romeWallClockToUtc normalizes
// the dd+1 overflow across month/year ends.
export function nextRomeMidnight(from: Date): Date {
  const p = romeParts(from);
  return romeWallClockToUtc(p.y, p.mo, p.dd + 1, 0, 0, 0);
}

// Returns the next occurrence strictly AFTER `from`, preserving the user's
// Europe/Rome wall-clock time-of-day across DST (a 09:00 reminder stays 09:00,
// CEST or CET). Returns null if rule is invalid or no next occurrence exists in a
// sensible horizon (12 months for MONTHLY day-overflow cases).
//
// Day/week arithmetic runs on a "floating" date (the Rome wall-clock carried in
// UTC fields — a DST-free surface), using UTC accessors so it is independent of
// the runtime timezone; the result is then mapped back to a real instant.
export function nextOccurrence(rule: string, from: Date): Date | null {
  const parsed = parseRule(rule);
  if (!parsed) return null;

  const p = romeParts(from);
  const ms = from.getUTCMilliseconds(); // Intl drops sub-second; carry it through.
  const floating = new Date(Date.UTC(p.y, p.mo - 1, p.dd, p.h, p.mi, p.s));
  const back = (f: Date) => romeWallClockToUtc(
    f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate(), f.getUTCHours(), f.getUTCMinutes(), f.getUTCSeconds(), ms,
  );

  if (parsed.freq === 'DAILY') {
    return back(new Date(floating.getTime() + DAY_MS));
  }

  if (parsed.freq === 'WEEKLY') {
    const targetDows = parsed.byDay!.map(dc => DAY_CODES.indexOf(dc));
    const currentDow = floating.getUTCDay();
    for (let offset = 1; offset <= 7; offset++) {
      if (targetDows.includes((currentDow + offset) % 7)) {
        return back(new Date(floating.getTime() + offset * DAY_MS));
      }
    }
    return null;
  }

  if (parsed.freq === 'MONTHLY') {
    const targetDay = parsed.byMonthDay!;
    let y = p.y;
    let mo = p.mo; // 1-based
    for (let tries = 0; tries < 12; tries++) {
      mo += 1;
      if (mo > 12) { mo = 1; y += 1; }
      const lastDayOfMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate(); // last day of month `mo`
      if (targetDay <= lastDayOfMonth) {
        return romeWallClockToUtc(y, mo, targetDay, p.h, p.mi, p.s, ms);
      }
    }
    return null;
  }

  return null;
}

// Returns the next `count` occurrences strictly after `from`, time-of-day
// preserved. Stops early (shorter array) if the rule runs out within the
// horizon used by `nextOccurrence`.
export function nextOccurrences(rule: string, from: Date, count: number): Date[] {
  const out: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const next = nextOccurrence(rule, cursor);
    if (!next) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

export type ReconcileDecision = { insert: false } | { insert: true; scheduledAt: string };

/**
 * Decide whether a recurring chain needs its next occurrence created. Used by the
 * cron's reconciliation sweep — the single place that guarantees the next
 * occurrence exists regardless of how the previous one ended (happy-path insert,
 * stale-'processing' recovery, or a lambda death between status='sent' and the
 * insert). The returned scheduledAt is the deterministic next occurrence (no
 * jitter) so concurrent/duplicate creations collapse onto one row via the
 * uniq_recurrence_occurrence index.
 */
export function reconcileRecurringChain(chain: {
  hasLiveRow: boolean;
  latestStatus: string;
  latestScheduledAt: string;
  rule: string;
}, nowMs: number = Date.now()): ReconcileDecision {
  if (chain.hasLiveRow) return { insert: false };
  // Only revive a chain whose latest row ended terminally as sent/failed. A
  // 'cancelled' latest means the user stopped the chain — never revive it.
  if (chain.latestStatus !== 'sent' && chain.latestStatus !== 'failed') return { insert: false };
  let next = nextOccurrence(chain.rule, new Date(chain.latestScheduledAt));
  if (!next) return { insert: false };
  // Fast-forward clamp: a chain that stalled (quota starvation, long
  // disconnect, post-beta backlog) must SKIP its missed occurrences, not
  // deliver them late — recreating a weeks-old "next" makes it instantly due,
  // so the chain would "catch up" by firing stale reminders back-to-back and
  // burning the daily quota on wrong-date content. Bounded so a chain dead
  // for years cannot spin the sweep; past the cap we drop it (insert: false)
  // rather than guess.
  for (let skipped = 0; next.getTime() <= nowMs; skipped++) {
    if (skipped >= 500) return { insert: false };
    const candidate = nextOccurrence(chain.rule, next);
    if (!candidate) return { insert: false };
    next = candidate;
  }
  return { insert: true, scheduledAt: next.toISOString() };
}
