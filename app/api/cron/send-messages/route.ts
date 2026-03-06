// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ═══ ISSUE #2: IN-MEMORY RATE LIMITER ═══
interface RateState {
        minuteCount: number;
        minuteReset: number;
        dailyCount: number;
        dailyReset: number;
        blocked: boolean;
        blockReason?: string;
}

const rateLimits: Map<string, RateState> = new Map();

const LIMITS = {
        PER_USER_PER_MINUTE: 15,
        PER_USER_PER_DAY: 100,
        PER_INSTANCE_PER_MINUTE: 18,
        SPAM_THRESHOLD: 50,
};

function getRateState(key: string): RateState {
        const now = Date.now();
        let state = rateLimits.get(key);
        if (!state) {
                    state = { minuteCount: 0, minuteReset: now + 60000, dailyCount: 0, dailyReset: now + 86400000, blocked: false };
                    rateLimits.set(key, state);
                    return state;
        }
        if (now >= state.minuteReset) {
                    state.minuteCount = 0;
                    state.minuteReset = now + 60000;
        }
        if (now >= state.dailyReset) {
                    state.dailyCount = 0;
                    state.dailyReset = now + 86400000;
                    state.blocked = false;
                    state.blockReason = undefined;
        }
        return state;
}

function canSend(userPhone: string, instanceName: string): { allowed: boolean; reason?: string } {
        const userState = getRateState(`user:${userPhone}`);
        const instState = getRateState(`inst:${instanceName}`);
        if (userState.blocked) return { allowed: false, reason: `Blocked: ${userState.blockReason}` };
        if (userState.dailyCount >= LIMITS.PER_USER_PER_DAY) return { allowed: false, reason: 'Daily limit reached' };
        if (userState.minuteCount >= LIMITS.PER_USER_PER_MINUTE) return { allowed: false, reason: 'Minute limit reached' };
        if (instState.minuteCount >= LIMITS.PER_INSTANCE_PER_MINUTE) return { allowed: false, reason: 'Instance limit reached' };
        return { allowed: true };
}

function recordSend(userPhone: string, instanceName: string) {
        const userState = getRateState(`user:${userPhone}`);
        const instState = getRateState(`inst:${instanceName}`);
        userState.minuteCount++;
        userState.dailyCount++;
        instState.minuteCount++;
        if (userState.dailyCount >= LIMITS.SPAM_THRESHOLD) {
                    userState.blocked = true;
                    userState.blockReason = `Too many messages (${userState.dailyCount}/day)`;
                    console.warn('RATE: User blocked:', userPhone);
        }
}

async function checkFailures(supabase: any, userPhone: string): Promise<boolean> {
        const { count } = await supabase
            .from('scheduled_messages')
            .select('id', { count: 'exact', head: true })
            .eq('instance_phone', userPhone)
            .eq('status', 'failed')
            .gte('created_at', new Date(Date.now() - 86400000).toISOString());
        if ((count || 0) >= 5) {
                    const userState = getRateState(`user:${userPhone}`);
                    userState.blocked = true;
                    userState.blockReason = `${count} failed messages in 24h`;
                    return true;
        }
        return false;
}

