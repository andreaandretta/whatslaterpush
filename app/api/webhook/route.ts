// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { extractInlineRecipient, extractInlineMessage, parseAIDatetime, getRomeOffsetMs, nowRome, romeToUtc } from '../../lib/webhook-utils';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── DB Logger (temporary — writes to webhook_logs table for debugging) ──
async function dbLog(tag: string, data: any) {
  try {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    await supabase.from('webhook_logs').insert({ tag, data: text.substring(0, 2000) });
  } catch {}
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

// Escape ILIKE wildcards to prevent pattern injection
function escapeIlike(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
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
  try {
    const r = await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
      method:'POST', headers:{ 'apikey': process.env.EVOLUTION_API_KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({ number: phone, text: msg })
    });
    console.log('notify status:', r.status, 'to:', phone, 'via:', instanceName);
  } catch(e) { console.error('notify err:', e.message); }
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
      .select('id, phone_number, subscription_status, trial_ends_at, instance_name')
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

async function findUserByPhoneOnly(phone: string): Promise<any> {
  const variants = phoneVariants(phone);
  for (const v of variants) {
    const { data } = await supabase
      .from('user_instances')
      .select('id, phone_number, subscription_status, trial_ends_at, instance_name')
      .eq('phone_number', v)
      .maybeSingle();
    if (data) return data;
  }
  return null;
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
  const { data: updated, error } = await supabase
    .from('user_instances')
    .update({ connection_status: connectionStatus, last_connection_update: new Date().toISOString() })
    .eq('instance_name', instanceName)
    .select('id, phone_number');
  if (error) console.error(`WEBHOOK: CONNECTION_UPDATE DB error: ${error.message}`);
  else console.log(`WEBHOOK: CONNECTION_UPDATE saved - instance=${instanceName} status=${connectionStatus} rows=${updated?.length || 0}`);
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

// ── In-memory dedup (covers non-scheduling events within same instance) ──
const processedMsgIds = new Map<string, number>();
const DEDUP_TTL_MS = 120_000;

function isDuplicateInMemory(msgId: string): boolean {
  const now = Date.now();
  for (const [key, ts] of processedMsgIds) {
    if (now - ts > DEDUP_TTL_MS) processedMsgIds.delete(key);
  }
  if (processedMsgIds.has(msgId)) return true;
  processedMsgIds.set(msgId, now);
  return false;
}

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

datetime_iso DEVE essere in ora locale italiana SENZA offset (es: "2026-03-14T15:00:00", MAI "2026-03-14T15:00:00+01:00" o con Z).

JSON: {"action":"schedule|ask_time|ask_recipient|confirm|cancel_confirm|modify|list|cancel|status|help|chat","recipient_name":string|null,"datetime_iso":"ISO locale senza offset"|null,"message_text":"RISCRITTO"|null,"cancel_target":null,"reply":"risposta utente"}`;

  const userContent = userMessage + '\n---\nContatti: ' + (contactList || 'nessuno') + '\nOra: ' + currentDateTime + pendingBlock;

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

  if (all.length === 0) return '';
  return all.map(c => `- ${c.name}: ${c.number}`).join('\n');
}

export async function POST(req) {
  let rawBody = '';
  try {
    // Webhook authentication: validate secret from Evolution API
    // Check multiple header formats — Evolution API v2 may send differently
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (webhookSecret) {
      const secretHeader = req.headers.get('x-webhook-secret');
      const authHeader = req.headers.get('authorization');
      const apiKeyHeader = req.headers.get('apikey');
      const matched =
        secretHeader === webhookSecret ||
        authHeader === webhookSecret ||
        authHeader === 'Bearer ' + webhookSecret ||
        apiKeyHeader === webhookSecret;
      if (!matched) {
        console.log('WEBHOOK: Unauthorized — headers received: x-webhook-secret=' + (secretHeader || 'NONE') + ' authorization=' + (authHeader || 'NONE') + ' apikey=' + (apiKeyHeader || 'NONE'));
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const payload = await req.json();
    rawBody = JSON.stringify(payload).substring(0, 500);
    console.log('WEBHOOK incoming:', rawBody);

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
            .select('phone_number').eq('instance_name', evoInstance).maybeSingle();
          if (inst?.phone_number) {
              await notifyOwner(evoInstance, inst.phone_number,
                'Ciao! 👋 Benvenuto su WhatsLater!\n' +
                'Per programmare un messaggio segui questi 2 step:\n\n' +
                '1️⃣ Allega il contatto del destinatario (premi 📎 → Contatto)\n' +
                '2️⃣ Poi scrivi: "Invia a [Nome] domani alle 15: Testo del messaggio"\n\n' +
                'Esempio: "Invia a Marco domani alle 15: Ricordati la riunione!"\n\n' +
                '📹 Guarda come si fa: https://whatslaterpush.vercel.app/tutorial\n\n' +
                '📊 Vedi i tuoi messaggi programmati:\n' +
                '- Dashboard: https://whatslaterpush.vercel.app/dashboard\n' +
                '- Oppure scrivi LISTA qui in chat'
              );
          }
        } catch(e) { console.error('WEBHOOK: onboarding error:', e.message); }
      }
      return NextResponse.json({ ok: true });
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
    if (msgId && isDuplicateInMemory(msgId)) {
      console.log('WEBHOOK: DUPLICATE (in-memory) msgId=' + msgId);
      return NextResponse.json({ ok: true, deduplicated: true });
    }

    const senderRaw = (msgKey?.remoteJid || '').split('@')[0];
    const isFromMe = msgKey?.fromMe === true;

    if (!isFromMe) {
      console.log('WEBHOOK: Skipped - not fromMe. remoteJid=' + (msgKey?.remoteJid || 'none'));
      return NextResponse.json({ ok:true });
    }
    if (!senderRaw) {
      console.error('WEBHOOK: remoteJid missing');
      return NextResponse.json({ ok:true });
    }

    console.log('WEBHOOK: Processing sender=' + senderRaw + ' evoInstance=' + evoInstance);

    // STRICT IDENTITY RESOLUTION
    let user = await findUserStrict(evoInstance, senderRaw);

    if (!user) {
      const existingUser = await findUserByPhoneOnly(senderRaw);
      if (existingUser) {
        console.log(`WEBHOOK: Phone ${senderRaw} found under instance=${existingUser.instance_name} but webhook from ${evoInstance}`);
        let oldInstanceDead = false;
        try {
          const checkRes = await fetch(
            `${process.env.EVOLUTION_API_URL}/instance/connectionState/${existingUser.instance_name}`,
            { headers: { 'apikey': process.env.EVOLUTION_API_KEY! } }
          );
          if (!checkRes.ok) { oldInstanceDead = true; }
          else {
            const checkData = await checkRes.json();
            const oldState = checkData?.instance?.state || checkData?.state || 'close';
            oldInstanceDead = (oldState !== 'open');
          }
        } catch (e) { oldInstanceDead = true; }

        if (oldInstanceDead) {
          console.log(`WEBHOOK: Old instance ${existingUser.instance_name} dead. Reassigning to ${evoInstance}`);
          await supabase.from('user_instances')
            .update({ instance_name: evoInstance, connection_status: 'open', last_connection_update: new Date().toISOString() })
            .eq('id', existingUser.id);
          existingUser.instance_name = evoInstance;
          user = existingUser;
        } else {
          console.error(`WEBHOOK: CONFLICT - phone ${senderRaw} has LIVE instance ${existingUser.instance_name} but msg from ${evoInstance}. REJECTING.`);
          return NextResponse.json({ error: 'Instance conflict' }, { status: 409 });
        }
      } else {
        console.error(`WEBHOOK: REJECTED - phone ${senderRaw} instance ${evoInstance} not in DB.`);
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
    }

    if (user.instance_name !== evoInstance) {
      console.error(`WEBHOOK: FATAL MISMATCH - user.instance=${user.instance_name} !== evo=${evoInstance}`);
      return NextResponse.json({ error: 'Instance mismatch' }, { status: 409 });
    }

    const ownerPhone = user.phone_number;
    const instanceName = user.instance_name;
    console.log(`WEBHOOK: IDENTITY CONFIRMED - owner=${ownerPhone} instance=${instanceName} user_id=${user.id}`);

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
        const { error: upsertErr } = await supabase.from('pending_contacts').upsert(
          { owner_phone: ownerPhone, recipient_number: num, recipient_name: name, created_at: new Date().toISOString() },
          { onConflict: 'owner_phone,recipient_number' }
        );
        if (upsertErr) {
          await supabase.from('pending_contacts').delete().eq('owner_phone', ownerPhone).eq('recipient_number', num);
          await supabase.from('pending_contacts').insert({ owner_phone: ownerPhone, recipient_number: num, recipient_name: name });
        } else {
          console.log('WEBHOOK: vCard saved for', ownerPhone, '-> recipient:', name, num);
        }
        await notifyOwner(instanceName, ownerPhone, '✅ Contatto "' + name + '" salvato!\nOra puoi scrivere, ad esempio:\n"Invia a ' + name + ' domani alle 15: il tuo messaggio"');
      }
      return NextResponse.json({ ok:true });
    }

    // ── Text message parsing ──
    const raw = msgContent?.conversation || msgContent?.extendedTextMessage?.text || msgContent?.imageMessage?.caption || '';
    if (!raw) { console.log('WEBHOOK: Empty text, skipping'); return NextResponse.json({ ok:true }); }
    console.log('WEBHOOK: Text received:', raw);
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
          return NextResponse.json({ error: updErr.message }, { status: 500 });
        }
        await notifyOwner(instanceName, ownerPhone,
          '✅ Confermato! Messaggio a ' + (awaiting.recipient_name || awaiting.recipient_number) +
          ' programmato per ' + formatRome(new Date(awaiting.scheduled_at)) + '.\n' +
          'Scrivi "lista" per vedere i messaggi in coda.');
        return NextResponse.json({ ok: true });
      }
      // No awaiting_confirm — fall through to AI
    }

    // ── FAST-PATH: ANNULLA cancels pending message ──
    if (/^(no|annulla|cancella)$/i.test(rawLower)) {
      const { data: awaiting } = await supabase.from('scheduled_messages')
        .select('id, recipient_name')
        .eq('instance_phone', ownerPhone).eq('status', 'awaiting_confirm')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (awaiting) {
        await supabase.from('scheduled_messages').delete().eq('id', awaiting.id);
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
          '📹 Guarda come si fa: https://whatslaterpush.vercel.app/tutorial\n\n' +
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
          return NextResponse.json({ error: updErr.message }, { status: 500 });
        }
        await notifyOwner(instanceName, ownerPhone,
          '✅ Confermato! Messaggio a ' + (pendingCtx.recipient_name || pendingCtx.recipient_number) +
          ' programmato per ' + formatRome(new Date(pendingCtx.scheduled_at)) + '.\n' +
          'Scrivi "lista" per vedere i messaggi in coda.');
        return NextResponse.json({ ok: true });
      }

      // ── AI: cancel_confirm (user cancelled via AI) ──
      if (aiResult.action === 'cancel_confirm' && pendingCtx?.status === 'awaiting_confirm') {
        await supabase.from('scheduled_messages').delete().eq('id', pendingCtx.id);
        await notifyOwner(instanceName, ownerPhone, '❌ Messaggio annullato.');
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
        if (aiResult.recipient_name) {
          const newContact = await findContactByName(ownerPhone, aiResult.recipient_name);
          if (newContact) {
            updates.recipient_name = newContact.recipient_name;
            updates.recipient_number = newContact.recipient_number;
          }
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
        if (!contact) {
          await notifyOwner(instanceName, ownerPhone,
            aiResult.reply || `Non trovo "${recipientName}" in rubrica.\nInvia prima il contatto (📎 → Contatto), poi ripeti il comando.`);
          return NextResponse.json({ ok: true });
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

        const rawMessage = messageText || extractContent(raw, 0, 0);
        await dbLog('BEFORE_REWRITE', { rawMessage, recipientName: contact.recipient_name });
        const finalMessage = await verifyAndFixMessage(rawMessage, contact.recipient_name);
        await dbLog('AFTER_REWRITE', { finalMessage });
        const recNum = contact.recipient_number;
        const recName = contact.recipient_name;

        // Clean up any pending partial context
        if (pendingCtx) {
          await supabase.from('scheduled_messages').delete().eq('id', pendingCtx.id);
        }

        // DB-level dedup check before insert
        if (msgId && await isMessageProcessed(msgId)) {
          console.log('WEBHOOK: DUPLICATE (DB) msgId=' + msgId);
          return NextResponse.json({ ok: true, deduplicated: true });
        }

        const { error: insErr } = await supabase.from('scheduled_messages').insert({
          user_instance_id: user.id, instance_phone: ownerPhone,
          recipient_number: recNum, recipient_name: recName,
          caption: raw, parsed_message: finalMessage,
          scheduled_at: scheduledAt.toISOString(), status: 'awaiting_confirm',
          retry_count: 0, max_retries: 3,
          wa_message_id: msgId || null,
        });

        if (insErr) {
          if (insErr.message?.includes('wa_message_id')) {
            console.log('WEBHOOK: DUPLICATE (DB constraint) msgId=' + msgId);
            return NextResponse.json({ ok: true, deduplicated: true });
          }
          console.error('WEBHOOK: DB insert error:', insErr.message);
          await notifyOwner(instanceName, ownerPhone, 'Errore salvataggio: ' + insErr.message);
          return NextResponse.json({ error: insErr.message }, { status: 500 });
        }

        await notifyOwner(instanceName, ownerPhone,
          '✅ Invierò a ' + recName + ' il ' + formatRome(scheduledAt) + ':\n' +
          '"' + finalMessage + '"\n\n' +
          'Va bene? Scrivi OK per confermare, ANNULLA per cancellare, o dimmi come modificarlo.');
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
        '📖 Come usare WhatsLater:\n\n' +
        '1️⃣ Allega il contatto del destinatario (premi 📎 → Contatto) — solo la prima volta\n' +
        '2️⃣ Scrivi il messaggio, esempio:\n' +
        '   "Invia a Marco domani alle 15: Ricordati la riunione!"\n\n' +
        '📹 Guarda come si fa: https://whatslaterpush.vercel.app/tutorial\n\n' +
        '💬 Altri comandi:\n' +
        '- LISTA — vedi messaggi programmati\n' +
        '- ANNULLA [numero] — cancella un messaggio\n' +
        '- STATO — controlla connessione');
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
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    await notifyOwner(instanceName, ownerPhone,
      '✅ Invierò a ' + recName + ' il ' + formatRome(scheduledAt) + ':\n' +
      '"' + content_text + '"\n\n' +
      'Va bene? Scrivi OK per confermare, ANNULLA per cancellare, o dimmi come modificarlo.');
    return NextResponse.json({ ok:true, scheduled: scheduledAt.toISOString() });

  } catch(e) {
    console.error('WEBHOOK: Unhandled error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
