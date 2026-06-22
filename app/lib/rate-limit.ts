import type { SupabaseClient } from '@supabase/supabase-js';

export interface RateState {
  key: string;
  minute_count: number;
  minute_reset: number;
  daily_count: number;
  daily_reset: number;
  blocked: boolean;
  block_reason: string | null;
}

export const RATE_LIMITS = {
  PER_USER_PER_MINUTE: 15,
  PER_USER_PER_DAY: 100,
  PER_INSTANCE_PER_MINUTE: 18,
  // H11(1): ABOVE the highest tier cap (Business = 50/day). The anti-spam block
  // must catch only genuine abuse / a tier-cap bypass — never a Business customer
  // who fully uses their plan. Was 50, i.e. EQUAL to the Business cap, so every
  // maxed-out Business user got flagged as spam on their 50th legitimate send.
  SPAM_THRESHOLD: 100,
};

const MINUTE_MS = 60_000;

// H11(2): next Europe/Rome calendar midnight as UTC ms — the SAME daily boundary
// the cron uses to reset messages_sent_today. Resetting daily_count + the blocked
// flag here (instead of a rolling now+24h) keeps the rate-limiter in step with the
// tier quota: a user blocked at their cap unblocks exactly when the quota refills,
// with no morning-after window where they're under cap but still rate-limited.
// 00:00 is never inside the DST transition hour (02:00-03:00), so the offset probe
// at the target midnight is unambiguous.
export function nextRomeMidnightMs(nowMs: number): number {
  const [y, mo, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(nowMs)).split('-').map(Number);
  // Next Rome calendar day's 00:00, treated first as if it were UTC...
  const guess = Date.UTC(y, mo - 1, d + 1, 0, 0, 0);
  // ...then shifted by Rome's offset at that midnight (probed via Intl).
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(guess));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const romeAsUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return guess - (romeAsUtc - guess);
}

// Reads current state for two keys without mutating. Applies window-reset
// virtually so the caller sees post-reset values for blocked/counts when the
// window has rolled over but no recordSend has yet persisted the reset.
export async function canSend(
  supabase: SupabaseClient,
  userPhone: string,
  instanceName: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const userKey = 'user:' + userPhone;
  const instKey = 'inst:' + instanceName;
  const { data: rows } = await supabase
    .from('rate_limit_state')
    .select('*')
    .in('key', [userKey, instKey]);

  const now = Date.now();
  const rowMap = new Map<string, RateState>();
  for (const r of (rows || []) as RateState[]) rowMap.set(r.key, r);

  const u = rowMap.has(userKey) ? virtualReset(rowMap.get(userKey)!, now) : null;
  const i = rowMap.has(instKey) ? virtualReset(rowMap.get(instKey)!, now) : null;

  if (u?.blocked) return { allowed: false, reason: 'Blocked: ' + (u.block_reason || '') };
  if (u && u.daily_count >= RATE_LIMITS.PER_USER_PER_DAY) return { allowed: false, reason: 'Daily limit' };
  if (u && u.minute_count >= RATE_LIMITS.PER_USER_PER_MINUTE) return { allowed: false, reason: 'Minute limit' };
  if (i && i.minute_count >= RATE_LIMITS.PER_INSTANCE_PER_MINUTE) return { allowed: false, reason: 'Instance limit' };
  return { allowed: true };
}

// Atomic increment for user + instance counters via the rate_limit_record RPC.
// The RPC is a single INSERT ... ON CONFLICT DO UPDATE with CASE-based reset,
// so two parallel calls cannot lose an increment.
// If after-increment the user crosses SPAM_THRESHOLD, marks them blocked.
export async function recordSend(
  supabase: SupabaseClient,
  userPhone: string,
  instanceName: string,
): Promise<{ user: RateState; instance: RateState }> {
  const userKey = 'user:' + userPhone;
  const instKey = 'inst:' + instanceName;
  const now = Date.now();
  const minuteReset = now + MINUTE_MS;
  const dailyReset = nextRomeMidnightMs(now); // H11(2): align with the Rome-midnight tier reset

  const [userRes, instRes] = await Promise.all([
    supabase.rpc('rate_limit_record', { p_key: userKey, p_now: now, p_minute_reset: minuteReset, p_daily_reset: dailyReset }),
    supabase.rpc('rate_limit_record', { p_key: instKey, p_now: now, p_minute_reset: minuteReset, p_daily_reset: dailyReset }),
  ]);
  if (userRes.error) throw new Error('rate_limit_record(user) failed: ' + userRes.error.message);
  if (instRes.error) throw new Error('rate_limit_record(inst) failed: ' + instRes.error.message);

  const user = userRes.data as RateState;
  const instance = instRes.data as RateState;

  if (user.daily_count >= RATE_LIMITS.SPAM_THRESHOLD && !user.blocked) {
    await markBlocked(supabase, userKey, user.daily_count + '/day');
    user.blocked = true;
    user.block_reason = user.daily_count + '/day';
  }
  return { user, instance };
}

export async function markBlocked(
  supabase: SupabaseClient,
  key: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('rate_limit_mark_blocked', { p_key: key, p_reason: reason });
  if (error) throw new Error('rate_limit_mark_blocked failed: ' + error.message);
}

function virtualReset(row: RateState, now: number): RateState {
  const r: RateState = { ...row };
  if (now >= r.minute_reset) r.minute_count = 0;
  if (now >= r.daily_reset) {
    r.daily_count = 0;
    r.blocked = false;
    r.block_reason = null;
  }
  return r;
}
