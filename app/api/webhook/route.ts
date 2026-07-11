// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { extractInlineRecipient, extractInlineMessage, extractInlinePhoneAndName, parseAIDatetime, getRomeOffsetMs, nowRome, romeToUtc, formatContactListForLLM } from '../../lib/webhook-utils';
import { getPlanLimits } from '../../lib/plans';
import { isBillingEnabled, getEffectivePlan } from '../../lib/billing';
import { containsAmbiguousTimeKeyword, hasExplicitHHMM } from '../../lib/quick-capture-utils';
import { scrubPiiForLog } from '../../lib/log-scrubber';
import { claimWebhookEvent, releaseWebhookEvent } from '../../lib/webhook-dedup';
import { contactActiveCutoffIso } from '../../lib/contact-window';
export const dynamic = 'force-dynamic';
// The self-chat path chains askAI (8s) + verifyAndFixMessage (6s) + notify;
// the Hobby default ~10s kills it mid-insert, orphaning the dedup claim (#4).
// Vercel now allows up to 300s; 30s covers the worst-case LLM chain.
export const maxDuration = 30;

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── DB Logger (temporary — writes to webhook_logs table for debugging) ──
// Object payloads are passed through scrubPiiForLog so message bodies, phone
// numbers and recipient names never reach `webhook_logs.data` in cleartext.
// String payloads pass through (callers building free-form strings own their
// own PII discipline) — the 2000-char cap is a last-resort safety net.
async function dbLog(tag: string, data: any) {
  try {
    let text: string;
    if (typeof data === 'string') {
      text = data;
    } else if (data && typeof data === 'object') {
      text = JSON.stringify(scrubPiiForLog(data as Record<string, unknown>));
    } else {
      text = String(data);
    }
    await supabase.from('webhook_logs').insert({ tag, data: text.substring(0, 2000) });
  } catch {}
}

// ── Contact-cache helpers ────────────────────────────────────────────────────
// Used by the CONTACTS_SET / CONTACTS_UPSERT / CONTACTS_UPDATE /
// MESSAGING_HISTORY_SET branch to normalise Baileys contact objects into
// rows for upsert_whatsapp_contacts(p_rows JSONB).

type ContactSource = 'CONTACTS_SET' | 'CONTACTS_UPSERT' | 'CONTACTS_UPDATE' | 'MESSAGING_HISTORY_SET';

function contactRowsFromPayload(
  rawList: any[],
  userPhone: string,
  source: ContactSource
): Array<{ user_phone: string; contact_number: string; name: string | null; push_name: string | null; profile_pic_url: string | null; source: ContactSource }> {
  const rows: Array<any> = [];
  const seen = new Set<string>();
  for (const c of rawList || []) {
    // Evolution sometimes nulls remoteJid and puts the JID in `id`; mirror
    // the extractJid logic from /api/contacts/route.ts.
    const rawJid: string | undefined =
      (typeof c?.remoteJid === 'string' && c.remoteJid.includes('@')) ? c.remoteJid :
      (typeof c?.id === 'string' && c.id.includes('@')) ? c.id :
      undefined;
    if (!rawJid) continue;
    if (rawJid.includes('@g.us') || rawJid.includes('@broadcast')) continue;
    const numericPart = (rawJid.split('@')[0] || '').split(':')[0];
    if (!/^\d{8,15}$/.test(numericPart)) continue;
    if (numericPart === userPhone) continue;
    if (seen.has(numericPart)) continue;
    seen.add(numericPart);

    const name = (typeof c?.name === 'string' && c.name.trim()) ? c.name.trim() : null;
    const pushName =
      (typeof c?.pushName === 'string' && c.pushName.trim()) ? c.pushName.trim() :
      (typeof c?.notify === 'string' && c.notify.trim()) ? c.notify.trim() :
      null;
    const profilePicUrl =
      (typeof c?.profilePicUrl === 'string' && c.profilePicUrl.trim()) ? c.profilePicUrl.trim() :
      null;

    rows.push({
      user_phone: userPhone,
      contact_number: numericPart,
      name,
      push_name: pushName,
      profile_pic_url: profilePicUrl,
      source,
    });
  }
  return rows;
}

async function userPhoneForInstance(instanceName: string): Promise<string | null> {
  if (!instanceName) return null;
  const { data } = await supabase
    .from('user_instances')
    .select('phone_number')
    .eq('instance_name', instanceName)
    .maybeSingle();
  return (data as any)?.phone_number || null;
}

// Rome timezone helpers imported from ../../lib/webhook-utils

