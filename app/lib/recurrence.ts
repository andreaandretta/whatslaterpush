// RRULE subset (RFC 5545) for WhatsLater recurring messages.
// Supported:
//   FREQ=DAILY
//   FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU  (one or more days)
//   FREQ=MONTHLY;BYMONTHDAY=N               (1-31; months without N are skipped)
//
// Not supported (intentionally): COUNT, UNTIL, INTERVAL>1, BYSETPOS, etc.
// Keep the subset narrow until users actually ask for more.

import { addDays, addMonths, getDay, setDate } from 'date-fns';

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

// Returns the next occurrence strictly AFTER `from`, preserving time-of-day.
// Returns null if rule is invalid or no next occurrence exists in a sensible
// horizon (12 months for MONTHLY day-overflow cases).
export function nextOccurrence(rule: string, from: Date): Date | null {
  const parsed = parseRule(rule);
  if (!parsed) return null;

  if (parsed.freq === 'DAILY') {
    return addDays(from, 1);
  }

  if (parsed.freq === 'WEEKLY') {
    const targetDows = parsed.byDay!.map(d => DAY_CODES.indexOf(d));
    const currentDow = getDay(from);
    for (let offset = 1; offset <= 7; offset++) {
      const candidateDow = (currentDow + offset) % 7;
      if (targetDows.includes(candidateDow)) {
        return addDays(from, offset);
      }
    }
    return null;
  }

  if (parsed.freq === 'MONTHLY') {
    const targetDay = parsed.byMonthDay!;
    // Walk forward month by month until we find one that has targetDay.
    let candidate = addMonths(from, 1);
    for (let tries = 0; tries < 12; tries++) {
      const lastDayOfMonth = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
      if (targetDay <= lastDayOfMonth) {
        return setDate(candidate, targetDay);
      }
      candidate = addMonths(candidate, 1);
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
}): ReconcileDecision {
  if (chain.hasLiveRow) return { insert: false };
  // Only revive a chain whose latest row ended terminally as sent/failed. A
  // 'cancelled' latest means the user stopped the chain — never revive it.
  if (chain.latestStatus !== 'sent' && chain.latestStatus !== 'failed') return { insert: false };
  const next = nextOccurrence(chain.rule, new Date(chain.latestScheduledAt));
  if (!next) return { insert: false };
  return { insert: true, scheduledAt: next.toISOString() };
}
