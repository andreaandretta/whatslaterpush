// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Rome timezone helpers
function getRomeOffsetMs(): number {
  const now = new Date();
  const utcStr = now.toLocaleString('en-CA', { timeZone: 'UTC', hour12: false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const romeStr = now.toLocaleString('en-CA', { timeZone: 'Europe/Rome', hour12: false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
  return new Date(romeStr.replace(', ','T')).getTime() - new Date(utcStr.replace(', ','T')).getTime();
}
function nowRome(): Date { return new Date(new Date().getTime() + getRomeOffsetMs()); }
function romeToUtc(d: Date): Date { return new Date(d.getTime() - getRomeOffsetMs()); }

const NUMERI_IT: Record<string,number> = {
  'un':1,'uno':1,'una':1,'due':2,'tre':3,'quattro':4,'cinque':5,
  'sei':6,'sette':7,'otto':8,'nove':9,'dieci':10,'undici':11,
  'dodici':12,'quindici':15,'venti':20,'trenta':30,'quaranta':40,'cinquanta':50,'sessanta':60,
};
function normalizeNumbers(s: string): string {
  for (const [w,n] of Object.entries(NUMERI_IT)) s = s.replace(new RegExp('\\b'+w+'\\b','gi'),String(n));
  return s;
}

// P3: Parsing data robusto con date esplicite
function parseCommand(text: string): { date: Date; cmdStart: number; cmdEnd: number }|null {
  const norm = normalizeNumbers(text.toLowerCase());
  const nowR = nowRome();

  // "il GG/MM/YYYY alle HH:MM" o "il GG/MM alle HH"
  const dateM = /il\s+(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\s*(?:alle?\s+(\d{1,2})(?::(\d{2}))?)?/.exec(norm);
  if (dateM) {
    const d = new Date(nowR);
    d.setDate(parseInt(dateM[1]));
    d.setMonth(parseInt(dateM[2]) - 1);
    if (dateM[3]) {
      const yr = dateM[3].length === 2 ? '20' + dateM[3] : dateM[3];
      d.setFullYear(parseInt(yr));
    }
    d.setHours(dateM[4] ? parseInt(dateM[4]) : 9, dateM[5] ? parseInt(dateM[5]) : 0, 0, 0);
    return { date: romeToUtc(d), cmdStart: dateM.index, cmdEnd: dateM.index + dateM[0].length };
  }

  // "fra X minuti/ore/giorni"
  const fraM = /fra\s+(\d+)\s*(minuto|minuti|ora|ore|giorno|giorni)/.exec(norm);
  if (fraM) {
    const n=parseInt(fraM[1]), u=fraM[2], d=new Date(nowR);
    if (u.startsWith('minut')) d.setMinutes(d.getMinutes()+n);
    else if (u.startsWith('or')) d.setHours(d.getHours()+n);
    else d.setDate(d.getDate()+n);
    return { date: romeToUtc(d), cmdStart: fraM.index, cmdEnd: fraM.index+fraM[0].length };
  }

  // "domani alle HH:MM"
  const domM = /domani(?:\s+alle?\s+(\d{1,2})(?::(\d{2}))?)?/.exec(norm);
  if (domM) {
    const d=new Date(nowR);
    d.setDate(d.getDate()+1);
    d.setHours(domM[1]?parseInt(domM[1]):9, domM[2]?parseInt(domM[2]):0, 0, 0);
    return { date: romeToUtc(d), cmdStart: domM.index, cmdEnd: domM.index+domM[0].length };
  }

  // "alle HH:MM"
  const alleM = /alle?\s+(\d{1,2})(?::(\d{2}))?/.exec(norm);
  if (alleM) {
    const d=new Date(nowR);
    d.setHours(parseInt(alleM[1]), alleM[2]?parseInt(alleM[2]):0, 0, 0);
    if (d<=nowR) d.setDate(d.getDate()+1);
    return { date: romeToUtc(d), cmdStart: alleM.index, cmdEnd: alleM.index+alleM[0].length };
  }

  return null;
}

const SCHED_KW = /\b(manda|mandami|scrivi|scrivimi|dici|avvisa|avvisami|invia|inviami|ricordami|promemoria|reminder)\b/gi;

function extractContent(raw: string, cmdStart: number, cmdEnd: number): string {
  let t = raw.replace(SCHED_KW, '');
  const norm = normalizeNumbers(t.toLowerCase());
  const dateM = /il\s+\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\s*(?:alle?\s+\d{1,2}(?::\d{2})?)?/i.exec(norm);
  if (dateM) {
    t = t.slice(0, dateM.index) + t.slice(dateM.index + dateM[0].length);
  } else {
    const fraM = /fra\s+\d+\s*(minuto|minuti|ora|ore|giorno|giorni)/i.exec(norm);
    if (fraM) {
      t = t.slice(0, fraM.index) + t.slice(fraM.index + fraM[0].length);
    } else {
      const domM = /domani(?:\s+alle?\s+\d{1,2}(?::\d{2})?)?/i.exec(norm);
      if (domM) {
        t = t.slice(0, domM.index) + t.slice(domM.index + domM[0].length);
      } else {
        const alleM = /alle?\s+\d{1,2}(?::\d{2})?/i.exec(norm);
        if (alleM) {
          t = t.slice(0, alleM.index) + t.slice(alleM.index + alleM[0].length);
        }
      }
    }
  }
  return t.replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g,'').replace(/\s{2,}/g,' ').trim() || raw;
}

function formatRome(d: Date): string {
  return d.toLocaleString('it-IT',{ day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', timeZone:'Europe/Rome' });
}

// P1: Notifica al numero owner corretto usando la sua istanza
async function notifyOwner(instanceName: string, phone: string, msg: string) {
  if (!phone || !instanceName) return;
  try {
    const r = await fetch(`${process.env.EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
      method:'POST',
      headers:{ 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type':'application/json' },
      body: JSON.stringify({ number: phone, text: msg })
    });
    console.log('notify', instanceName, phone, r.status);
  } catch(e: any) { console.error('notify err:', e.message); }
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const data = payload?.data;

    if (!data?.message || !data?.key) return NextResponse.json({ ok:true });
    if (!data.key?.fromMe) return NextResponse.json({ ok:true });

    // P1: Estrai il numero del MITTENTE REALE dal remoteJid
    // Formato: 393509898408@s.whatsapp.net
    const senderRaw = (data.key?.remoteJid || '').split('@')[0];
    if (!senderRaw) {
      console.error('WEBHOOK: remoteJid mancante');
      return NextResponse.json({ ok:true });
    }

    // Normalizza numero per ricerca flessibile
    const senderWith39 = senderRaw.startsWith('39') ? senderRaw : '39' + senderRaw;
    const senderWithout39 = senderRaw.startsWith('39') ? senderRaw.substring(2) : senderRaw;

    console.log('WEBHOOK: Sender raw:', senderRaw, '-> variants:', senderWith39, senderWithout39);

    // P1: CERCA UTENTE per phone_number (identificazione per numero, non per istanza)
    let user: any = null;

    // Prima cerca per numero esatto
    const { data: u1 } = await supabase
      .from('user_instances')
      .select('id, phone_number, subscription_status, trial_ends_at, instance_name')
      .eq('phone_number', senderRaw)
      .maybeSingle();
    if (u1) user = u1;

    // Poi prova con prefisso 39
    if (!user) {
      const { data: u2 } = await supabase
        .from('user_instances')
        .select('id, phone_number, subscription_status, trial_ends_at, instance_name')
        .eq('phone_number', senderWith39)
        .maybeSingle();
      if (u2) user = u2;
    }

    // Poi prova senza prefisso 39
    if (!user) {
      const { data: u3 } = await supabase
        .from('user_instances')
        .select('id, phone_number, subscription_status, trial_ends_at, instance_name')
        .eq('phone_number', senderWithout39)
        .maybeSingle();
      if (u3) user = u3;
    }

    // Fallback retrocompatibile: cerca per instance_name dal payload
    if (!user) {
      const instanceFromPayload = payload.instance || 'SchedWhats-Primary';
      console.log('WEBHOOK: Fallback instance_name:', instanceFromPayload);
      const { data: u4 } = await supabase
        .from('user_instances')
        .select('id, phone_number, subscription_status, trial_ends_at, instance_name')
        .eq('instance_name', instanceFromPayload)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (u4) user = u4;
    }

    // P1: Se ancora non trovato, CREA UTENTE AL VOLO
    if (!user) {
      console.log('WEBHOOK: Nuovo utente, creazione automatica per:', senderWith39);
      const newInstanceName = 'SchedWhats-' + senderWith39;
      const { data: newUser, error: createErr } = await supabase
        .from('user_instances')
        .insert({
          phone_number: senderWith39,
          instance_name: newInstanceName,
          subscription_status: 'trial',
          trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        })
        .select()
        .single();
      if (createErr) {
        console.error('WEBHOOK: Errore creazione utente:', createErr.message);
        return NextResponse.json({ ok:true });
      }
      user = newUser;
    }

    const ownerPhone = user.phone_number;
    // P1: Usa istanza dinamica per notifiche
    const instanceName = user.instance_name || ('SchedWhats-' + ownerPhone);

    console.log('WEBHOOK: Owner confermato:', ownerPhone, '| Instance:', instanceName);

    // Gestione vCard
    if (data.message?.contactMessage) {
      const c = data.message.contactMessage;
      const vcard = c.vcard || '';
      const name = c.displayName || 'Contatto';
      const waid = vcard.match(/waid=(\d+)/i)?.[1];
      let num = waid || null;
      if (!num) {
        const tel = (vcard.match(/TEL[^:]*:([+\d\s()-]+)/i) || vcard.match(/TEL[:;]+([+\d\s()-]+)/i))?.[1];
        if (tel) {
          num = tel.replace(/[\s()\-+]/g,'');
          if (num.startsWith('0')) num = '39' + num;
        }
      }
      console.log('vCard:', name, num, 'per owner:', ownerPhone);
      if (num) {
        const { error: upsertErr } = await supabase.from('pending_contacts').upsert(
          { owner_phone: ownerPhone, recipient_number: num, recipient_name: name, created_at: new Date().toISOString() },
          { onConflict: 'owner_phone,recipient_number' }
        );
        if (upsertErr) {
          console.error('Errore upsert vCard:', upsertErr.message);
          await supabase.from('pending_contacts').delete().eq('owner_phone', ownerPhone).eq('recipient_number', num);
          await supabase.from('pending_contacts').insert({ owner_phone: ownerPhone, recipient_number: num, recipient_name: name });
        }
      }
      return NextResponse.json({ ok:true });
    }

    // Parsing messaggio testo
    const raw = data.message?.conversation ||
                data.message?.extendedTextMessage?.text ||
                data.message?.imageMessage?.caption || '';
    if (!raw) return NextResponse.json({ ok:true });
    console.log('raw:', raw);

    const parsed = parseCommand(raw);
    if (!parsed) { console.log('no cmd:', raw); return NextResponse.json({ ok:true }); }

    const scheduledAt = parsed.date;
    const content = extractContent(raw, parsed.cmdStart, parsed.cmdEnd);
    console.log('scheduled_at:', scheduledAt.toISOString(), 'content:', content);

    // Recupera ultimo contatto pending (LIFO, TTL 30 min)
    const { data: pc } = await supabase
      .from('pending_contacts')
      .select('*')
      .eq('owner_phone', ownerPhone)
      .gte('created_at', new Date(Date.now() - 1800000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let recNum: string, recName: string;
    if (pc) {
      recNum = pc.recipient_number;
      recName = pc.recipient_name;
    } else {
      // Fallback: manda a se stesso
      recNum = ownerPhone;
      recName = 'Me Stesso';
    }
    console.log('recipient:', recName, recNum);

    // Check subscription
    const trialEnd = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
    if (user.subscription_status !== 'active' && !(trialEnd && trialEnd > new Date())) {
      await notifyOwner(instanceName, ownerPhone, '\u274c Trial scaduto. Abbonati su ' + process.env.NEXT_PUBLIC_APP_URL);
      return NextResponse.json({ ok:true });
    }
    const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86400000)) : 0;

    // Salva messaggio nel DB
    const { error: insErr } = await supabase.from('scheduled_messages').insert({
      user_instance_id: user.id,
      instance_phone: ownerPhone,  // P1: CRITICO - numero del mittente reale
      recipient_number: recNum,
      recipient_name: recName,
      caption: raw,
      parsed_message: content,
      scheduled_at: scheduledAt.toISOString(),
      status: 'pending',
      retry_count: 0,
      max_retries: 3
    });

    if (insErr) {
      console.error('insert err:', insErr.message);
      await notifyOwner(instanceName, ownerPhone, '\u274c Errore DB: ' + insErr.message);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    // Notifica il MITTENTE CORRETTO
    await notifyOwner(instanceName, ownerPhone,
      `\u2705 Programmato per ${formatRome(scheduledAt)} a ${recName} (${recNum}).\n\ud83d\udcac "${content}"\n\u23f3 Trial: ${daysLeft} giorni`
    );

    return NextResponse.json({ ok:true, scheduled: scheduledAt.toISOString() });

  } catch(e: any) {
    console.error('webhook err:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
                       }
