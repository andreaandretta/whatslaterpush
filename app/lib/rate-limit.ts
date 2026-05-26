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
  SPAM_THRESHOLD: 50,
};

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

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
  const dailyReset = now + DAY_MS;

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
