// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic'; 

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ââ Rome timezone helpers ââ
function getRomeOffsetMs() {
  const now = new Date();
  const utcStr = now.toLocaleString('en-CA', { timeZone: 'UTC', hour12: false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const romeStr = now.toLocaleString('en-CA', { timeZone: 'Europe/Rome', hour12: false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
  return new Date(romeStr.replace(', ','T')).getTime() - new Date(utcStr.replace(', ','T')).getTime();
}
function nowRome() { return new Date(new Date().getTime() + getRomeOffsetMs()); }
function romeToUtc(d) { return new Date(d.getTime() - getRomeOffsetMs()); }

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
    return { date: romeToUtc(d), cmdStart: dateM.index, cmdEnd: dateM.index + dateM[0].length };
  }
  const fraM = /(?:fra|tra)\s+(\d+)\s*(minuto|minuti|ora|ore|giorno|giorni)/.exec(norm);
  if (fraM) {
    const n=parseInt(fraM[1]), u=fraM[2], d=new Date(nowR);
    if (u.startsWith('minut')) d.setMinutes(d.getMinutes()+n);
    else if (u.startsWith('or')) d.setHours(d.getHours()+n);
    else d.setDate(d.getDate()+n);
    return { date: romeToUtc(d), cmdStart: fraM.index, cmdEnd: fraM.index+fraM[0].length };
  }
  const domM = /domani(?:\s+(?:mattina|pomeriggio|sera))?(?:\s+alle?\s+(\d{1,2})(?::(\d{2}))?)?/.exec(norm);
  if (domM) {
    const d=new Date(nowR); d.setDate(d.getDate()+1);
    if (domM[1]) { d.setHours(parseInt(domM[1]), domM[2]?parseInt(domM[2]):0, 0, 0); }
    else if (/pomeriggio/.test(domM[0])) { d.setHours(14, 0, 0, 0); }
    else if (/sera/.test(domM[0])) { d.setHours(20, 0, 0, 0); }
    else { d.setHours(9, 0, 0, 0); }
    return { date: romeToUtc(d), cmdStart: domM.index, cmdEnd: domM.index+domM[0].length };
  }
  const staM = /(?:stasera|stamattina|stanotte)(?:\s+alle?\s+(\d{1,2})(?::(\d{2}))?)?/.exec(norm);
  if (staM) {
    const d=new Date(nowR); const kw=staM[0].split(/\s/)[0];
    if (staM[1]) { d.setHours(parseInt(staM[1]), staM[2]?parseInt(staM[2]):0, 0, 0); }
    else if (kw==='stamattina') d.setHours(8,0,0,0);
    else if (kw==='stasera') d.setHours(20,0,0,0);
    else d.setHours(23,0,0,0);
    if (d<=nowR) d.setDate(d.getDate()+1);
    return { date: romeToUtc(d), cmdStart: staM.index, cmdEnd: staM.index+staM[0].length };
  }
  const alleM = /alle?\s+(\d{1,2})(?::(\d{2}))?/.exec(norm);
  if (alleM) {
    const d=new Date(nowR); d.setHours(parseInt(alleM[1]), alleM[2]?parseInt(alleM[2]):0, 0, 0);
    if (d<=nowR) d.setDate(d.getDate()+1);
    return { date: romeToUtc(d), cmdStart: alleM.index, cmdEnd: alleM.index+alleM[0].length };
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

function extractInlineRecipient(text) {
  const m = /\b(?:manda|mandami|mandagli|mandale|scrivi|scrivimi|scrivigli|scrivile|invia|inviami|avvisa|avvisami|dici|digli|dille|ricordami|promemoria|reminder|comunica)\s+a\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{0,25}?)(?=\s+(?:domani|fra|tra|stasera|stamattina|stanotte|all[ae]?\s+\d|il\s+\d|\d{1,2}[\/\-]\d))/i.exec(text);
  return m ? m[1].trim() : null;
}

function extractInlineMessage(text) {
  const idx = text.indexOf(': ');
  if (idx > -1 && idx < text.length - 2) return text.substring(idx + 2).trim();
  return null;
}

async function findContactByName(ownerPhone, name) {
  // 1. Search in pending_contacts first
  const { data: pending } = await supabase
    .from('pending_contacts')
    .select('recipient_number, recipient_name, id')
    .eq('owner_phone', ownerPhone)
    .ilike('recipient_name', `%${name}%`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pending) return pending;

  // 2. Fallback: search in scheduled_messages history
  const { data: historical } = await supabase
    .from('scheduled_messages')
    .select('recipient_number, recipient_name')
    .eq('instance_phone', ownerPhone)
    .ilike('recipient_name', `%${name}%`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return historical || null;
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
// createUser REMOVED: Users created via /api/connect only


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

export async function POST(req) {
  let rawBody = '';
  try {
    const payload = await req.json();
    rawBody = JSON.stringify(payload).substring(0, 500);
    console.log('WEBHOOK incoming:', rawBody);

    const eventType = payload?.event || payload?.type || 'unknown';
    const evoInstance = payload?.instance || '';
    console.log('WEBHOOK event=' + eventType + ' instance=' + evoInstance);

    // Handle CONNECTION_UPDATE - update DB status via handleConnectionUpdate
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
                '1️⃣ Inviami il contatto del destinatario (premi 📎 → Contatto)\n' +
                '2️⃣ Poi scrivi: "Invia a [Nome] domani alle 15: Testo del messaggio"\n\n' +
                'Esempio: "Invia a Marco domani alle 15: Ricordati la riunione!"\n\n' +
                'Hai bisogno di aiuto? Scrivi AIUTO e ti spiego tutto 🙂'
              );
          }
        } catch(e) { console.error('WEBHOOK: onboarding error:', e.message); }
      }
      return NextResponse.json({ ok: true });
    }

    // ââ Extract message ââ
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

    // ââ vCard handling ââ
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
      }
      return NextResponse.json({ ok:true });
    }

    // ââ Text message parsing ââ
    const raw = msgContent?.conversation || msgContent?.extendedTextMessage?.text || msgContent?.imageMessage?.caption || '';
    if (!raw) { console.log('WEBHOOK: Empty text, skipping'); return NextResponse.json({ ok:true }); }
    console.log('WEBHOOK: Text received:', raw);
    const rawLower = raw.trim().toLowerCase();

    // ── COMMAND: OK (confirm pending message) ──
    if (/^(ok|sì|si|conferma|confermo|yes)$/i.test(rawLower)) {
      const { data: awaiting } = await supabase.from('scheduled_messages')
        .select('id, recipient_name, recipient_number, parsed_message, scheduled_at')
        .eq('instance_phone', ownerPhone).eq('status', 'awaiting_confirm')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!awaiting) {
        console.log('WEBHOOK: OK received but no awaiting_confirm message');
        return NextResponse.json({ ok: true });
      }
      await supabase.from('scheduled_messages').update({ status: 'pending' }).eq('id', awaiting.id);
      await notifyOwner(instanceName, ownerPhone,
        '✅ Confermato! Messaggio a ' + (awaiting.recipient_name || awaiting.recipient_number) +
        ' programmato per ' + formatRome(new Date(awaiting.scheduled_at)) + '.\n' +
        'Scrivi "lista" per vedere i messaggi in coda.');
      return NextResponse.json({ ok: true });
    }

    // ── COMMAND: ANNULLA confirmation ──
    if (/^(no|annulla)$/i.test(rawLower)) {
      const { data: awaiting } = await supabase.from('scheduled_messages')
        .select('id, recipient_name')
        .eq('instance_phone', ownerPhone).eq('status', 'awaiting_confirm')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (awaiting) {
        await supabase.from('scheduled_messages').delete().eq('id', awaiting.id);
        await notifyOwner(instanceName, ownerPhone, '❌ Messaggio annullato. Nessun messaggio verrà inviato.');
        return NextResponse.json({ ok: true });
      }
      // If no awaiting_confirm, fall through to existing cancel logic below
    }

    // ââ COMMAND: lista ââ
    if (/^(lista|list|pending|programmati)$/i.test(rawLower)) {
      const { data: pending } = await supabase.from('scheduled_messages').select('id, recipient_name, recipient_number, parsed_message, scheduled_at').eq('user_instance_id', user.id).eq('status', 'pending').order('scheduled_at', { ascending: true }).limit(10);
      if (!pending || pending.length === 0) { await notifyOwner(instanceName, ownerPhone, 'Nessun messaggio in coda.'); return NextResponse.json({ ok: true }); }
      const listText = pending.map((m, i) => { const name = m.recipient_name || m.recipient_number || '?'; const time = formatRome(new Date(m.scheduled_at)); const preview = (m.parsed_message || '').substring(0, 30); return (i+1) + '. ' + name + ' - ' + time + '\n   "' + preview + (preview.length >= 30 ? '...' : '') + '"'; }).join('\n\n');
      await notifyOwner(instanceName, ownerPhone, 'Messaggi programmati (' + pending.length + '):\n\n' + listText + '\n\nScrivi "cancella 1" per annullare.');
      return NextResponse.json({ ok: true });
    }

    // ââ COMMAND: annulla / cancella (LIFO) ââ
    if (/^(annulla|cancella|delete|stop|undo)$/i.test(rawLower)) {
      const { data: lastPending } = await supabase.from('scheduled_messages').select('id, recipient_name, recipient_number, parsed_message, scheduled_at').eq('user_instance_id', user.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!lastPending) { await notifyOwner(instanceName, ownerPhone, 'Nessun messaggio da annullare.'); return NextResponse.json({ ok: true }); }
      await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', lastPending.id);
      await notifyOwner(instanceName, ownerPhone, 'Annullato! A: ' + (lastPending.recipient_name || lastPending.recipient_number || '?') + ' Era per: ' + formatRome(new Date(lastPending.scheduled_at)));
      return NextResponse.json({ ok: true });
    }

    // ââ COMMAND: cancella N ââ
    const cancelNumMatch = /^(annulla|cancella|delete|cancel|stop)\s+(\d+)$/i.exec(rawLower);
    if (cancelNumMatch) {
      const idx = parseInt(cancelNumMatch[2]) - 1;
      const { data: pending } = await supabase.from('scheduled_messages').select('id, recipient_name, recipient_number, parsed_message, scheduled_at').eq('user_instance_id', user.id).eq('status', 'pending').order('scheduled_at', { ascending: true }).limit(10);
      if (!pending || pending.length === 0) { await notifyOwner(instanceName, ownerPhone, 'Nessun messaggio da annullare.'); return NextResponse.json({ ok: true }); }
      if (idx < 0 || idx >= pending.length) { await notifyOwner(instanceName, ownerPhone, 'Numero non valido. Hai ' + pending.length + ' messaggi. Scrivi "lista" per vederli.'); return NextResponse.json({ ok: true }); }
      const target = pending[idx];
      await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', target.id);
      await notifyOwner(instanceName, ownerPhone, 'Messaggio #' + (idx+1) + ' annullato! A: ' + (target.recipient_name || target.recipient_number || '?') + ' Era per: ' + formatRome(new Date(target.scheduled_at)));
      return NextResponse.json({ ok: true });
    }

    // ââ COMMAND: cancella [nome] ââ
    const cancelNameMatch = /^(annulla|cancella|delete|cancel)\s+([a-z\u00e0\u00e8\u00e9\u00ec\u00f2\u00f9A-Z\u00c0\u00c8\u00c9\u00cc\u00d2\u00d9\s]{2,})$/i.exec(rawLower);
    if (cancelNameMatch && !/\d/.test(cancelNameMatch[2])) {
      const searchName = cancelNameMatch[2].trim();
      if (!/\b(fra|domani|alle|il|minuti|ore|giorni)\b/i.test(searchName)) {
        const { data: matching } = await supabase.from('scheduled_messages').select('id, recipient_name, recipient_number, parsed_message, scheduled_at').eq('user_instance_id', user.id).eq('status', 'pending').ilike('recipient_name', '%' + searchName + '%').order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (matching) {
          await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', matching.id);
          await notifyOwner(instanceName, ownerPhone, 'Annullato messaggio a ' + (matching.recipient_name || '?') + '! Era per: ' + formatRome(new Date(matching.scheduled_at)));
          return NextResponse.json({ ok: true });
        }
      }
    }

    // ââ COMMAND: help ââ
    if (/^(help|aiuto|comandi|\?)$/i.test(rawLower)) {
      await notifyOwner(instanceName, ownerPhone,
        'Comandi WhatsLater:\n\n' +
        '📎 Invia vCard + testo con data/ora \u2192 Programma messaggio\n' +
        '✍️ "Invia a Marco domani alle 9: Ciao" \u2192 Programma inline\n' +
        '📋 "lista" \u2192 Messaggi in coda\n' +
        '❌ "annulla" \u2192 Cancella l\'ultimo\n' +
        '❌ "cancella 2" \u2192 Cancella il #2\n' +
        '❌ "cancella Marco" \u2192 Cancella per nome\n' +
        '❓ "aiuto" \u2192 Questo messaggio');
      return NextResponse.json({ ok: true });
    }

    // ââ Scheduling logic ââ
    const parsed = parseCommand(raw);
    if (!parsed) { console.log('WEBHOOK: No scheduling command in:', raw); return NextResponse.json({ ok:true }); }

    const scheduledAt = parsed.date;

    // Recipient resolution: inline text ("Invia a Marco...") first, then pending vCard
    let recNum: string, recName: string, usedPcId: string | null = null;

    const inlineName = extractInlineRecipient(raw);
    if (inlineName) {
      console.log('WEBHOOK: Inline recipient detected:', inlineName);
      const contact = await findContactByName(ownerPhone, inlineName);
      if (contact) {
        recNum = contact.recipient_number;
        recName = contact.recipient_name;
        console.log('WEBHOOK: Inline recipient resolved:', recName, recNum);
      } else {
        console.log('WEBHOOK: Inline recipient not found in contacts:', inlineName);
        await notifyOwner(instanceName, ownerPhone, `Non trovo "${inlineName}" in rubrica.\nInvia prima la vCard di ${inlineName}, poi ripeti il comando.`);
        return NextResponse.json({ ok: false, error: 'contact_not_found' });
      }
    } else {
      // Retry logic: vCard webhook may still be processing (race condition)
      let pc = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data } = await supabase.from('pending_contacts').select('*').eq('owner_phone', ownerPhone).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (data) { pc = data; break; }
        if (attempt < 2) {
          console.log('WEBHOOK: pending_contact not found, retry ' + (attempt + 1) + '/3 in 1.5s...');
          await new Promise(r => setTimeout(r, 1500));
        }
      }
      console.log('WEBHOOK: pending_contact:', pc ? pc.recipient_name + ' ' + pc.recipient_number : 'none');
      if (!pc) {
        console.error('WEBHOOK: No pending_contact found after 3 retries');
        await notifyOwner(instanceName, ownerPhone, 'Nessun destinatario trovato.\nInvia prima una vCard oppure scrivi:\n"Invia a [Nome] domani alle 15: testo"');
        return NextResponse.json({ ok: false, error: 'no_recipient' });
      }
      recNum = pc.recipient_number;
      recName = pc.recipient_name;
      usedPcId = pc.id;
    }

    const content_text = inlineName
      ? (extractInlineMessage(raw) || extractContent(raw, parsed.cmdStart, parsed.cmdEnd))
      : extractContent(raw, parsed.cmdStart, parsed.cmdEnd);
    console.log('WEBHOOK: Scheduling at:', scheduledAt.toISOString(), 'content:', content_text, 'to:', recName, recNum);

    const trialEnd = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
    const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86400000)) : 0;

    const { error: insErr } = await supabase.from('scheduled_messages').insert({
      user_instance_id: user.id, instance_phone: ownerPhone,
      recipient_number: recNum, recipient_name: recName,
      caption: raw, parsed_message: content_text,
      scheduled_at: scheduledAt.toISOString(), status: 'awaiting_confirm', retry_count: 0, max_retries: 3
    });

    if (insErr) {
      console.error('WEBHOOK: DB insert error:', insErr.message);
      await notifyOwner(instanceName, ownerPhone, 'Errore salvataggio: ' + insErr.message);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    // Contacts are now permanent — no longer deleted after use


    await notifyOwner(instanceName, ownerPhone,
      '✅ Invierò a ' + recName + ' (' + recNum + ') il ' + formatRome(scheduledAt) + ':\n' +
      '"' + content_text + '"\n\n' +
      'Digita OK per confermare o ANNULLA per cancellare.');
    return NextResponse.json({ ok:true, scheduled: scheduledAt.toISOString() });

  } catch(e) {
    console.error('WEBHOOK: Unhandled error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