export async function GET(req: Request) {
        const supabase = createClient(
                    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
                    process.env.SUPABASE_SERVICE_ROLE_KEY!
                );

    const startTime = Date.now();
        try {
                    const { searchParams } = new URL(req.url);
                    const secret = searchParams.get('secret');
                    if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
                                    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
                    }

            const { data: users } = await supabase
                        .from('user_instances')
                        .select('id, phone_number, instance_name, trial_ends_at, subscription_status')
                        // BUG1 FIX: removed trial filter to include all users
                // .or('subscription_status.eq.active,trial_ends_at.gte.' + new Date().toISOString());

            let sent = 0, failed = 0, skipped = 0, rateLimited = 0;

            for (const user of users || []) {
                            const instanceName = user.instance_name || 'SchedWhats-Primary';
                            const ownerPhone = user.phone_number;

                        const isBlocked = await checkFailures(supabase, ownerPhone);
                            if (isBlocked) {
                                                try {
                                                                        await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
                                                                                                    method: 'POST',
                                                                                                    headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
                                                                                                    body: JSON.stringify({ number: ownerPhone, text: '⚠️ Messaggi sospesi temporaneamente. Troppi invii falliti. Riprova domani.' })
                                                                        });
                                                } catch (e) {}
                                                skipped++;
                                                continue;
                            }

                        const { data: messages } = await supabase
                                .from('scheduled_messages')
                                .select('*')
                                .eq('user_instance_id', user.id)
                                .eq('status', 'pending')
                                .lte('scheduled_at', new Date().toISOString())
                                .order('scheduled_at', { ascending: true })
                                .limit(10);

                        for (const msg of messages || []) {
                                            const check = canSend(ownerPhone, instanceName);
                                            if (!check.allowed) {
                                                                    console.log('RATE LIMITED:', ownerPhone, check.reason);
                                                                    rateLimited++;
                                                                    // BUG5 FIX: do not shift scheduled_at on rate-limit, just skip this cron tick
                                                continue;
                                            }

                                try {
                                                        // Anti-burst jitter: 2-4s random delay
                                                const jitter = 2000 + Math.random() * 2000;
                                                        await new Promise(r => setTimeout(r, jitter));

                                                const res = await fetch(
                                                                            process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName,
                                                    {
                                                                                    method: 'POST',
                                                                                    headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
                                                                                    body: JSON.stringify({ number: msg.recipient_number, text: msg.parsed_message })
                                                    }
                                                                        );

                                                if (!res.ok) {
                                                                            const errText = await res.text();
                                                                            throw new Error(`HTTP ${res.status}: ${errText}`);
                                                }

                                                recordSend(ownerPhone, instanceName);

                                                await supabase.from('scheduled_messages')
                                                            .update({ status: 'sent', sent_at: new Date().toISOString(), user_notified: true })
                                                            .eq('id', msg.id);

                                                try {
                                                                            await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
                                                                                                            method: 'POST',
                                                                                                            headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
                                                                                                            body: JSON.stringify({ number: ownerPhone, text: '✅ Inviato a ' + (msg.recipient_name || msg.recipient_number) + '!' })
                                                                                });
                                                } catch (notifyErr) {}

                                                sent++;
                                } catch (err: any) {
                                                        const newRetry = (msg.retry_count || 0) + 1;
                                                        await supabase.from('scheduled_messages').update({
                                                                                    status: newRetry >= 3 ? 'failed' : 'pending',
                                                                                    retry_count: newRetry,
                                                                                    error_message: err.message,
                                                                                    scheduled_at: newRetry < 3 ? new Date(Date.now() + (newRetry * 5 * 60 * 1000)).toISOString() : msg.scheduled_at
                                                        }).eq('id', msg.id);

                                                if (newRetry >= 3) {
                                                                            try {
                                                                                                            await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
                                                                                                                                                method: 'POST',
                                                                                                                                                headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
                                                                                                                                                body: JSON.stringify({ number: ownerPhone, text: '❌ Impossibile inviare a ' + (msg.recipient_name || msg.recipient_number) + ' dopo 3 tentativi.' })
                                                                                                                });
                                                                                } catch (e) {}
                                                                            failed++;
                                                }
                                }
                        }
            }

            const duration = Date.now() - startTime;
                    console.log(`CRON: sent=${sent} failed=${failed} skipped=${skipped} rateLimited=${rateLimited} duration=${duration}ms`);
                    return NextResponse.json({ sent, failed, skipped, rateLimited, duration: `${duration}ms`, timestamp: new Date().toISOString() });
        } catch (err: any) {
                    console.error('CRON ERROR:', err.message);
                    return NextResponse.json({ error: err.message }, { status: 500 });
        }
}
