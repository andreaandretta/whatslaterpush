// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

// Rome offset in ms (positivo = Rome è avanti a UTC)
function getRomeOffsetMs(): number {
    const now = new Date();
    const utcStr = now.toLocaleString('en-CA', {
          timeZone: 'UTC', hour12: false,
          year:'numeric', month:'2-digit', day:'2-digit',
          hour:'2-digit', minute:'2-digit', second:'2-digit'
    });
    const romeStr = now.toLocaleString('en-CA', {
          timeZone: 'Europe/Rome', hour12: false,
          year:'numeric', month:'2-digit', day:'2-digit',
          hour:'2-digit', minute:'2-digit', second:'2-digit'
    });
    return new Date(romeStr.replace(', ','T')).getTime() - new Date(utcStr.replace(', ','T')).getTime();
}

function nowRome(): Date {
    return new Date(new Date().getTime() + getRomeOffsetMs());
}

function romeToUtc(d: Date): Date {
    return new Date(d.getTime() - getRomeOffsetMs());
}

const NUMERI_IT: Record<string,number> = {
    'un':1,'uno':1,'una':1,'due':2,'tre':3,'quattro':4,'cinque':5,
    'sei':6,'sette':7,'otto':8,'nove':9,'dieci':10,'undici':11,
    'dodici':12,'quindici':15,'venti':20,'trenta':30,'quaranta':40,'cinquanta':50,'sessanta':60,
};

function normalizeNumbers(s: string): string {
    for (const [w,n] of Object.entries(NUMERI_IT))
          s = s.replace(new RegExp('\\b'+w+'\\b','gi'),String(n));
    return s;
}

function parseCommand(text: string): { date: Date; cmdStart: number; cmdEnd: number }|null {
    const norm = normalizeNumbers(text.toLowerCase());
    const nowR = nowRome();

  const fraM = /fra\s+(\d+)\s*(minuto|minuti|ora|ore|giorno|giorni)/.exec(norm);
    if (fraM) {
          const n=parseInt(fraM[1]), u=fraM[2], d=new Date(nowR);
          if (u.startsWith('minut')) d.setMinutes(d.getMinutes()+n);
          else if (u.startsWith('or')) d.setHours(d.getHours()+n);
          else d.setDate(d.getDate()+n);
          return { date: romeToUtc(d), cmdStart: fraM.index, cmdEnd: fraM.index+fraM[0].length };
    }

  const domM = /domani(?:\s+alle?\s+(\d{1,2})(?::(\d{2}))?)?/.exec(norm);
    if (domM) {
          const d=new Date(nowR);
          d.setDate(d.getDate()+1);
          d.setHours(domM[1]?parseInt(domM[1]):9, domM[2]?parseInt(domM[2]):0, 0, 0);
          return { date: romeToUtc(d), cmdStart: domM.index, cmdEnd: domM.index+domM[0].length };
    }

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

// P3 FIX: rimuove SOLO il primo pattern temporale principale (fra X / domani / alle X),
// preservando eventuali altri orari nel testo (es. "alle 8 dici che il meeting è alle 15" → "il meeting è alle 15")
function extractContent(raw: string, cmdStart: number, cmdEnd: number): string {
    // Rimuovi keyword di scheduling (manda, scrivi, ecc.)
  let t = raw.replace(SCHED_KW, '');

  // Determina quale tipo di pattern temporale è il "comando principale" e rimuovilo
  const norm = normalizeNumbers(t.toLowerCase());

  // Rimuovi solo il pattern "fra X unità" se presente
  const fraM = /fra\s+\d+\s*(minuto|minuti|ora|ore|giorno|giorni)/i.exec(norm);
    if (fraM) {
          t = t.slice(0, fraM.index) + t.slice(fraM.index + fraM[0].length);
    } else {
          // Rimuovi "domani alle X" o "domani" come comando principale (solo la prima occorrenza)
      const domM = /domani(?:\s+alle?\s+\d{1,2}(?::\d{2})?)?/i.exec(norm);
          if (domM) {
                  t = t.slice(0, domM.index) + t.slice(domM.index + domM[0].length);
          } else {
                  // Rimuovi solo il PRIMO "alle X" trovato (il comando), non gli altri
            const alleM = /alle?\s+\d{1,2}(?::\d{2})?/i.exec(norm);
                  if (alleM) {
                            t = t.slice(0, alleM.index) + t.slice(alleM.index + alleM[0].length);
                  }
          }
    }

  return t.replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g,'').replace(/\s{2,}/g,' ').trim() || raw;
}

function formatRome(d: Date): string {
    return d.toLocaleString('it-IT',{
          day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', timeZone:'Europe/Rome'
    });
}