// ── Legacy regex parser (fallback if OpenAI fails) ──
const NUMERI_IT = { 'un':1,'uno':1,'una':1,'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,'sette':7,'otto':8,'nove':9,'dieci':10,'undici':11,'dodici':12,'quindici':15,'venti':20,'trenta':30,'quaranta':40,'cinquanta':50,'sessanta':60 };
function normalizeNumbers(s) {
  for (const [w,n] of Object.entries(NUMERI_IT)) s = s.replace(new RegExp('\\b'+w+'\\b','gi'),String(n));
  return s;
}

function parseCommand(text) {
  const norm = normalizeNumbers(text.toLowerCase());
  const nowR = nowRome();
  const dateM = /il\s+(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\s*(?:alle?\s+(\d{1,2})(?::(\d{2}))?)?/.exec(norm);
  if (dateM) {
    const d = new Date(nowR);
    d.setDate(parseInt(dateM[1])); d.setMonth(parseInt(dateM[2]) - 1);
    if (dateM[3]) { const yr = dateM[3].length === 2 ? '20'+dateM[3] : dateM[3]; d.setFullYear(parseInt(yr)); }
    d.setHours(dateM[4] ? parseInt(dateM[4]) : 9, dateM[5] ? parseInt(dateM[5]) : 0, 0, 0);
    return { date: romeToUtc(d) };
  }
  const fraM = /(?:fra|tra)\s+(\d+)\s*(minuto|minuti|ora|ore|giorno|giorni)/.exec(norm);
  if (fraM) {
    const n=parseInt(fraM[1]), u=fraM[2], d=new Date(nowR);
    if (u.startsWith('minut')) d.setMinutes(d.getMinutes()+n);
    else if (u.startsWith('or')) d.setHours(d.getHours()+n);
    else d.setDate(d.getDate()+n);
    return { date: romeToUtc(d) };
  }
  const domM = /domani(?:\s+(?:mattina|pomeriggio|sera))?(?:\s+alle?\s+(\d{1,2})(?::(\d{2}))?)?/.exec(norm);
  if (domM) {
    const d=new Date(nowR); d.setDate(d.getDate()+1);
    if (domM[1]) { d.setHours(parseInt(domM[1]), domM[2]?parseInt(domM[2]):0, 0, 0); }
    else if (/pomeriggio/.test(domM[0])) { d.setHours(14, 0, 0, 0); }
    else if (/sera/.test(domM[0])) { d.setHours(20, 0, 0, 0); }
    else { d.setHours(9, 0, 0, 0); }
    return { date: romeToUtc(d) };
  }
  const staM = /(?:stasera|stamattina|stanotte)(?:\s+alle?\s+(\d{1,2})(?::(\d{2}))?)?/.exec(norm);
  if (staM) {
    const d=new Date(nowR); const kw=staM[0].split(/\s/)[0];
    if (staM[1]) { d.setHours(parseInt(staM[1]), staM[2]?parseInt(staM[2]):0, 0, 0); }
    else if (kw==='stamattina') d.setHours(8,0,0,0);
    else if (kw==='stasera') d.setHours(20,0,0,0);
    else d.setHours(23,0,0,0);
    if (d<=nowR) d.setDate(d.getDate()+1);
    return { date: romeToUtc(d) };
  }
  const alleM = /alle?\s+(\d{1,2})(?::(\d{2}))?/.exec(norm);
  if (alleM) {
    const d=new Date(nowR); d.setHours(parseInt(alleM[1]), alleM[2]?parseInt(alleM[2]):0, 0, 0);
    if (d<=nowR) d.setDate(d.getDate()+1);
    return { date: romeToUtc(d) };
  }
  return null;
}

const SCHED_KW = /\b(manda|mandami|mandagli|mandale|scrivi|scrivimi|scrivigli|scrivile|dici|digli|dille|avvisa|avvisami|invia|inviami|ricordami|ricorda|promemoria|reminder|comunica)\b/gi;

function extractContent(raw, cmdStart, cmdEnd) {
  let t = raw.replace(SCHED_KW, '');
  const timePatterns = [
    /il\s+\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\s*(?:alle?\s+\d{1,2}(?::\d{2})?)?/gi,
    /fra\s+(?:\d+|un[oa]?|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|quindici|venti|trenta|quaranta|cinquanta|sessanta)\s*(?:minuto|minuti|ora|ore|giorno|giorni)/gi,
    /domani(?:\s+(?:mattina|pomeriggio|sera|alle?\s+\d{1,2}(?::\d{2})?))?/gi,
    /(?:stasera|stamattina|stanotte)(?:\s+alle?\s+\d{1,2}(?::\d{2})?)?/gi,
    /alle?\s+\d{1,2}(?::\d{2})?/gi,
    /tra\s+(?:\d+|un[oa]?|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s*(?:minuto|minuti|ora|ore|giorno|giorni)/gi,
  ];
  for (const p of timePatterns) t = t.replace(p, ' ');
  t = t.replace(/^[\s,.:;!?\-]+|[\s,.:;!?\-]+$/g, '').replace(/\s{2,}/g, ' ').trim();
  if (!t || t.length < 2) {
    const fallback = raw.replace(SCHED_KW, '').replace(/^[\s,.:;!?\-]+|[\s,.:;!?\-]+$/g, '').replace(/\s{2,}/g, ' ').trim();
    return fallback || raw;
  }
  return t;
}

function formatRome(d) {
  return d.toLocaleString('it-IT',{ day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', timeZone:'Europe/Rome' });
}

// extractInlineRecipient and extractInlineMessage imported from ../../lib/webhook-utils

// ── Smart-confirm: skip awaiting_confirm for known contacts with explicit time ──
function shouldSkipConfirm(
  aiResult: any,
  contactWasKnown: boolean,
  originalText: string
): boolean {
  if (!contactWasKnown) return false;
  if (aiResult.confidence !== 'high') return false;
  if (containsAmbiguousTimeKeyword(originalText)) return false;
  if (!hasExplicitHHMM(originalText)) return false;
  return true;
}

// H#2 affirmative cancel-intent guard. The plain `cancell|annull` keyword check
// let through false positives the LLM occasionally maps to action=cancel /
// cancel_confirm: questions ("come faccio a cancellare?"), explicit negations
// ("non cancellare nulla"), and question-word openers. Set allowBareNo=true on
// the awaiting_confirm path where the system prompt maps a bare "no" reply to
// cancel_confirm.
function hasCancelIntent(text: string, allowBareNo = false): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (t.endsWith('?')) return false;
  // Reject negation: "non cancellare", "non lo annullare", etc.
  if (/\bnon\s+(?:lo|la|li|le|mi|ti|ci|vi|gli)?\s*(?:annull|cancell|elimin|rimuov|disdic|revoc)/i.test(t)) return false;
  // Reject question openers (user is asking, not commanding)
  if (/^(?:come|dove|quando|perch[eé]|cosa|chi|posso|puoi|potete)\b/i.test(t)) return false;
  // Affirmative cancel keywords (IT + EN)
  if (/\b(?:annull|cancell|elimin|rimuov|disdic|revoc|cancel|delete|remove|scarta)/i.test(t)) return true;
  // Bare "no" continuation: matches "no", "no grazie", "no annulla", but NOT
  // "non" (word-boundary after "no" prevents matching "non importa", "non so").
  if (allowBareNo && /^no\b/i.test(t)) return true;
  return false;
}

// Escape ILIKE wildcards to prevent pattern injection
function escapeIlike(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// Guard against AI hallucinating a recipient change. Only accept when the
// suggested name actually appears in the user's raw text AND differs from the
// current recipient. Either the full name or its first word must match.
function shouldUpdateRecipient(suggested: string, current: string | null, raw: string): boolean {
  if (!suggested) return false;
  const s = suggested.trim().toLowerCase();
  const c = (current || '').trim().toLowerCase();
  if (!s || s === c) return false;
  const rawLower = raw.toLowerCase();
  if (rawLower.includes(s)) return true;
  const firstWord = s.split(/\s+/)[0];
  if (firstWord.length >= 3 && new RegExp('\\b' + firstWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(rawLower)) {
    return true;
  }
  return false;
}

async function autoSaveContact(
  ownerPhone: string,
  name: string | null,
  number: string,
  plan: string
): Promise<{ saved: boolean; conflict: boolean; conflictNumber?: string }> {
  if (!name) return { saved: false, conflict: false };

  // Check existing contact with same name (case-insensitive)
  const { data: existing } = await supabase.from('pending_contacts')
    .select('recipient_number')
    .eq('owner_phone', ownerPhone)
    .ilike('recipient_name', name)
    .maybeSingle();

  if (existing) {
    if (existing.recipient_number === number) return { saved: false, conflict: false };
    return { saved: false, conflict: true, conflictNumber: existing.recipient_number };
  }

  // Check plan limit — count only ACTIVE saved contacts (created within the
  // 90-day window), same rule as the dashboard cap (app/lib/contact-window.ts).
  const limits = getPlanLimits(plan);
  const { count } = await supabase.from('pending_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('owner_phone', ownerPhone)
    .gte('created_at', contactActiveCutoffIso());
  if ((count || 0) >= limits.maxContacts) {
    return { saved: false, conflict: false };
  }

  await supabase.from('pending_contacts').insert({
    owner_phone: ownerPhone,
    recipient_name: name,
    recipient_number: number,
  });
  return { saved: true, conflict: false };
}

async function findContactByName(ownerPhone, name) {
  if (!name) return null;
  const cleanName = name.trim();
  const safeName = escapeIlike(cleanName);
  console.log('WEBHOOK: findContactByName owner=' + ownerPhone + ' name="' + cleanName + '"');

  // Try exact ILIKE match first
  const { data: pending } = await supabase
    .from('pending_contacts')
    .select('recipient_number, recipient_name, id')
    .eq('owner_phone', ownerPhone)
    .ilike('recipient_name', `%${safeName}%`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pending) {
    console.log('WEBHOOK: Found contact in pending_contacts: ' + pending.recipient_name + ' ' + pending.recipient_number);
    return pending;
  }

  // Try historical messages
  const { data: historical } = await supabase
    .from('scheduled_messages')
    .select('recipient_number, recipient_name')
    .eq('instance_phone', ownerPhone)
    .ilike('recipient_name', `%${safeName}%`)
    .not('recipient_name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (historical) {
    console.log('WEBHOOK: Found contact in history: ' + historical.recipient_name + ' ' + historical.recipient_number);
    return historical;
  }

  // Fallback: get ALL contacts and try fuzzy match (first word, nickname, etc)
  const { data: allContacts } = await supabase
    .from('pending_contacts')
    .select('recipient_number, recipient_name, id')
    .eq('owner_phone', ownerPhone)
    .order('created_at', { ascending: false })
    .limit(20);

  if (allContacts) {
    const nameLower = cleanName.toLowerCase();
    for (const c of allContacts) {
      const cName = (c.recipient_name || '').toLowerCase();
      // Match if contact name starts with the search term or vice versa
      if (cName.startsWith(nameLower) || nameLower.startsWith(cName)) {
        console.log('WEBHOOK: Fuzzy match: "' + cleanName + '" → ' + c.recipient_name);
        return c;
      }
      // Match first word of either
      const cFirst = cName.split(/\s+/)[0];
      const nFirst = nameLower.split(/\s+/)[0];
      if (cFirst === nFirst || cFirst === nameLower || cName === nFirst) {
        console.log('WEBHOOK: First-word match: "' + cleanName + '" → ' + c.recipient_name);
        return c;
      }
    }
  }

  console.log('WEBHOOK: Contact NOT found: "' + cleanName + '"');
  await dbLog('CONTACT_NOT_FOUND', { searched: cleanName, allContacts: allContacts?.map(c => c.recipient_name) });
  return null;
}

async function notifyOwner(instanceName, phone, msg) {
  if (!phone || !instanceName) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
      method:'POST', headers:{ 'apikey': process.env.EVOLUTION_API_KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({ number: phone, text: msg }),
      signal: controller.signal,
    });
    console.log('notify status:', r.status, 'to:', phone, 'via:', instanceName);
  } catch(e) { console.error('notify err:', e.message); }
  finally { clearTimeout(timeout); }
}

function phoneVariants(phone: string): string[] {
  const variants = [phone];
  if (phone.startsWith('39') && phone.length > 9) variants.push(phone.substring(2));
  else variants.push('39' + phone);
  return [...new Set(variants)];
}

async function findUserStrict(instanceName: string, phone: string): Promise<any> {
  const variants = phoneVariants(phone);
  for (const v of variants) {
    const { data } = await supabase
      .from('user_instances')
      .select('id, phone_number, subscription_plan, trial_ends_at, instance_name')
      .eq('instance_name', instanceName)
      .eq('phone_number', v)
      .maybeSingle();
    if (data) {
      console.log(`WEBHOOK: STRICT MATCH found - instance=${instanceName} phone=${v} id=${data.id}`);
      return data;
    }
  }
  console.log(`WEBHOOK: STRICT MATCH failed - no row for instance=${instanceName} phone=[${variants.join(',')}]`);
  return null;
}

// findUserByPhoneOnly REMOVED — caused cross-user instance reassignment bug.
// See commit message for details. Only findUserStrict is used now.

// Baileys DisconnectReason codes (forwarded by Evolution v2 as statusReason),
// mapped to a short human label so the disconnect cause is legible in the DB
// without SSH to the droplet.
function describeDisconnect(code: number | null): string | null {
  if (code == null) return null;
  switch (code) {
    case 401: return 'loggedOut (dispositivo scollegato da WhatsApp)';
    case 403: return 'forbidden (possibile ban/blocco account)';
    case 408: return 'timedOut';
    case 411: return 'multideviceMismatch';
    case 428: return 'connectionClosed (rete/socket)';
    case 440: return 'connectionReplaced (sessione aperta altrove)';
    case 500: return 'badSession';
    case 503: return 'unavailableService';
    case 515: return 'restartRequired (normale dopo il pairing)';
    default: return 'code ' + code;
  }
}

async function handleConnectionUpdate(payload: any): Promise<NextResponse> {
  const instanceName = payload?.instance || '';
  const data = payload?.data;
  const state = data?.state || data?.status || data?.action || '';
  console.log(`WEBHOOK: CONNECTION_UPDATE instance=${instanceName} state=${state}`);
  if (!instanceName) return NextResponse.json({ ok: true });
  let connectionStatus: string;
  if (state === 'open' || state === 'connected') connectionStatus = 'open';
  else if (state === 'close' || state === 'disconnected' || state === 'logged_out') connectionStatus = 'close';
  else if (state === 'connecting' || state === 'qr') connectionStatus = 'connecting';
  else connectionStatus = state || 'unknown';

  // Capture the Baileys disconnect reason Evolution v2 forwards on close
  // (statusReason = DisconnectReason code) so the control tower sees WHY an
  // instance dropped, not just THAT it did - no SSH to the droplet needed.
  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = { connection_status: connectionStatus, last_connection_update: nowIso };
  let discCode: number | null = null;
  let discReason: string | null = null;
  if (connectionStatus === 'close') {
    const rawCode =
      data?.statusReason ??
      data?.lastDisconnect?.error?.output?.statusCode ??
      data?.lastDisconnect?.statusCode ??
      data?.reason ??
      null;
    discCode = Number.isFinite(Number(rawCode)) ? Number(rawCode) : null;
    discReason = describeDisconnect(discCode);
    update.last_disconnect_code = discCode;
    update.last_disconnect_reason = discReason;
    update.last_disconnect_at = nowIso;
  }

  const { data: updated, error } = await supabase
    .from('user_instances')
    .update(update)
    .eq('instance_name', instanceName)
    .select('id, phone_number');
  if (error) console.error(`WEBHOOK: CONNECTION_UPDATE DB error: ${error.message}`);
  else console.log(`WEBHOOK: CONNECTION_UPDATE saved - instance=${instanceName} status=${connectionStatus}` + (connectionStatus === 'close' ? ` reason=${discCode}/${discReason}` : '') + ` rows=${updated?.length || 0}`);

  // Audit each disconnect with its reason (fire-and-forget) so the history
  // survives the next reconnect overwriting the last_disconnect_* columns —
  // EXCEPT benign 515 (restartRequired): Baileys emits it routinely right after
  // pairing and on normal reconnects, so auditing it would feed checkInstanceFlapping
  // false 'rischio ban' criticals and bloat audit_events. The last_disconnect_*
  // columns above still record it for visibility; only the flapping signal skips.
  if (connectionStatus === 'close' && discCode !== 515) {
    try {
      await supabase.from('audit_events').insert({
        user_phone: null,
        event_type: 'instance_disconnect',
        payload: { instance: instanceName, code: discCode, reason: discReason },
      });
    } catch { /* best-effort */ }
  }

  // Mark pending auth session as authenticated when WhatsApp pairing succeeds
  if (connectionStatus === 'open') {
    const ownerJidRaw = data?.ownerJid || data?.wuid || '';
    const ownerPhone = String(ownerJidRaw).split('@')[0];
    if (ownerPhone) {
      const { data: sessions, error: sErr } = await supabase
        .from('pending_auth_sessions')
        .update({ status: 'authenticated', instance_name: instanceName })
        .eq('phone', ownerPhone)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .select('id');
      if (sErr) {
        console.error(`WEBHOOK: pending_auth_sessions update error: ${sErr.message}`);
      } else {
        console.log(`WEBHOOK: pending_auth_sessions marked authenticated count=${sessions?.length || 0} phone=${ownerPhone}`);
        // pairing_completed: numerator counterpart of pairing_started. Gated
        // on the UPDATE actually flipping a row (the `.eq('status','pending')`
        // guard above means we only see >0 sessions on a real pending->auth
        // transition). Reconnect / restart-required (515) re-fires of
        // CONNECTION_UPDATE state=open will find authenticated rows and
        // produce count=0 here — no duplicate completion event emitted.
        if (sessions && sessions.length > 0) {
          // C1 FIX: resolve the egress this pairing went through so the per-egress
          // watchdog (checkPairingBlackout) counts THIS completion against the
          // right egress. Previously pairing_completed carried NO egress_id, so the
          // per-egress 'completed' counter stayed 0 and a HEALTHY egress got
          // quarantined after just 5 SUCCESSFUL pairings. Backfill from the latest
          // pairing_started for this instance (read-only; null on miss -> the
          // legacy aggregation still works, no regression).
          let egressId = null;
          try {
            const { data: startedRow } = await supabase
              .from('audit_events')
              .select('payload')
              .eq('event_type', 'pairing_started')
              .filter('payload->>instance_name', 'eq', instanceName)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            egressId = startedRow?.payload?.egress_id ?? null;
          } catch { /* best-effort: leave egressId null */ }
          try {
            await supabase.from('audit_events').insert({
              user_phone: null,
              event_type: 'pairing_completed',
              payload: { instance_name: instanceName, egress_id: egressId },
            });
          } catch { /* best-effort */ }
        }
      }
    } else {
      console.log(`WEBHOOK: state=open but no ownerJid in payload, skipping auth session update`);
    }
  }

  return NextResponse.json({ ok: true });
}

function extractMessageItem(payload) {
  const data = payload?.data;
  if (!data) return null;
  if (Array.isArray(data.messages) && data.messages.length > 0) {
    const item = data.messages[0];
    return { msgKey: item.key, msgContent: item.message };
  }
  if (data.key && data.message) return { msgKey: data.key, msgContent: data.message };
  return null;
}

// ── DB-level dedup: check if wa_message_id already exists ──
async function isMessageProcessed(msgId: string): Promise<boolean> {
  if (!msgId) return false;
  const { data } = await supabase
    .from('scheduled_messages')
    .select('id')
    .eq('wa_message_id', msgId)
    .limit(1)
    .maybeSingle();
  return !!data;
}

// claimWebhookEvent / releaseWebhookEvent live in lib/webhook-dedup.ts (extracted
// for unit testability). Both take the module supabase client as their 1st arg.

// ── Get pending partial context (awaiting_time, awaiting_recipient, or awaiting_confirm) ──
// Auto-expires records older than 1 hour to prevent stale context from blocking new messages
async function getPendingContext(ownerPhone: string): Promise<any> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  // First, cancel any stale awaiting_* records older than 1 hour
  await supabase.from('scheduled_messages')
    .update({ status: 'cancelled' })
    .eq('instance_phone', ownerPhone)
    .in('status', ['awaiting_time', 'awaiting_recipient', 'awaiting_confirm'])
    .lt('created_at', oneHourAgo);

  const { data } = await supabase.from('scheduled_messages')
    .select('id, recipient_name, recipient_number, parsed_message, scheduled_at, status, caption')
    .eq('instance_phone', ownerPhone)
    .in('status', ['awaiting_time', 'awaiting_recipient', 'awaiting_confirm'])
    .gte('created_at', oneHourAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

// ── AI config: Groq (primary, free) → OpenAI (fallback) ──
function getAIConfig(): { url: string; key: string; model: string; provider: string } | null {
  if (process.env.GROQ_API_KEY) {
    return { url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY, model: 'llama-3.3-70b-versatile', provider: 'groq' };
  }
  if (process.env.OPENAI_API_KEY) {
    return { url: 'https://api.openai.com/v1/chat/completions', key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini', provider: 'openai' };
  }
  return null;
}

// ── AI Assistant (Groq primary, OpenAI fallback) ──
async function askAI(userMessage: string, contactList: string, pendingContext: any): Promise<any> {
  const ai = getAIConfig();
  if (!ai) {
    console.log('WEBHOOK: No AI key set (GROQ_API_KEY or OPENAI_API_KEY), falling back to regex');
    return null;
  }

  const romeNow = nowRome();
  const currentDateTime = romeNow.toLocaleString('it-IT', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
  });
  const currentIso = romeNow.getFullYear() + '-' +
    String(romeNow.getMonth()+1).padStart(2,'0') + '-' +
    String(romeNow.getDate()).padStart(2,'0') + 'T' +
    String(romeNow.getHours()).padStart(2,'0') + ':' +
    String(romeNow.getMinutes()).padStart(2,'0') + ':' +
    String(romeNow.getSeconds()).padStart(2,'0');

  let pendingBlock = '';
  if (pendingContext) {
    if (pendingContext.status === 'awaiting_time') {
      pendingBlock = `\nMessaggio in sospeso per ${pendingContext.recipient_name} — manca orario. Se l'utente dà un orario, usa action="schedule".`;
    } else if (pendingContext.status === 'awaiting_recipient') {
      pendingBlock = `\nMessaggio in sospeso — manca destinatario. Se l'utente dà un nome, usa action="schedule".`;
    } else if (pendingContext.status === 'awaiting_confirm') {
      const schedTime = pendingContext.scheduled_at ? formatRome(new Date(pendingContext.scheduled_at)) : '?';
      pendingBlock = `\nMESSAGGIO IN ATTESA DI CONFERMA → a ${pendingContext.recipient_name}, "${pendingContext.parsed_message}", ${schedTime}. OK/sì=confirm, no/annulla=cancel_confirm, QUALSIASI ALTRO TESTO=modify.`;
    }
  }

  const systemPrompt = `Sei un assistente WhatsApp che programma messaggi. Rispondi SOLO con JSON valido, senza markdown.

REGOLA PIU IMPORTANTE: message_text è il messaggio che RICEVE il destinatario.
Scrivi SOLO il contenuto del messaggio, come se l'utente lo stesse scrivendo direttamente al destinatario.
MAI copiare istruzioni come "di a", "scrivi a", "manda a", "dici a", "ricorda a", "mandaglielo".
Aggiungi saluto e emoji.

ESEMPI:
"di a suocera di ricordare ad Andrea il vaccino alle 10" → recipient_name:"Suocera", message_text:"Ciao! Ricorda ad Andrea che alle 10 ha il vaccino 💉"
"scrivi alla mia ragazza che faccio tardi" → recipient_name:"Amore", message_text:"Amore, stasera faccio tardi! 🙏"
"manda a Marco che si ricordi la riunione" → recipient_name:"Marco", message_text:"Ciao Marco! Ricordati della riunione 👋"
"di ad Andrea di ricordare a suocera il vaccino domani alle 8" → recipient_name:"Suocera", message_text:"Ciao! Ricorda ad Andrea che domani alle 8 ha il vaccino 💉" (il messaggio va a SUOCERA, non ad Andrea)

ATTENZIONE: "di a X di ricordare a Y" = il messaggio va a X, il contenuto riguarda Y.

MODIFICA DI UN MESSAGGIO GIA CONFERMATO (in lista): se l'utente fa riferimento a un messaggio per indice della lista (es. "il messaggio 1 lo devo inviare oggi alle 7", "cambia il 2 a domani alle 15", "modifica messaggio 3: nuovo testo"), usa action="modify_scheduled" e popola modify_target con l'indice come stringa ("1", "2", ...). Popola datetime_iso e/o message_text con i nuovi valori. NON popolare recipient_name a meno che l'utente dica esplicitamente di cambiare destinatario. Questa action è SOLO per messaggi già in lista (non in attesa di conferma).

ORARI RELATIVI: L'ora attuale ISO è ${currentIso}. Quando l'utente dice un orario relativo, CALCOLA datetime_iso sommando all'ora attuale:
- "fra un minuto" / "tra un minuto" → ora attuale + 1 minuto
- "fra 5 minuti" / "tra 5 minuti" → ora attuale + 5 minuti
- "fra un'ora" / "tra un'ora" → ora attuale + 1 ora
- "fra 2 ore" / "tra 2 ore" → ora attuale + 2 ore
- "adesso" / "ora" / "subito" → ora attuale + 1 minuto
Esempio: se ora sono le 14:32, "fra un minuto" → datetime_iso:"${currentIso.substring(0,11)}14:33:00"
IMPORTANTE: FAI IL CALCOLO MATEMATICO, non inventare orari.

CORREZIONE ERRORI ORTOGRAFICI: L'utente scrive su WhatsApp, spesso con errori di battitura. Correggi AUTOMATICAMENTE parole simili a indicatori temporali PRIMA di interpretarle:
- "moani", "dmoani", "domnia", "domna" → "domani"
- "dpdomani", "dopodmani" → "dopodomani"
- "stasrea", "stasrea" → "stasera"
- "stamttina", "stamatina" → "stamattina"
- "fra un minuo", "fra un minutto" → "fra un minuto"
- "alel", "all" → "alle"
REGOLA: se una parola assomiglia a un indicatore temporale, interpretala come tempo, NON come nome di persona.
"moani" NON è un nome → è "domani". "dmoani" NON è un nome → è "domani".

datetime_iso DEVE essere in ora locale italiana SENZA offset (es: "2026-03-14T15:00:00", MAI "2026-03-14T15:00:00+01:00" o con Z).

JSON: {"action":"schedule|ask_time|ask_recipient|confirm|cancel_confirm|modify|modify_scheduled|list|cancel|status|help|chat","recipient_name":string|null,"recipient_number":string|null,"datetime_iso":"ISO locale senza offset"|null,"message_text":"RISCRITTO"|null,"cancel_target":null,"modify_target":null,"reply":"risposta utente","confidence":"high|medium|low"}

## Numero di telefono inline

Se il messaggio dell'utente contiene un numero di telefono diretto nel testo
(es. "Invia a Mario Cementi 3331234567 alle 17: ..."), usalo come
recipient_number senza chiedere la vCard. Estrai il nome dal contesto vicino
al numero e usalo come recipient_name.

## Confidence field (OBBLIGATORIO)

Includi SEMPRE nel JSON un campo "confidence" con uno di questi valori:
- "high" — ora HH:MM esplicita E destinatario chiaro (numero o contatto noto)
- "medium" — ora chiara ma destinatario inferito o ambiguo
- "low" — ora vaga ("tra un po'", "stasera", "presto", "dopo", "più tardi")`;

  const inline = extractInlinePhoneAndName(userMessage);
  let aiUserText = userMessage;
  if (inline.phone) {
    aiUserText = `${inline.textWithoutPhone}\n\n[Sistema: numero inline rilevato — phone="${inline.phone}", name="${inline.name || 'sconosciuto'}". Usa questi come recipient_number/recipient_name nel JSON.]`;
  }

  const userContent = aiUserText + '\n---\nContatti: ' + (contactList || 'nessuno') + '\nOra: ' + currentDateTime + ' (ISO: ' + currentIso + ')' + pendingBlock;

  try {
    console.log('WEBHOOK: AI call provider=' + ai.provider + ' model=' + ai.model + ' user="' + userMessage + '"');
    await dbLog('AI_REQUEST', { provider: ai.provider, model: ai.model, user: userMessage, pending: pendingContext?.status || 'none' });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(ai.url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ai.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ai.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        temperature: 0.1,
        max_tokens: 300,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      console.error('WEBHOOK: AI error (' + ai.provider + '):', res.status, errText.substring(0, 200));
      await dbLog('AI_ERROR', { provider: ai.provider, status: res.status, error: errText.substring(0, 500) });
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      await dbLog('AI_EMPTY', { provider: ai.provider, raw: JSON.stringify(data).substring(0, 500) });
      return null;
    }

    const jsonStr = content.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonStr);
    console.log('WEBHOOK: AI response (' + ai.provider + '):', JSON.stringify(parsed));
    await dbLog('AI_RESPONSE', { provider: ai.provider, ...parsed });
    return parsed;
  } catch (e: any) {
    console.error('WEBHOOK: AI error:', e.message);
    await dbLog('AI_EXCEPTION', { provider: ai.provider, error: e.message });
    return null;
  }
}

// ── Rewrite message if it still contains sending instructions ──
// Safety net: if the main AI call failed to rewrite, this does a dedicated rewrite call
async function verifyAndFixMessage(messageText: string, recipientName: string): Promise<string> {
  // Quick regex check: does the message still contain sending instructions?
  // Matches: "di a", "di' a", "di' ad", "Di a", "dici a", "scrivi a", "manda a", etc.
  const dirtyPatterns = /^(di[''`\s]+a[d\s]|scrivi\s+a\s|manda\s+a\s|dici\s+a\s|invia\s+a\s|ricorda\s+a\s|dice?\s+a\s)/i;
  const dirtyAnywhere = /(di[''`]?\s+a[d]?\s+\w+\s+di\s+ricordare|scrivi\s+all[ao]|manda\s+a\s+\w+\s+che)/i;
  if (!dirtyPatterns.test(messageText.trim()) && !dirtyAnywhere.test(messageText)) {
    // Message looks clean — no rewrite needed
    console.log('WEBHOOK: Message looks clean, no rewrite needed: "' + messageText + '"');
    return messageText;
  }

  console.log('WEBHOOK: Message still dirty, rewriting: "' + messageText + '"');
  const ai = getAIConfig();
  if (!ai) return messageText;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(ai.url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ai.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ai.model,
        messages: [
          { role: 'system', content: 'Riscrivi questo messaggio come se lo stessi inviando direttamente a ' + recipientName + ' su WhatsApp. Rimuovi TUTTE le istruzioni (di a, scrivi a, manda a, dici a). Aggiungi un saluto e emoji. Rispondi SOLO con il messaggio riscritto.' },
          { role: 'user', content: messageText }
        ],
        temperature: 0.2, max_tokens: 150,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return messageText;
    const data = await res.json();
    const fixed = (data.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
    if (fixed && fixed.length > 3) {
      console.log('WEBHOOK: Rewrite result (' + ai.provider + '): "' + messageText + '" → "' + fixed + '"');
      await dbLog('REWRITE', { from: messageText, to: fixed, provider: ai.provider });
      return fixed;
    }
  } catch (e: any) {
    console.error('WEBHOOK: verifyAndFixMessage error:', e.message);
  }
  return messageText;
}

async function handleUndoCommand(
  ownerPhone: string,
  instanceName: string
): Promise<NextResponse> {
  const sixtySecondsAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: latest } = await supabase
    .from('scheduled_messages')
    .select('id, recipient_name, scheduled_at')
    .eq('instance_phone', ownerPhone)
    .eq('status', 'pending')
    .gt('created_at', sixtySecondsAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest) {
    await notifyOwner(instanceName, ownerPhone, 'Niente da annullare (timeout 60s scaduto o nessuna programmazione recente).');
    return NextResponse.json({ ok: true });
  }

  const { data: updated } = await supabase
    .from('scheduled_messages')
    .update({ status: 'cancelled' })
    .eq('id', latest.id)
    .eq('status', 'pending')   // CAS guard: only cancel if still pending
    .select('id')
    .maybeSingle();

  if (!updated) {
    await notifyOwner(instanceName, ownerPhone, 'Troppo tardi: il messaggio è già in invio.');
    return NextResponse.json({ ok: true });
  }

  const recipient = latest.recipient_name || 'destinatario';
  const when = new Date(latest.scheduled_at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  await notifyOwner(instanceName, ownerPhone, `✅ Annullato il messaggio per ${recipient} (${when}).`);
  return NextResponse.json({ ok: true });
}

async function getContactList(ownerPhone: string): Promise<string> {
  // Get contacts from pending_contacts
  const { data: contacts } = await supabase
    .from('pending_contacts')
    .select('recipient_name, recipient_number')
    .eq('owner_phone', ownerPhone)
    .order('created_at', { ascending: false })
    .limit(20);

  // Also get unique contacts from message history
  const { data: historical } = await supabase
    .from('scheduled_messages')
    .select('recipient_name, recipient_number')
    .eq('instance_phone', ownerPhone)
    .not('recipient_name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(30);

  const seen = new Set<string>();
  const all: { name: string; number: string }[] = [];

  for (const c of (contacts || [])) {
    const key = c.recipient_number;
    if (!seen.has(key)) {
      seen.add(key);
      all.push({ name: c.recipient_name, number: c.recipient_number });
    }
  }
  for (const h of (historical || [])) {
    const key = h.recipient_number;
    if (!seen.has(key) && h.recipient_name) {
      seen.add(key);
      all.push({ name: h.recipient_name, number: h.recipient_number });
    }
  }

  // NAMES ONLY to the LLM — never the phone numbers (privacy). The send number is
  // resolved server-side from the chosen contact (recNum = contact.recipient_number).
  return formatContactListForLLM(all);
}

export async function POST(req) {
  let rawBody = '';
  // Tracks a dedup claim THIS request owns, so error paths (the outer catch and
  // the 500-throws funnelled into it) can release it for Evolution's retry. Set
  // only AFTER a successful claim. Success/handled returns leave the claim in
  // place (never released) so an already-handled event is not re-processed.
  let claimedMsgId = null;
  try {
    // Webhook authentication: validate secret from Evolution API (MANDATORY)
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('WEBHOOK: WEBHOOK_SECRET not configured — rejecting all requests');
      return NextResponse.json({ error: 'WEBHOOK_SECRET not configured' }, { status: 500 });
    }
    {
      const secretHeader = req.headers.get('x-webhook-secret');
      const authHeader = req.headers.get('authorization');
      const apiKeyHeader = req.headers.get('apikey');
      const matched =
        secretHeader === webhookSecret ||
        authHeader === webhookSecret ||
        authHeader === 'Bearer ' + webhookSecret ||
        apiKeyHeader === webhookSecret;
      if (!matched) {
        console.log('WEBHOOK: Unauthorized — headers present: x-webhook-secret=' + (secretHeader ? 'YES' : 'NONE') + ' authorization=' + (authHeader ? 'YES' : 'NONE') + ' apikey=' + (apiKeyHeader ? 'YES' : 'NONE'));
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // Read raw body text first so we can both HMAC-verify and parse it.
    // req.json() would consume the body and prevent the signature check.
    const rawText = await req.text();

    // Optional HMAC body verification. Evolution can be configured to sign
    // outgoing webhooks; if it does, header `x-hub-signature-256` (preferred)
    // or `x-webhook-signature` carries the base64url HMAC-SHA256. We accept
    // either header name to stay tolerant of Evolution config variations.
    // Behavior:
    //   header missing + EVOLUTION_SIGNATURE_REQUIRED=true → 401
    //   header missing + flag unset/false → log warn, continue (back-compat
    //                     with current setup which only uses secret-presence)
    //   header present and invalid → 401 (clear sign of tampering or
    //                                 misconfigured secret on Evolution side)
    //   header present and valid   → continue
    const signatureRequired = process.env.EVOLUTION_SIGNATURE_REQUIRED === 'true';
    const sigHeader = req.headers.get('x-hub-signature-256') || req.headers.get('x-webhook-signature');
    let signatureValid: boolean | null = null;
    if (sigHeader) {
      const { verifySignature } = await import('../../lib/hmac');
      const sigValue = sigHeader.replace(/^sha256=/, '');
      signatureValid = await verifySignature(rawText, sigValue, webhookSecret);
      if (!signatureValid) {
        console.error('WEBHOOK: invalid HMAC signature — rejecting (likely tampered body or stale secret)');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    } else if (signatureRequired) {
      console.error('WEBHOOK: signature header missing — rejecting (EVOLUTION_SIGNATURE_REQUIRED=true)');
      return NextResponse.json({ error: 'Signature required' }, { status: 401 });
    } else {
      console.warn('WEBHOOK: signature header missing — accepting on secret-presence only. Configure Evolution to send x-hub-signature-256 for stronger auth.');
    }

    let payload;
    try {
      payload = JSON.parse(rawText);
    } catch {
      console.error('WEBHOOK: body is not valid JSON');
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    rawBody = rawText.substring(0, 500);
    console.log('WEBHOOK incoming (' + rawText.length + ' bytes)'); // no raw body in logs (PII: phone + message text)

    // Audit: structured trail of inbound webhook events. Don't await — the
    // webhook handler is latency-sensitive (Evolution drops if we're slow).
    const { logAuditEvent } = await import('../../lib/audit');
    void logAuditEvent({
      eventType: 'webhook_received',
      payload: {
        event_type: payload?.event || payload?.type || 'unknown',
        instance: payload?.instance || null,
        signature_valid: signatureValid,
      },
    });

    const eventType = payload?.event || payload?.type || 'unknown';
    const evoInstance = payload?.instance || '';
    console.log('WEBHOOK event=' + eventType + ' instance=' + evoInstance);

    // Handle CONNECTION_UPDATE
    if (eventType === 'connection.update' || eventType === 'CONNECTION_UPDATE') {
      const connData = payload?.data;
      const state = connData?.state || connData?.connection || connData?.status;
      console.log('WEBHOOK: CONNECTION_UPDATE state=' + state + ' instance=' + evoInstance);

      await handleConnectionUpdate(payload);

      if (state === 'open' || state === 'connected') {
        try {
          const { data: inst } = await supabase.from('user_instances')
            .select('phone_number, welcome_sent').eq('instance_name', evoInstance).maybeSingle();
          if (inst?.phone_number && !inst.welcome_sent) {
              // Step 1: Disclaimer message
              await notifyOwner(evoInstance, inst.phone_number,
                '⚠️ Importante: WhatsLater usa la funzione "Dispositivi Collegati" di WhatsApp.\n' +
                'Un uso responsabile protegge il tuo numero.\n\n' +
                '• Max 20-30 messaggi mirati al giorno\n' +
                '• Solo a contatti che ti conoscono\n' +
                '• Nessun invio massivo o spam\n\n' +
                'Leggi i termini completi: https://whatslaterpush.vercel.app/terms\n\n' +
                'WhatsLater non e affiliato a Meta/WhatsApp.'
              );
              // Step 2: Wait 1 second to ensure order
              await new Promise(r => setTimeout(r, 1000));
              // Step 3: Welcome message
              await notifyOwner(evoInstance, inst.phone_number,
                'Ciao! Sono il tuo assistente WhatsLater 👋\n\n' +
                'Da qui puoi programmare messaggi WhatsApp. Ecco come:\n\n' +
                '1️⃣ *Presenta un cliente* — tocca 📎 → Contatto e inviami la sua scheda (serve solo la prima volta)\n\n' +
                '2️⃣ *Scrivi il comando* — "Invia a Marco domani alle 15: Ricordati l\'appuntamento!"\n\n' +
                'Prova ora! Inviami il contatto di un tuo cliente 👇'
              );
              // Mark welcome as sent
              await supabase.from('user_instances')
                .update({ welcome_sent: true })
                .eq('instance_name', evoInstance);
          }
        } catch(e) { console.error('WEBHOOK: onboarding error:', e.message); }
      }
      return NextResponse.json({ ok: true });
    }

    // ── Message status updates (delivered / read) ──
    // Baileys WAMessageStatus: 2=SERVER_ACK (sent), 3=DELIVERY_ACK (✓✓),
    // 4=READ (✓✓ blue), 5=PLAYED (audio). We track 3 and 4.
    if (eventType === 'messages.update' || eventType === 'MESSAGES_UPDATE') {
      const updates = Array.isArray(payload?.data) ? payload.data : [payload?.data].filter(Boolean);
      let touched = 0;
      const nowIso = new Date().toISOString();
      for (const upd of updates) {
        const msgId = upd?.key?.id || upd?.keyId;
        const status = typeof upd?.update?.status === 'number'
          ? upd.update.status
          : (typeof upd?.status === 'number' ? upd.status : null);
        if (!msgId || (status !== 3 && status !== 4)) continue;

        // delivered_at: set if missing for both DELIVERY_ACK and READ
        // (READ implies DELIVERED on WhatsApp).
        const { data: delRows } = await supabase
          .from('scheduled_messages')
          .update({ delivered_at: nowIso })
          .eq('evolution_message_id', msgId)
          .is('delivered_at', null)
          .select('id');
        if (delRows?.length) touched += delRows.length;

        if (status === 4) {
          const { data: readRows } = await supabase
            .from('scheduled_messages')
            .update({ read_at: nowIso })
            .eq('evolution_message_id', msgId)
            .is('read_at', null)
            .select('id');
          if (readRows?.length) touched += readRows.length;
        }
      }
      console.log('WEBHOOK: messages.update rows_touched=' + touched);
      return NextResponse.json({ ok: true, touched });
    }

    // ── Contact + history events → cache into whatsapp_contacts ──
    if (
      eventType === 'CONTACTS_SET' ||
      eventType === 'CONTACTS_UPSERT' ||
      eventType === 'CONTACTS_UPDATE' ||
      eventType === 'MESSAGING_HISTORY_SET' ||
      eventType === 'contacts.set' ||
      eventType === 'contacts.upsert' ||
      eventType === 'contacts.update' ||
      eventType === 'messaging-history.set'
    ) {
      const userPhone = await userPhoneForInstance(evoInstance);
      if (!userPhone) {
        console.log('WEBHOOK:CONTACTS skip — instance not mapped, instance=' + evoInstance);
        return NextResponse.json({ ok: true });
      }
      const sourceKey: ContactSource =
        eventType === 'CONTACTS_SET' || eventType === 'contacts.set' ? 'CONTACTS_SET' :
        eventType === 'CONTACTS_UPSERT' || eventType === 'contacts.upsert' ? 'CONTACTS_UPSERT' :
        eventType === 'CONTACTS_UPDATE' || eventType === 'contacts.update' ? 'CONTACTS_UPDATE' :
        'MESSAGING_HISTORY_SET';

      // MESSAGING_HISTORY_SET nests contacts under data.contacts; the other
      // three put the array directly at data.
      const rawList: any[] =
        sourceKey === 'MESSAGING_HISTORY_SET'
          ? (Array.isArray(payload?.data?.contacts) ? payload.data.contacts : [])
          : (Array.isArray(payload?.data) ? payload.data : []);

      const rows = contactRowsFromPayload(rawList, userPhone, sourceKey);
      const withPic = rows.filter(r => r.profile_pic_url).length;
      console.log('WEBHOOK:CONTACTS event=' + sourceKey + ' instance=' + evoInstance + ' incoming=' + rawList.length + ' persisted=' + rows.length + ' withPic=' + withPic);

      if (rows.length === 0) {
        return NextResponse.json({ ok: true, persisted: 0 });
      }

      // Use the merge-aware RPC instead of .upsert() — the RPC's COALESCE
      // logic prevents null/empty values from a later event (e.g. an
      // outgoing MESSAGES_UPSERT that triggers the Evolution #2426 wipe)
      // from blanking a real name captured earlier.
      const { data: persistedCount, error: rpcErr } = await supabase
        .rpc('upsert_whatsapp_contacts', { p_rows: rows });

      if (rpcErr) {
        console.error('WEBHOOK:CONTACTS rpc error:', rpcErr.message);
        return NextResponse.json({ ok: false, error: rpcErr.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, persisted: persistedCount ?? rows.length });
    }

    // ── Extract message ──
    const extracted = extractMessageItem(payload);
    if (!extracted) {
      console.log('WEBHOOK: No message found. event=' + eventType);
      return NextResponse.json({ ok:true });
    }

    const { msgKey, msgContent } = extracted;
    if (!msgContent || !msgKey) {
      console.log('WEBHOOK: No message or key. event=' + eventType);
      return NextResponse.json({ ok:true });
    }

    // ── DEDUP: In-memory first (fast), then DB check before insert ──
    const msgId = msgKey?.id;
    if (msgId && !(await claimWebhookEvent(supabase, msgId))) {
      console.log('WEBHOOK: DUPLICATE (atomic claim) msgId=' + msgId);
      return NextResponse.json({ ok: true, deduplicated: true });
    }
    // We now own the claim (or there was no msgId). Track it so the error paths
    // below release it for Evolution's retry; success/handled returns keep it.
    if (msgId) claimedMsgId = msgId;

    const senderRaw = (msgKey?.remoteJid || '').split('@')[0];
    const isFromMe = msgKey?.fromMe === true;

    if (!isFromMe) {
      console.log('WEBHOOK: Skipped - not fromMe. remoteJid=' + (msgKey?.remoteJid || 'none'));
      // Release the dedup claim so a SIGKILL before this return doesn't
      // permanently orphan the claim and block Evolution's retry (#4).
      if (claimedMsgId) await releaseWebhookEvent(supabase, claimedMsgId);
      return NextResponse.json({ ok:true });
    }
    if (!senderRaw) {
      console.error('WEBHOOK: remoteJid missing');
      if (claimedMsgId) await releaseWebhookEvent(supabase, claimedMsgId);
      return NextResponse.json({ ok:true });
    }

    console.log('WEBHOOK: Processing sender=' + senderRaw + ' evoInstance=' + evoInstance);

    // STRICT IDENTITY RESOLUTION
    let user = await findUserStrict(evoInstance, senderRaw);

    if (!user) {
      // No match: instance+phone combo not in DB. Silently ignore.
      // NEVER auto-reassign instances — it causes cross-user contamination
      // when user A sends a message to user B and both have WhatsLater instances.
      console.log(`WEBHOOK: No user for instance=${evoInstance} phone=${senderRaw}. Ignoring.`);
      if (claimedMsgId) await releaseWebhookEvent(supabase, claimedMsgId);
      return NextResponse.json({ ok: true });
    }

    if (user.instance_name !== evoInstance) {
      console.error(`WEBHOOK: FATAL MISMATCH - user.instance=${user.instance_name} !== evo=${evoInstance}`);
      if (claimedMsgId) await releaseWebhookEvent(supabase, claimedMsgId);
      return NextResponse.json({ error: 'Instance mismatch' }, { status: 409 });
    }

    const ownerPhone = user.phone_number;
    const instanceName = user.instance_name;
    console.log(`WEBHOOK: IDENTITY CONFIRMED - owner=${ownerPhone} instance=${instanceName} user_id=${user.id}`);

    // ── SELF-CHAT CHECK: Only process messages the user sends to themselves ──
    // remoteJid contains the chat partner; for self-chat it equals the owner's phone
    const ownerVariants = phoneVariants(ownerPhone);
    const isSelfChat = ownerVariants.includes(senderRaw);

    if (!isSelfChat) {
      // Groups (@g.us) and broadcasts (@broadcast) are NEVER processed, even with awaiting_confirm
      const fullJid = msgKey?.remoteJid || '';
      if (fullJid.includes('@g.us') || fullJid.includes('@broadcast') || !fullJid.includes('@s.whatsapp.net')) {
        console.log(`WEBHOOK: IGNORED - group/broadcast/non-personal chat. jid=${fullJid} owner=${ownerPhone}`);
        return NextResponse.json({ ok: true });
      }
      // Exception: allow replies to an awaiting_confirm context ONLY in 1:1 personal chats
      const pendingCtx = await getPendingContext(ownerPhone);
      if (pendingCtx && pendingCtx.status === 'awaiting_confirm') {
        console.log(`WEBHOOK: NOT self-chat but awaiting_confirm active in 1:1 chat - allowing. remoteJid=${senderRaw} owner=${ownerPhone}`);
      } else {
        console.log(`WEBHOOK: IGNORED - not self-chat. remoteJid=${senderRaw} owner=${ownerPhone} instance=${instanceName}`);
        return NextResponse.json({ ok: true });
      }
    }

    // ── vCard handling ──
    if (msgContent?.contactMessage) {
      const c = msgContent.contactMessage;
      const vcard = c.vcard || '';
      const name = c.displayName || 'Contatto';
      const waid = vcard.match(/waid=(\d+)/i)?.[1];
      let num = waid || null;
      if (!num) {
        const tel = (vcard.match(/TEL[^:]*:([+\d\s()-]+)/i) || vcard.match(/TEL[:;]+([+\d\s()-]+)/i))?.[1];
        if (tel) { num = tel.replace(/[\s()\-+]/g,''); if (num.startsWith('0')) num = '39' + num; }
      }
      console.log('WEBHOOK: vCard received:', name, num, 'owner:', ownerPhone);
      if (num) {
        // Contact limit enforcement — on the effective plan (beta: 300).
        const userPlan = getEffectivePlan(user.subscription_plan);
        const planLimits = getPlanLimits(userPlan);
        // Count only ACTIVE saved contacts (created within the 90-day window),
        // same rule as the dashboard cap — see app/lib/contact-window.ts.
        const { count: contactCount } = await supabase.from('pending_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('owner_phone', ownerPhone)
          .gte('created_at', contactActiveCutoffIso());

        // Check if this is an existing contact (update) vs new contact
        const { data: existingContact } = await supabase.from('pending_contacts')
          .select('id').eq('owner_phone', ownerPhone).eq('recipient_number', num).maybeSingle();

        if (!existingContact && (contactCount || 0) >= planLimits.maxContacts) {
          console.log('WEBHOOK: Contact limit reached for', ownerPhone, 'plan=' + userPlan, 'count=' + contactCount, 'limit=' + planLimits.maxContacts);
          // Billing off → neutral copy: no plan name, no upsell, no #prezzi
          // anchor (the pricing section is unmounted during the beta, the
          // link would scroll nowhere).
          const upgradeLink = 'https://whatslaterpush.vercel.app/dashboard#prezzi';
          const limitMsg = isBillingEnabled()
            ? '⚠️ Hai raggiunto il limite di ' + planLimits.maxContacts + ' contatti del piano ' + userPlan.charAt(0).toUpperCase() + userPlan.slice(1) + '.\n\n' +
              'Per aggiungere altri contatti, passa al piano superiore:\n' + upgradeLink
            : '⚠️ Hai raggiunto il limite beta di ' + planLimits.maxContacts + ' contatti attivi.\n\nScrivici se ti serve più spazio durante la beta.';
          await notifyOwner(instanceName, ownerPhone, limitMsg);
          return NextResponse.json({ ok: true });
        }

        const { error: upsertErr } = await supabase.from('pending_contacts').upsert(
          { owner_phone: ownerPhone, recipient_number: num, recipient_name: name, created_at: new Date().toISOString() },
          { onConflict: 'owner_phone,recipient_number' }
        );
        if (upsertErr) {
          await supabase.from('pending_contacts').delete().eq('owner_phone', ownerPhone).eq('recipient_number', num);
          await supabase.from('pending_contacts').insert({ owner_phone: ownerPhone, recipient_number: num, recipient_name: name });
        } else {
          console.log('WEBHOOK: vCard saved (recipient stored)'); // no phone/name in logs (PII)
        }
        await notifyOwner(instanceName, ownerPhone, '✅ Contatto "' + name + '" salvato!\nOra puoi scrivere, ad esempio:\n"Invia a ' + name + ' domani alle 15: il tuo messaggio"');
      }
      return NextResponse.json({ ok:true });
    }

    // ── Text message parsing ──
    const raw = msgContent?.conversation || msgContent?.extendedTextMessage?.text || msgContent?.imageMessage?.caption || '';
    if (!raw) { console.log('WEBHOOK: Empty text, skipping'); return NextResponse.json({ ok:true }); }
    console.log('WEBHOOK: Text received (' + raw.length + ' chars)'); // no message text in logs (PII)
    await dbLog('MSG_RECEIVED', { text: raw, sender: ownerPhone });

    // Ignore bot's own instruction text (safety guard)
    if (raw.includes('Per programmare un messaggio') || raw.includes('Benvenuto su WhatsLater') || raw.includes('[Nome]')) {
      console.log('WEBHOOK: Ignoring bot instruction text');
      return NextResponse.json({ ok: true });
    }

    const rawLower = raw.trim().toLowerCase();

    // ── FAST-PATH: OK confirms pending message without calling AI ──
    if (/^(ok|sì|si|conferma|confermo|yes|va bene|perfetto)$/i.test(rawLower)) {
      const { data: awaiting } = await supabase.from('scheduled_messages')
        .select('id, recipient_name, recipient_number, parsed_message, scheduled_at')
        .eq('instance_phone', ownerPhone).eq('status', 'awaiting_confirm')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (awaiting) {
        console.log('WEBHOOK: Fast-path OK, confirming id=' + awaiting.id);
        const { error: updErr } = await supabase.from('scheduled_messages').update({ status: 'pending' }).eq('id', awaiting.id);
        if (updErr) {
          console.error('WEBHOOK: CONFIRM UPDATE FAILED:', updErr.message);
          await notifyOwner(instanceName, ownerPhone, 'Errore conferma: ' + updErr.message);
          throw new Error(updErr.message); // -> outer catch releases the dedup claim, then 500
        }
        await notifyOwner(instanceName, ownerPhone,
          '✅ Confermato! Messaggio a ' + (awaiting.recipient_name || awaiting.recipient_number) +
          ' programmato per ' + formatRome(new Date(awaiting.scheduled_at)) + '.\n' +
          'Scrivi "lista" per vedere i messaggi in coda.');
        return NextResponse.json({ ok: true });
      }
      // No awaiting_confirm — fall through to AI
    }

    // ── FAST-PATH: UNDO cancels last pending message within 60s window ──
    // "undo"/"u" always trigger UNDO. "annulla"/"cancella" (bare or non-numeric suffix)
    // trigger UNDO only when there is no awaiting_confirm to resolve first.
    {
      const isUndo = (
        rawLower === 'undo' ||
        rawLower === 'u' ||
        rawLower === 'annulla ultimo' ||
        rawLower === 'annulla messaggio' ||
        (rawLower.startsWith('annulla ') && !/^annulla\s+\d+$/.test(rawLower))
      );
      const isAnnullaBare = rawLower === 'annulla' || rawLower === 'cancella';
      if (isUndo || isAnnullaBare) {
        // For bare "annulla"/"cancella": let awaiting_confirm fast-path handle it first
        if (isAnnullaBare) {
          const { data: awaitingFirst } = await supabase.from('scheduled_messages')
            .select('id, recipient_name')
            .eq('instance_phone', ownerPhone).eq('status', 'awaiting_confirm')
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (awaitingFirst) {
            await supabase.from('scheduled_messages').delete().eq('id', awaitingFirst.id);
            await notifyOwner(instanceName, ownerPhone, '❌ Messaggio annullato.');
            return NextResponse.json({ ok: true });
          }
        }
        return await handleUndoCommand(ownerPhone, instanceName);
      }
    }

    // ── FAST-PATH: NO cancels awaiting_confirm message ──
    if (/^(no)$/i.test(rawLower)) {
      const { data: awaitingNo } = await supabase.from('scheduled_messages')
        .select('id, recipient_name')
        .eq('instance_phone', ownerPhone).eq('status', 'awaiting_confirm')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (awaitingNo) {
        await supabase.from('scheduled_messages').delete().eq('id', awaitingNo.id);
        await notifyOwner(instanceName, ownerPhone, '❌ Messaggio annullato.');
        return NextResponse.json({ ok: true });
      }
      // No awaiting_confirm — fall through to AI
    }

    // ── AI-powered message understanding ──
    const contactList = await getContactList(ownerPhone);
    const pendingCtx = await getPendingContext(ownerPhone);
    if (pendingCtx) {
      console.log('WEBHOOK: PENDING CONTEXT FOUND:', JSON.stringify({
        status: pendingCtx.status,
        recipient: pendingCtx.recipient_name,
        message: pendingCtx.parsed_message?.substring(0, 60),
        scheduled_at: pendingCtx.scheduled_at,
        id: pendingCtx.id
      }));
    } else {
      console.log('WEBHOOK: No pending context for', ownerPhone);
    }
    console.log('WEBHOOK: Calling AI with message="' + raw + '" contacts=' + (contactList ? 'yes' : 'none') + ' pendingCtx=' + (pendingCtx?.status || 'none'));
    const aiResult = await askAI(raw, contactList, pendingCtx);

    if (aiResult) {
      console.log('WEBHOOK: AI action=' + aiResult.action);

      // ── AI: list ──
      if (aiResult.action === 'list') {
        const { data: pending } = await supabase.from('scheduled_messages')
          .select('id, recipient_name, recipient_number, parsed_message, scheduled_at')
          .eq('user_instance_id', user.id).eq('status', 'pending')
          .order('scheduled_at', { ascending: true }).limit(10);
        if (!pending || pending.length === 0) {
          await notifyOwner(instanceName, ownerPhone, 'Nessun messaggio in coda.');
        } else {
          const listText = pending.map((m, i) => {
            const name = m.recipient_name || m.recipient_number || '?';
            const time = formatRome(new Date(m.scheduled_at));
            const preview = (m.parsed_message || '').substring(0, 30);
            return (i+1) + '. ' + name + ' - ' + time + '\n   "' + preview + (preview.length >= 30 ? '...' : '') + '"';
          }).join('\n\n');
          await notifyOwner(instanceName, ownerPhone, 'Messaggi programmati (' + pending.length + '):\n\n' + listText + '\n\nScrivi "annulla 1" per cancellare.');
        }
        return NextResponse.json({ ok: true });
      }

      // ── AI: cancel ──
      if (aiResult.action === 'cancel') {
        // H#2 sanity check: only honor a cancel if the RAW message expresses
        // affirmative cancel intent (not a question or negation). Guards against
        // the LLM hallucinating action=cancel on innocuous text and silently
        // dropping a real scheduled message. The explicit "annulla N" flow
        // still matches.
        if (!hasCancelIntent(raw)) {
          console.log('WEBHOOK: cancel skipped — no intent keyword in message');
          await notifyOwner(instanceName, ownerPhone, aiResult.reply || 'Per annullare un messaggio scrivi "annulla [numero]" (es. "annulla 1").');
          return NextResponse.json({ ok: true, cancel_skipped: 'no_intent' });
        }
        const target = aiResult.cancel_target;
        if (target && /^\d+$/.test(target)) {
          const idx = parseInt(target) - 1;
          const { data: pending } = await supabase.from('scheduled_messages')
            .select('id, recipient_name, recipient_number, scheduled_at')
            .eq('user_instance_id', user.id).eq('status', 'pending')
            .order('scheduled_at', { ascending: true }).limit(10);
          if (pending && idx >= 0 && idx < pending.length) {
            await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', pending[idx].id);
            await notifyOwner(instanceName, ownerPhone, '❌ Messaggio #' + (idx+1) + ' annullato! A: ' + (pending[idx].recipient_name || '?'));
          } else {
            await notifyOwner(instanceName, ownerPhone, aiResult.reply || 'Nessun messaggio da annullare.');
          }
        } else {
          // Cancel by name or last
          const { data: lastPending } = await supabase.from('scheduled_messages')
            .select('id, recipient_name, recipient_number, scheduled_at')
            .eq('user_instance_id', user.id).eq('status', 'pending')
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (lastPending) {
            await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', lastPending.id);
            await notifyOwner(instanceName, ownerPhone, '❌ Annullato! A: ' + (lastPending.recipient_name || lastPending.recipient_number || '?') + ' Era per: ' + formatRome(new Date(lastPending.scheduled_at)));
          } else {
            await notifyOwner(instanceName, ownerPhone, 'Nessun messaggio da annullare.');
          }
        }
        return NextResponse.json({ ok: true });
      }

      // ── AI: status ──
      if (aiResult.action === 'status') {
        await notifyOwner(instanceName, ownerPhone, '✅ WhatsLater connesso e funzionante!\nScrivi AIUTO per la guida completa.');
        return NextResponse.json({ ok: true });
      }

      // ── AI: help ──
      if (aiResult.action === 'help') {
        await notifyOwner(instanceName, ownerPhone,
          '📖 Come usare WhatsLater:\n\n' +
          '1️⃣ Allega il contatto del destinatario (premi 📎 → Contatto) — solo la prima volta\n' +
          '2️⃣ Scrivi il messaggio, esempio:\n' +
          '   "Invia a Marco domani alle 15: Ricordati la riunione!"\n\n' +
          '💬 Altri comandi:\n' +
          '- LISTA — vedi messaggi programmati\n' +
          '- ANNULLA [numero] — cancella un messaggio\n' +
          '- STATO — controlla connessione');
        return NextResponse.json({ ok: true });
      }

      // ── AI: confirm (user said OK via AI) ──
      if (aiResult.action === 'confirm' && pendingCtx?.status === 'awaiting_confirm') {
        console.log('WEBHOOK: AI confirm, id=' + pendingCtx.id);
        const { error: updErr } = await supabase.from('scheduled_messages').update({ status: 'pending' }).eq('id', pendingCtx.id);
        if (updErr) {
          await notifyOwner(instanceName, ownerPhone, 'Errore conferma: ' + updErr.message);
          throw new Error(updErr.message); // -> outer catch releases the dedup claim, then 500
        }
        await notifyOwner(instanceName, ownerPhone,
          '✅ Confermato! Messaggio a ' + (pendingCtx.recipient_name || pendingCtx.recipient_number) +
          ' programmato per ' + formatRome(new Date(pendingCtx.scheduled_at)) + '.\n' +
          'Scrivi "lista" per vedere i messaggi in coda.');
        return NextResponse.json({ ok: true });
      }

      // ── AI: cancel_confirm (user cancelled via AI) ──
      if (aiResult.action === 'cancel_confirm' && pendingCtx?.status === 'awaiting_confirm') {
        // Same H#2 guard as the cancel branch: the LLM occasionally maps
        // ambiguous replies ("non importa", "boh", "lascia stare") to
        // cancel_confirm. The hard-delete here is irreversible, so require
        // affirmative cancel intent (or a bare "no") in the raw message.
        if (!hasCancelIntent(raw, true)) {
          console.log('WEBHOOK: cancel_confirm skipped — no intent keyword in message');
          await notifyOwner(instanceName, ownerPhone, aiResult.reply || 'Ho un messaggio in attesa di conferma. Scrivi "annulla" per annullarlo o "ok" per confermare.');
          return NextResponse.json({ ok: true, cancel_confirm_skipped: 'no_intent' });
        }
        await supabase.from('scheduled_messages').delete().eq('id', pendingCtx.id);
        await notifyOwner(instanceName, ownerPhone, '❌ Messaggio annullato.');
        return NextResponse.json({ ok: true });
      }

      // ── AI: modify_scheduled (user wants to change an already-confirmed message by index) ──
      if (aiResult.action === 'modify_scheduled') {
        const target = aiResult.modify_target;
        if (!target || !/^\d+$/.test(String(target))) {
          await notifyOwner(instanceName, ownerPhone,
            aiResult.reply || 'Quale messaggio vuoi modificare? Scrivi "lista" per vedere la numerazione, poi usa "modifica messaggio 1: ..." o "cambia il 2 a domani alle 15".');
          return NextResponse.json({ ok: true });
        }
        const idx = parseInt(String(target)) - 1;
        const { data: pending } = await supabase.from('scheduled_messages')
          .select('id, recipient_name, recipient_number, parsed_message, scheduled_at')
          .eq('user_instance_id', user.id).eq('status', 'pending')
          .order('scheduled_at', { ascending: true }).limit(10);

        if (!pending || idx < 0 || idx >= pending.length) {
          await notifyOwner(instanceName, ownerPhone,
            aiResult.reply || `Non trovo il messaggio ${target} in coda. Scrivi "lista" per vedere i messaggi programmati.`);
          return NextResponse.json({ ok: true });
        }

        const targetMsg = pending[idx];
        const updates: any = {};

        if (aiResult.datetime_iso) {
          try {
            const newDate = parseAIDatetime(aiResult.datetime_iso);
            const minScheduleTime = new Date(Date.now() + 60 * 1000);
            if (newDate < minScheduleTime) {
              await notifyOwner(instanceName, ownerPhone,
                '⚠️ La data/ora indicata è nel passato. Scrivi un orario futuro.');
              return NextResponse.json({ ok: true });
            }
            updates.scheduled_at = newDate.toISOString();
          } catch {
            await notifyOwner(instanceName, ownerPhone, 'Non ho capito la data/ora. Riprova.');
            return NextResponse.json({ ok: true });
          }
        }

        if (aiResult.message_text) {
          updates.parsed_message = await verifyAndFixMessage(aiResult.message_text, targetMsg.recipient_name || 'il destinatario');
        }

        // Recipient updates require explicit mention in the raw text (BUG 3 guard)
        if (aiResult.recipient_name && shouldUpdateRecipient(aiResult.recipient_name, targetMsg.recipient_name, raw)) {
          const newContact = await findContactByName(ownerPhone, aiResult.recipient_name);
          if (newContact) {
            updates.recipient_name = newContact.recipient_name;
            updates.recipient_number = newContact.recipient_number;
          }
        } else if (aiResult.recipient_name) {
          console.log('WEBHOOK: MODIFY_SCHEDULED skipping recipient update — "' + aiResult.recipient_name + '" not in raw text (current: "' + targetMsg.recipient_name + '")');
        }

        if (Object.keys(updates).length === 0) {
          await notifyOwner(instanceName, ownerPhone,
            aiResult.reply || 'Cosa vuoi modificare del messaggio ' + (idx + 1) + '? Indica il nuovo orario o il nuovo testo.');
          return NextResponse.json({ ok: true });
        }

        const { error: updErr } = await supabase.from('scheduled_messages').update(updates).eq('id', targetMsg.id);
        if (updErr) {
          await notifyOwner(instanceName, ownerPhone, 'Errore aggiornamento: ' + updErr.message);
          throw new Error(updErr.message); // -> outer catch releases the dedup claim, then 500
        }

        const { data: updated } = await supabase.from('scheduled_messages')
          .select('recipient_name, recipient_number, parsed_message, scheduled_at')
          .eq('id', targetMsg.id).maybeSingle();

        if (updated) {
          await notifyOwner(instanceName, ownerPhone,
            '✏️ Messaggio ' + (idx + 1) + ' aggiornato!\n' +
            'A: ' + (updated.recipient_name || updated.recipient_number) + '\n' +
            'Quando: ' + formatRome(new Date(updated.scheduled_at)) + '\n' +
            'Testo: "' + updated.parsed_message + '"');
        }
        return NextResponse.json({ ok: true });
      }

      // ── AI: modify (user wants to change pending message) ──
      if (aiResult.action === 'modify' && pendingCtx?.status === 'awaiting_confirm') {
        console.log('WEBHOOK: MODIFY handler, AI message_text="' + aiResult.message_text + '" datetime_iso="' + aiResult.datetime_iso + '" recipient="' + aiResult.recipient_name + '"');
        const updates: any = {};
        if (aiResult.message_text) {
          updates.parsed_message = await verifyAndFixMessage(aiResult.message_text, pendingCtx.recipient_name || 'il destinatario');
          console.log('WEBHOOK: MODIFY rewritten message="' + updates.parsed_message + '"');
        }
        if (aiResult.datetime_iso) {
          try {
            updates.scheduled_at = parseAIDatetime(aiResult.datetime_iso).toISOString();
          } catch {}
        }
        if (aiResult.recipient_name && shouldUpdateRecipient(aiResult.recipient_name, pendingCtx.recipient_name, raw)) {
          const newContact = await findContactByName(ownerPhone, aiResult.recipient_name);
          if (newContact) {
            updates.recipient_name = newContact.recipient_name;
            updates.recipient_number = newContact.recipient_number;
          }
        } else if (aiResult.recipient_name) {
          console.log('WEBHOOK: MODIFY skipping recipient update — AI suggested "' + aiResult.recipient_name + '" but not present in raw text "' + raw + '" (current: "' + pendingCtx.recipient_name + '")');
        }

        if (Object.keys(updates).length > 0) {
          await supabase.from('scheduled_messages').update(updates).eq('id', pendingCtx.id);
        }

        // Fetch updated record to show confirmation
        const { data: updated } = await supabase.from('scheduled_messages')
          .select('recipient_name, recipient_number, parsed_message, scheduled_at')
          .eq('id', pendingCtx.id).maybeSingle();

        if (updated) {
          await notifyOwner(instanceName, ownerPhone,
            '✏️ Aggiornato! Invierò a ' + updated.recipient_name + ' il ' + formatRome(new Date(updated.scheduled_at)) + ':\n' +
            '"' + updated.parsed_message + '"\n\n' +
            'Va bene? Scrivi OK per confermare o dimmi come modificarlo.');
        }
        return NextResponse.json({ ok: true });
      }

      // ── AI: modify without awaiting_confirm — treat as new schedule ──
      if (aiResult.action === 'modify' && (!pendingCtx || pendingCtx.status !== 'awaiting_confirm')) {
        console.log('WEBHOOK: MODIFY but no awaiting_confirm context, treating as chat');
        await notifyOwner(instanceName, ownerPhone, aiResult.reply || 'Non c\'è nessun messaggio in attesa di conferma da modificare. Scrivi un nuovo messaggio per programmarlo.');
        return NextResponse.json({ ok: true });
      }

      // ── AI: confirm/cancel_confirm without context ──
      if ((aiResult.action === 'confirm' || aiResult.action === 'cancel_confirm') && (!pendingCtx || pendingCtx.status !== 'awaiting_confirm')) {
        console.log('WEBHOOK: confirm/cancel_confirm but no awaiting_confirm context');
        await notifyOwner(instanceName, ownerPhone, aiResult.reply || 'Non c\'è nessun messaggio in attesa di conferma.');
        return NextResponse.json({ ok: true });
      }

      // ── AI: ask_time (have recipient + message, need time) ──
      if (aiResult.action === 'ask_time') {
        const recipientName = aiResult.recipient_name || pendingCtx?.recipient_name;
        const messageText = aiResult.message_text || pendingCtx?.parsed_message;
        const contact = recipientName ? await findContactByName(ownerPhone, recipientName) : null;

        if (contact && messageText) {
          // Verify and fix message rewriting
          const verifiedMessage = await verifyAndFixMessage(messageText, contact.recipient_name);

          // Clean up any existing awaiting_time/awaiting_recipient for this user
          await supabase.from('scheduled_messages').delete()
            .eq('instance_phone', ownerPhone).in('status', ['awaiting_time', 'awaiting_recipient']);

          await supabase.from('scheduled_messages').insert({
            user_instance_id: user.id, instance_phone: ownerPhone,
            recipient_number: contact.recipient_number, recipient_name: contact.recipient_name,
            caption: raw, parsed_message: verifiedMessage,
            scheduled_at: new Date('2099-01-01').toISOString(), status: 'awaiting_time',
            retry_count: 0, max_retries: 3,
          });
        }
        await notifyOwner(instanceName, ownerPhone,
          aiResult.reply || 'A che ora vuoi inviarlo? (es. oggi alle 18, domani mattina, fra 2 ore)');
        return NextResponse.json({ ok: true });
      }

      // ── AI: ask_recipient (have message + maybe time, need recipient) ──
      if (aiResult.action === 'ask_recipient') {
        const messageText = aiResult.message_text || pendingCtx?.parsed_message;
        if (messageText) {
          await supabase.from('scheduled_messages').delete()
            .eq('instance_phone', ownerPhone).in('status', ['awaiting_time', 'awaiting_recipient']);

          await supabase.from('scheduled_messages').insert({
            user_instance_id: user.id, instance_phone: ownerPhone,
            recipient_number: 'unknown', recipient_name: null,
            caption: raw, parsed_message: messageText,
            scheduled_at: aiResult.datetime_iso ? parseAIDatetime(aiResult.datetime_iso).toISOString() : new Date('2099-01-01').toISOString(),
            status: 'awaiting_recipient',
            retry_count: 0, max_retries: 3,
          });
        }
        await notifyOwner(instanceName, ownerPhone,
          aiResult.reply || 'A chi vuoi inviarlo? Scrivi il nome del contatto.');
        return NextResponse.json({ ok: true });
      }

      // ── AI: schedule ──
      if (aiResult.action === 'schedule') {
        const recipientName = aiResult.recipient_name || pendingCtx?.recipient_name;
        const messageText = aiResult.message_text || pendingCtx?.parsed_message;
        const datetimeStr = aiResult.datetime_iso;

        if (!recipientName) {
          await notifyOwner(instanceName, ownerPhone, aiResult.reply || 'A chi vuoi inviarlo?');
          return NextResponse.json({ ok: true });
        }

        const contact = await findContactByName(ownerPhone, recipientName);
        // contactWasKnown: true when resolved from pending_contacts / history (findContactByName succeeded)
        // false when contact comes from inline phone in AI result (new/unknown contact)
        const contactWasKnown = !!contact;

        if (!contact) {
          // Inline phone fallback: AI provided recipient_number directly (e.g. inline phone in text)
          if (!aiResult.recipient_number) {
            await notifyOwner(instanceName, ownerPhone,
              aiResult.reply || `Non trovo "${recipientName}" in rubrica.\nInvia prima il contatto (📎 → Contatto), poi ripeti il comando.`);
            return NextResponse.json({ ok: true });
          }
        }

        if (!datetimeStr) {
          await notifyOwner(instanceName, ownerPhone, aiResult.reply || 'A che ora vuoi inviarlo? (es. domani alle 15, fra 2 ore)');
          return NextResponse.json({ ok: true });
        }

        // Parse datetime from AI (P4 FIX: handles offset-aware and offset-naive ISO strings)
        let scheduledAt: Date;
        try {
          scheduledAt = parseAIDatetime(datetimeStr);
        } catch {
          const parsed = parseCommand(raw);
          if (!parsed) {
            await notifyOwner(instanceName, ownerPhone, 'Non ho capito la data/ora. Puoi riprovare? Es: "domani alle 15" o "fra 30 minuti"');
            return NextResponse.json({ ok: true });
          }
          scheduledAt = parsed.date;
        }

        // Reject dates in the past (or less than 1 minute from now)
        const minScheduleTime = new Date(Date.now() + 60 * 1000);
        if (scheduledAt < minScheduleTime) {
          await notifyOwner(instanceName, ownerPhone,
            '⚠️ La data/ora indicata è nel passato. Scrivi un orario futuro (es. "fra 10 minuti", "domani alle 15").');
          return NextResponse.json({ ok: true });
        }

        const recNum = contact ? contact.recipient_number : aiResult.recipient_number;
        const recName = contact ? contact.recipient_name : (recipientName || aiResult.recipient_name || 'destinatario');
        const rawMessage = messageText || extractContent(raw, 0, 0);
        await dbLog('BEFORE_REWRITE', { rawMessage, recipientName: recName });
        const finalMessage = await verifyAndFixMessage(rawMessage, recName);
        await dbLog('AFTER_REWRITE', { finalMessage });

        // Auto-save contact when inline phone + name provided (and contact was not already known)
        let autoSaveResult: { saved: boolean; conflict: boolean; conflictNumber?: string } = { saved: false, conflict: false };
        if (!contactWasKnown && aiResult.recipient_number && recName && recName !== 'destinatario') {
          autoSaveResult = await autoSaveContact(
            ownerPhone,
            recName,
            aiResult.recipient_number,
            getEffectivePlan(user.subscription_plan)
          );
        }

        // Clean up any pending partial context
        if (pendingCtx) {
          await supabase.from('scheduled_messages').delete().eq('id', pendingCtx.id);
        }

        // DB-level dedup check before insert
        if (msgId && await isMessageProcessed(msgId)) {
          console.log('WEBHOOK: DUPLICATE (DB) msgId=' + msgId);
          return NextResponse.json({ ok: true, deduplicated: true });
        }

        // Smart-confirm: skip awaiting_confirm for known contacts with explicit, unambiguous time
        const skipConfirm = shouldSkipConfirm(aiResult, contactWasKnown, raw);
        const initialStatus = skipConfirm ? 'pending' : 'awaiting_confirm';

        const { data: insertedMsg, error: insErr } = await supabase.from('scheduled_messages').insert({
          user_instance_id: user.id, instance_phone: ownerPhone,
          recipient_number: recNum, recipient_name: recName,
          caption: raw, parsed_message: finalMessage,
          scheduled_at: scheduledAt.toISOString(), status: initialStatus,
          retry_count: 0, max_retries: 3,
          wa_message_id: msgId || null,
        }).select('id').single();

        if (insErr) {
          if (insErr.message?.includes('wa_message_id')) {
            console.log('WEBHOOK: DUPLICATE (DB constraint) msgId=' + msgId);
            return NextResponse.json({ ok: true, deduplicated: true });
          }
          console.error('WEBHOOK: DB insert error:', insErr.message);
          await notifyOwner(instanceName, ownerPhone, 'Errore salvataggio: ' + insErr.message);
          throw new Error(insErr.message); // -> outer catch releases the dedup claim, then 500
        }

        // INSERT committed: the message is durably scheduled. "Commit" the dedup
        // claim (stop tracking it for release) so a throw in the notify/format code
        // below can't release it and let Evolution's retry RE-INSERT = double
        // schedule (there is no wa_message_id unique constraint to catch it).
        claimedMsgId = null;

        let autoSaveSuffix = '';
        if (autoSaveResult.saved) autoSaveSuffix = '\n(salvato in rubrica)';
        if (autoSaveResult.conflict) autoSaveSuffix = `\n(uso ${recNum} per questa volta — il numero salvato per ${recName} è ${autoSaveResult.conflictNumber})`;

        if (skipConfirm) {
          const when = new Date(scheduledAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
          await notifyOwner(instanceName, ownerPhone,
            `✅ Schedulato per ${recName} (${when}).\nScrivi UNDO entro 60s per annullare.${autoSaveSuffix}`);
          return NextResponse.json({ ok: true, scheduled: scheduledAt.toISOString() });
        }

        await notifyOwner(instanceName, ownerPhone,
          '✅ Invierò a ' + recName + ' il ' + formatRome(scheduledAt) + ':\n' +
          '"' + finalMessage + '"\n\n' +
          'Va bene? Scrivi OK per confermare, ANNULLA per cancellare, o dimmi come modificarlo.' + autoSaveSuffix);
        return NextResponse.json({ ok: true, scheduled: scheduledAt.toISOString() });
      }

      // ── AI: chat (conversational reply) ──
      if (aiResult.reply) {
        await notifyOwner(instanceName, ownerPhone, aiResult.reply);
        return NextResponse.json({ ok: true });
      }

      // Safety net: AI returned something but no handler caught it
      console.log('WEBHOOK: AI returned action=' + aiResult.action + ' but no handler matched. pendingCtx=' + (pendingCtx?.status || 'none'));
    }

    // ── SAFETY NET: if awaiting_confirm exists but AI failed or no handler matched, always respond ──
    if (pendingCtx?.status === 'awaiting_confirm') {
      console.log('WEBHOOK: SAFETY NET — awaiting_confirm active, no AI handler matched. Treating as modify.');
      const schedTime = pendingCtx.scheduled_at ? formatRome(new Date(pendingCtx.scheduled_at)) : '?';
      await notifyOwner(instanceName, ownerPhone,
        '📝 Hai un messaggio in attesa di conferma:\n' +
        'A: ' + (pendingCtx.recipient_name || '?') + '\n' +
        'Testo: "' + (pendingCtx.parsed_message || '?') + '"\n' +
        'Quando: ' + schedTime + '\n\n' +
        'Scrivi OK per confermare, ANNULLA per cancellare, o dimmi come modificarlo.');
      return NextResponse.json({ ok: true });
    }

    // ══════════════════════════════════════════════════
    // FALLBACK: Legacy regex parser (if OpenAI failed or returned null)
    // ══════════════════════════════════════════════════
    console.log('WEBHOOK: Falling back to regex parser');

    // Quick commands first
    if (/^(lista|list|pending|programmati)$/i.test(rawLower)) {
      const { data: pending } = await supabase.from('scheduled_messages').select('id, recipient_name, recipient_number, parsed_message, scheduled_at').eq('user_instance_id', user.id).eq('status', 'pending').order('scheduled_at', { ascending: true }).limit(10);
      if (!pending || pending.length === 0) { await notifyOwner(instanceName, ownerPhone, 'Nessun messaggio in coda.'); return NextResponse.json({ ok: true }); }
      const listText = pending.map((m, i) => { const name = m.recipient_name || m.recipient_number || '?'; const time = formatRome(new Date(m.scheduled_at)); const preview = (m.parsed_message || '').substring(0, 30); return (i+1) + '. ' + name + ' - ' + time + '\n   "' + preview + (preview.length >= 30 ? '...' : '') + '"'; }).join('\n\n');
      await notifyOwner(instanceName, ownerPhone, 'Messaggi programmati (' + pending.length + '):\n\n' + listText + '\n\nScrivi "annulla 1" per cancellare.');
      return NextResponse.json({ ok: true });
    }

    if (/^(annulla|delete|stop|undo)$/i.test(rawLower)) {
      const { data: lastPending } = await supabase.from('scheduled_messages').select('id, recipient_name, recipient_number, scheduled_at').eq('user_instance_id', user.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!lastPending) { await notifyOwner(instanceName, ownerPhone, 'Nessun messaggio da annullare.'); return NextResponse.json({ ok: true }); }
      await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', lastPending.id);
      await notifyOwner(instanceName, ownerPhone, 'Annullato! A: ' + (lastPending.recipient_name || lastPending.recipient_number || '?') + ' Era per: ' + formatRome(new Date(lastPending.scheduled_at)));
      return NextResponse.json({ ok: true });
    }

    if (/^(stato|status)$/i.test(rawLower)) {
      await notifyOwner(instanceName, ownerPhone, '✅ WhatsLater connesso e funzionante!\nScrivi AIUTO per la guida completa.');
      return NextResponse.json({ ok: true });
    }

    if (/^(help|aiuto|comandi|\?)$/i.test(rawLower)) {
      await notifyOwner(instanceName, ownerPhone,
        'Benvenuto su WhatsLater! 🎉\n\n' +
        'Ecco come mandare il tuo primo promemoria in 2 passi:\n\n' +
        '1️⃣ Inviami il contatto di un tuo cliente (premi 📎 → Contatto)\n' +
        '2️⃣ Poi scrivi: "Ricorda a [nome] l\'appuntamento di domani alle 15"\n\n' +
        'Il messaggio partira automaticamente all\'orario che scegli! 📲\n\n' +
        'Hai bisogno di aiuto? Scrivi AIUTO');
      return NextResponse.json({ ok: true });
    }

    // Legacy scheduling
    const parsed = parseCommand(raw);
    if (!parsed) {
      console.log('WEBHOOK: No scheduling command in:', raw);
      return NextResponse.json({ ok:true });
    }

    const scheduledAt = parsed.date;
    let recNum: string, recName: string;

    const inlineName = extractInlineRecipient(raw);
    if (inlineName) {
      const contact = await findContactByName(ownerPhone, inlineName);
      if (contact) {
        recNum = contact.recipient_number;
        recName = contact.recipient_name;
      } else {
        await notifyOwner(instanceName, ownerPhone, `Non trovo "${inlineName}" in rubrica.\nInvia prima il contatto di ${inlineName} (📎 → Contatto), poi ripeti il comando.`);
        return NextResponse.json({ ok: false, error: 'contact_not_found' });
      }
    } else {
      let pc = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data } = await supabase.from('pending_contacts').select('*').eq('owner_phone', ownerPhone).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (data) { pc = data; break; }
        if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
      }
      if (!pc) {
        await notifyOwner(instanceName, ownerPhone, 'Nessun destinatario trovato.\nInvia prima il contatto (📎 → Contatto) oppure scrivi:\n"Invia a [Nome] domani alle 15: testo"');
        return NextResponse.json({ ok: false, error: 'no_recipient' });
      }
      recNum = pc.recipient_number;
      recName = pc.recipient_name;
    }

    const content_text = inlineName
      ? (extractInlineMessage(raw) || extractContent(raw, 0, 0))
      : extractContent(raw, 0, 0);

    // DB-level dedup
    if (msgId && await isMessageProcessed(msgId)) {
      console.log('WEBHOOK: DUPLICATE (DB fallback) msgId=' + msgId);
      return NextResponse.json({ ok: true, deduplicated: true });
    }

    const { error: insErr } = await supabase.from('scheduled_messages').insert({
      user_instance_id: user.id, instance_phone: ownerPhone,
      recipient_number: recNum, recipient_name: recName,
      caption: raw, parsed_message: content_text,
      scheduled_at: scheduledAt.toISOString(), status: 'awaiting_confirm',
      retry_count: 0, max_retries: 3,
      wa_message_id: msgId || null,
    });

    if (insErr) {
      if (insErr.message?.includes('wa_message_id')) {
        console.log('WEBHOOK: DUPLICATE (DB constraint fallback) msgId=' + msgId);
        return NextResponse.json({ ok: true, deduplicated: true });
      }
      console.error('WEBHOOK: DB insert error:', insErr.message);
      await notifyOwner(instanceName, ownerPhone, 'Errore salvataggio: ' + insErr.message);
      throw new Error(insErr.message); // -> outer catch releases the dedup claim, then 500
    }

    // INSERT committed (fallback path): commit the dedup claim so a downstream
    // throw can't release it and cause Evolution's retry to re-insert.
    claimedMsgId = null;

    await notifyOwner(instanceName, ownerPhone,
      '✅ Invierò a ' + recName + ' il ' + formatRome(scheduledAt) + ':\n' +
      '"' + content_text + '"\n\n' +
      'Va bene? Scrivi OK per confermare, ANNULLA per cancellare, o dimmi come modificarlo.');
    return NextResponse.json({ ok:true, scheduled: scheduledAt.toISOString() });

  } catch(e) {
    console.error('WEBHOOK: Unhandled error:', e.message);
    // Release our dedup claim (if any) so Evolution's retry can REPROCESS this
    // message — it was claimed at the top but processing failed/threw. Idempotent,
    // and only on this error path: success/handled returns above keep the claim.
    if (claimedMsgId) await releaseWebhookEvent(supabase, claimedMsgId);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