async function notifyOwner(instanceName: string, phone: string, msg: string) {
    if (!phone||!instanceName) return;
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
          if (!data?.message||!data?.key) return NextResponse.json({ ok:true });
          if (!data.key?.fromMe) return NextResponse.json({ ok:true });

      const instanceName = payload.instance||'SchedWhats-Primary';

      const { data: inst } = await supabase.from('user_instances')
            .select('phone_number,id, subscription_status, trial_ends_at')
            .eq('instance_name', instanceName)
            .order('created_at',{ascending:true}).limit(1).single();

      if (!inst?.phone_number) {
              console.log('No owner for:', instanceName);
              return NextResponse.json({ ok:true });
      }

      const ownerPhone = inst.phone_number, instanceId = inst.id;
          console.log('WEBHOOK', instanceName, ownerPhone, JSON.stringify(Object.keys(data.message||{})));

      if (data.message?.contactMessage) {
              const c=data.message.contactMessage, vcard=c.vcard||'', name=c.displayName||'Contatto';
              const waid=vcard.match(/waid=(\d+)/i)?.[1];
              let num=waid||null;
              if (!num) {
                        const tel=(vcard.match(/TEL[^:]*:([+\d\s()-]+)/i)||vcard.match(/TEL[:;]+([+\d\s()-]+)/i))?.[1];
                        if (tel) {
                                    num=tel.replace(/[\s()\-+]/g,'');
                                    if(num.startsWith('0')) num='39'+num;
                        }
              }
              console.log('contact:', name, num);
              if (num) {
                        // P4 FIX: UPSERT per (owner_phone, recipient_number) — supporta sequenze rapide multi-contatto
                // Se esiste già un pending per questo destinatario, aggiorna; altrimenti inserisce
                const { error: upsertErr } = await supabase.from('pending_contacts').upsert(
                  { owner_phone: ownerPhone, recipient_number: num, recipient_name: name, created_at: new Date().toISOString() },
                  { onConflict: 'owner_phone,recipient_number' }
                          );
                        if (upsertErr) {
                                    // Fallback: delete + insert se upsert non supportato
                          await supabase.from('pending_contacts').delete()
                                      .eq('owner_phone', ownerPhone).eq('recipient_number', num);
                                    await supabase.from('pending_contacts').insert(
                                      { owner_phone: ownerPhone, recipient_number: num, recipient_name: name }
                                                );
                        }
              }
              return NextResponse.json({ ok:true });
      }

      const raw=data.message?.conversation||data.message?.extendedTextMessage?.text||data.message?.imageMessage?.caption||'';
          if (!raw) return NextResponse.json({ ok:true });
          console.log('raw:', raw);

      const parsed=parseCommand(raw);
          if (!parsed) { console.log('no cmd:', raw); return NextResponse.json({ ok:true }); }

      const scheduledAt=parsed.date;
          // P3 FIX: passa cmdStart/cmdEnd per rimuovere solo il pattern temporale principale
      const content=extractContent(raw, parsed.cmdStart, parsed.cmdEnd);
          console.log('at:', scheduledAt.toISOString(), 'content:', content);

      // P4 FIX: TTL 30 minuti per pending_contacts (era 10)
      const { data: pc } = await supabase.from('pending_contacts').select('*')
            .eq('owner_phone',ownerPhone)
            .gte('created_at',new Date(Date.now()-1800000).toISOString())
            .order('created_at',{ascending:false}).limit(1).single();

      let recNum: string, recName: string;
          if (pc) {
                  recNum=pc.recipient_number; recName=pc.recipient_name;
                  // Non eliminare il pending_contact dopo l'uso — lascialo per 30 min
            // così messaggi multipli allo stesso contatto funzionano
          } else {
                  recNum=(data.key?.remoteJid||'').replace('@s.whatsapp.net','').replace('@g.us','');
                  recName='Me Stesso';
          }
          console.log('recipient:', recName, recNum);

      const trialEnd=inst.trial_ends_at?new Date(inst.trial_ends_at):null;
          if (inst.subscription_status!=='active'&&!(trialEnd&&trialEnd>new Date())) {
                  await notifyOwner(instanceName, ownerPhone, '❌ Trial scaduto. Abbonati su '+process.env.NEXT_PUBLIC_APP_URL);
                  return NextResponse.json({ ok:true });
          }

      const daysLeft=trialEnd?Math.max(0,Math.ceil((trialEnd.getTime()-Date.now())/86400000)):0;

      const { error: insErr } = await supabase.from('scheduled_messages').insert({
              user_id:null,
              user_instance_id:instanceId,
              instance_phone:ownerPhone,
              recipient_number:recNum,
              recipient_name:recName,
              caption:raw,
              parsed_message:content,
              scheduled_at:scheduledAt.toISOString(),
              status:'pending',
              retry_count:0,
              max_retries:3
      });

      if (insErr) {
              console.error('insert err:', insErr.message);
              await notifyOwner(instanceName, ownerPhone, '❌ Errore DB: '+insErr.message);
              return NextResponse.json({ error: insErr.message },{ status:500 });
      }

      await notifyOwner(instanceName, ownerPhone,
                              `✅ Programmato per ${formatRome(scheduledAt)} a ${recName} (${recNum}).\n💬 "${content}"\n⏳ Trial: ${daysLeft} giorni`
                            );

      return NextResponse.json({ ok:true, scheduled: scheduledAt.toISOString() });
    } catch(e: any) {
          console.error('webhook err:', e.message);
          return NextResponse.json({ error: e.message },{ status:500 });
    }
}
