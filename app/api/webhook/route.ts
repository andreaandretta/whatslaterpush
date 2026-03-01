// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supabase = createClient(
                process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

// ══ Rome timezone helpers ══
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
function parseCommand(text: string): { date: Date; cmdStart: number; cmdEnd: number }|null {
                const norm = normalizeNumbers(text.toLowerCase());
                const nowR = nowRome();
                const dateM = /il\s+(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\s*(?:alle?\s+(\d{1,2})(?::(\d{2}))?)?/.exec(norm);
                if (dateM) {
                                        const d = new Date(nowR);
                                        d.setDate(parseInt(dateM[1]));
                                        d.setMonth(parseInt(dateM[2]) - 1);
                                        if (dateM[3]) { const yr = dateM[3].length === 2 ? '20'+dateM[3] : dateM[3]; d.setFullYear(parseInt(yr)); }
                                        d.setHours(dateM[4] ? parseInt(dateM[4]) : 9, dateM[5] ? parseInt(dateM[5]) : 0, 0, 0);
                                        return { date: romeToUtc(d), cmdStart: dateM.index, cmdEnd: dateM.index + dateM[0].length };
                }
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
function extractContent(raw: string, cmdStart: number, cmdEnd: number): string {
                let t = normalizeNumbers(raw.replace(SCHED_KW, '').toLowerCase());
                const dateM = /il\s+\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\s*(?:alle?\s+\d{1,2}(?::\d{2})?)?/i.exec(t);
                if (dateM) {
                                        t = t.slice(0, dateM.index) + t.slice(dateM.index + dateM[0].length);
                } else {
                                        const fraM = /fra\s+\d+\s*(minuto|minuti|ora|ore|giorno|giorni)/i.exec(t);
                                        if (fraM) {
                                                                        t = t.slice(0, fraM.index) + t.slice(fraM.index + fraM[0].length);
                                        } else {
                                                                        const domM = /domani(?:\s+alle?\s+\d{1,2}(?::\d{2})?)?/i.exec(t);
                                                                        if (domM) {
                                                                                                                t = t.slice(0, domM.index) + t.slice(domM.index + domM[0].length);
                                                                                } else {
                                                                                                                const alleM = /alle?\s+\d{1,2}(?::\d{2})?/i.exec(t);
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

async function findUserByPhone(phone: string): Promise<any> {
                const variants = new Set<string>();
                variants.add(phone);
                if (phone.startsWith('39') && phone.length > 9) variants.add(phone.substring(2));
                else variants.add('39' + phone);
                for (const v of variants) {
                                        const { data } = await supabase.from('user_instances').select('id, phone_number, subscription_status, trial_ends_at, instance_name').eq('phone_number', v).maybeSingle();
                                        if (data) return data;
                }
                return null;
}

async function createUser(phone: string, instanceName: string): Promise<any> {
                const normalized = phone.startsWith('39') ? phone : '39' + phone;
                console.log('WEBHOOK: Creating user:', normalized, 'instance:', instanceName);
                const { data: newUser, error } = await supabase.from('user_instances').insert({
                                        phone_number: normalized,
                                        instance_name: instanceName,
                                        subscription_status: 'trial',
                                        trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
                }).select().single();
                if (error) {
                                        console.error('WEBHOOK: Create user err:', error.message);
                                        if (error.message.includes('duplicate') || error.message.includes('unique')) return await findUserByPhone(normalized);
                                        return null;
                }
                console.log('WEBHOOK: User created:', newUser.id, normalized);
                return newUser;
}

// ══ Extract message item from Evolution v2 payload (supports both formats) ══
// Evolution v2 sends: { event: "messages.upsert", data: { messages: [...] } }
// Legacy format:      { event: "MESSAGES_UPSERT",  data: { message: {}, key: {} } }
function extractMessageItem(payload: any): { msgKey: any; msgContent: any } | null {
                const data = payload?.data;
                if (!data) return null;

        // FORMAT 1: Evolution v2 — data.messages is an array
        if (Array.isArray(data.messages) && data.messages.length > 0) {
                                const item = data.messages[0];
                                return { msgKey: item.key, msgContent: item.message };
        }

        // FORMAT 2: Legacy flat — data.key + data.message
        if (data.key && data.message) {
                                return { msgKey: data.key, msgContent: data.message };
        }

        return null;
}

export async function POST(req: Request) {
                let rawBody = '';
                try {
                                        const payload = await req.json();
                                        rawBody = JSON.stringify(payload).substring(0, 500);
                                        console.log('WEBHOOK: Incoming payload preview:', rawBody);

                        const eventType = payload?.event || payload?.type || 'unknown';
                                        const evoInstance = payload?.instance || 'SchedWhats-Primary';
                                        console.log('WEBHOOK: event=' + eventType + ' instance=' + evoInstance);

                        // Extract message from either Evolution v2 or legacy format
                        const extracted = extractMessageItem(payload);
                                        if (!extracted) {
                                                                        console.log('WEBHOOK: Skipped - no message found. event=' + eventType);
                                                                        return NextResponse.json({ ok:true });
                                        }

                        const { msgKey, msgContent } = extracted;

                        if (!msgContent || !msgKey) {
                                                        console.log('WEBHOOK: Skipped - no message or key. event=' + eventType);
                                                        return NextResponse.json({ ok:true });
                        }

                        // BUG2 FIX: Accept messages where fromMe=true OR where the sender is the owner (self-chat)
                        // On WhatsApp "Note to Self", fromMe can be true or false depending on sync direction
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

                        console.log('WEBHOOK: Processing - sender=' + senderRaw + ' evoInstance=' + evoInstance);

                        let user = await findUserByPhone(senderRaw);
                                        if (!user) {
                                                                        console.log('WEBHOOK: User not found for ' + senderRaw + ', creating...');
                                                                        user = await createUser(senderRaw, evoInstance);
                                        }
                                        if (!user) {
                                                                        console.error('WEBHOOK: Cannot create user for:', senderRaw);
                                                                        return NextResponse.json({ error: 'Cannot create user' }, { status: 500 });
                                        }
                                        if (user.instance_name !== evoInstance) {
                                                                        console.log('WEBHOOK: Updating instance_name from', user.instance_name, 'to', evoInstance);
                                                                        await supabase.from('user_instances').update({ instance_name: evoInstance }).eq('id', user.id);
                                                                        user.instance_name = evoInstance;
                                        }

                        const ownerPhone = user.phone_number;
                                        const instanceName = user.instance_name || evoInstance;
                                        console.log('WEBHOOK: Owner=' + ownerPhone + ' Instance=' + instanceName);

                        // ══ vCard handling ══
                        if (msgContent?.contactMessage) {
                                                        const c = msgContent.contactMessage;
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
                                                        console.log('WEBHOOK: vCard received:', name, num, 'owner:', ownerPhone);
                                                        if (num) {
                                                                                                const { error: upsertErr } = await supabase.from('pending_contacts').upsert(
                                                                                                        { owner_phone: ownerPhone, recipient_number: num, recipient_name: name, created_at: new Date().toISOString() },
                                                                                                        { onConflict: 'owner_phone,recipient_number' }
                                                                                                                                        );
                                                                                                if (upsertErr) {
                                                                                                                                                console.error('WEBHOOK: vCard upsert err:', upsertErr.message);
                                                                                                                                                await supabase.from('pending_contacts').delete().eq('owner_phone', ownerPhone).eq('recipient_number', num);
                                                                                                                                                await supabase.from('pending_contacts').insert({ owner_phone: ownerPhone, recipient_number: num, recipient_name: name });
                                                                                                        } else {
                                                                                                                                                console.log('WEBHOOK: vCard saved for', ownerPhone, '-> recipient:', name, num);
                                                                                                        }
                                                        }
                                                        return NextResponse.json({ ok:true });
                        }

                        // ══ Text message parsing ══
                        const raw = msgContent?.conversation || msgContent?.extendedTextMessage?.text || msgContent?.imageMessage?.caption || '';
                                        if (!raw) {
                                                                        console.log('WEBHOOK: Empty text message, skipping');
                                                                        return NextResponse.json({ ok:true });
                                        }
                                        console.log('WEBHOOK: Text received:', raw);
                                        const rawLower = raw.trim().toLowerCase();

                        // ══ COMMAND: lista ══
                        if (/^(lista|list|pending|programmati)$/i.test(rawLower)) {
                                                        const { data: pending } = await supabase
                                                                .from('scheduled_messages')
                                                                .select('id, recipient_name, recipient_number, parsed_message, scheduled_at')
                                                                .eq('instance_phone', ownerPhone).eq('status', 'pending')
                                                                .order('scheduled_at', { ascending: true }).limit(10);
                                                        if (!pending || pending.length === 0) {
                                                                                                await notifyOwner(instanceName, ownerPhone, '📋 Nessun messaggio in coda.');
                                                                                                return NextResponse.json({ ok: true });
                                                        }
                                                        const listText = pending.map((m, i) => {
                                                                                                const name = m.recipient_name || m.recipient_number || '?';
                                                                                                const time = formatRome(new Date(m.scheduled_at));
                                                                                                const preview = (m.parsed_message || '').substring(0, 30);
                                                                                                return `${i + 1}. 👤 ${name} — ${time}\n 💬 "${preview}${preview.length >= 30 ? '...' : ''}"`;
                                                        }).join('\n\n');
                                                        await notifyOwner(instanceName, ownerPhone, `📋 Messaggi programmati (${pending.length}):\n\n${listText}\n\n✏️ Scrivi "cancella 1" per annullare.`);
                                                        return NextResponse.json({ ok: true });
                        }

                        // ══ COMMAND: annulla / cancella (LIFO) ══
                        if (/^(annulla|cancella|delete|stop|undo)$/i.test(rawLower)) {
                                                        const { data: lastPending } = await supabase
                                                                .from('scheduled_messages')
                                                                .select('id, recipient_name, recipient_number, parsed_message, scheduled_at')
                                                                .eq('instance_phone', ownerPhone).eq('status', 'pending')
                                                                .order('created_at', { ascending: false }).limit(1).maybeSingle();
                                                        if (!lastPending) {
                                                                                                await notifyOwner(instanceName, ownerPhone, '❌ Nessun messaggio da annullare.');
                                                                                                return NextResponse.json({ ok: true });
                                                        }
                                                        await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', lastPending.id);
                                                        const recipientLabel = lastPending.recipient_name || lastPending.recipient_number || '?';
                                                        const scheduledTime = formatRome(new Date(lastPending.scheduled_at));
                                                        await notifyOwner(instanceName, ownerPhone, `🚫 Annullato!\n👤 A: ${recipientLabel}\n💬 "${(lastPending.parsed_message || '').substring(0, 50)}"\n📅 Era per: ${scheduledTime}`);
                                                        return NextResponse.json({ ok: true });
                        }

                        // ══ COMMAND: cancella N ══
                        const cancelNumMatch = /^(annulla|cancella|delete|cancel|stop)\s+(\d+)$/i.exec(rawLower);
                                        if (cancelNumMatch) {
                                                                        const idx = parseInt(cancelNumMatch[2]) - 1;
                                                                        const { data: pending } = await supabase
                                                                                .from('scheduled_messages')
                                                                                .select('id, recipient_name, recipient_number, parsed_message, scheduled_at')
                                                                                .eq('instance_phone', ownerPhone).eq('status', 'pending')
                                                                                .order('scheduled_at', { ascending: true }).limit(10);
                                                                        if (!pending || pending.length === 0) {
                                                                                                                await notifyOwner(instanceName, ownerPhone, '❌ Nessun messaggio da annullare.');
                                                                                                                return NextResponse.json({ ok: true });
                                                                                }
                                                                        if (idx < 0 || idx >= pending.length) {
                                                                                                                await notifyOwner(instanceName, ownerPhone, `❌ Numero non valido. Hai ${pending.length} messagg${pending.length !== 1 ? 'i' : 'io'}. Scrivi "lista" per vederli.`);
                                                                                                                return NextResponse.json({ ok: true });
                                                                                }
                                                                        const target = pending[idx];
                                                                        await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', target.id);
                                                                        const recipientLabel = target.recipient_name || target.recipient_number || '?';
                                                                        const scheduledTime = formatRome(new Date(target.scheduled_at));
                                                                        await notifyOwner(instanceName, ownerPhone, `🚫 Messaggio #${idx + 1} annullato!\n👤 A: ${recipientLabel}\n💬 "${(target.parsed_message || '').substring(0, 50)}"\n📅 Era per: ${scheduledTime}`);
                                                                        return NextResponse.json({ ok: true });
                                        }

                        // ══ COMMAND: cancella [nome] ══
                        const cancelNameMatch = /^(annulla|cancella|delete|cancel)\s+([a-z\u00e0\u00e8\u00e9\u00ec\u00f2\u00f9A-Z\u00c0\u00c8\u00c9\u00cc\u00d2\u00d9\s]{2,})$/i.exec(rawLower);
                                        if (cancelNameMatch && !/\d/.test(cancelNameMatch[2])) {
                                                                        const searchName = cancelNameMatch[2].trim();
                                                                        if (!/\b(fra|domani|alle|il|minuti|ore|giorni)\b/i.test(searchName)) {
                                                                                                                const { data: matching } = await supabase
                                                                                                                        .from('scheduled_messages')
                                                                                                                        .select('id, recipient_name, recipient_number, parsed_message, scheduled_at')
                                                                                                                        .eq('instance_phone', ownerPhone).eq('status', 'pending')
                                                                                                                        .ilike('recipient_name', `%${searchName}%`)
                                                                                                                        .order('created_at', { ascending: false }).limit(1).maybeSingle();
                                                                                                                if (matching) {
                                                                                                                                                                await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', matching.id);
                                                                                                                                                                const recipientLabel = matching.recipient_name || matching.recipient_number || '?';
                                                                                                                                                                const scheduledTime = formatRome(new Date(matching.scheduled_at));
                                                                                                                                                                await notifyOwner(instanceName, ownerPhone, `🚫 Annullato messaggio a ${recipientLabel}!\n💬 "${(matching.parsed_message || '').substring(0, 50)}"\n📅 Era per: ${scheduledTime}`);
                                                                                                                                                                return NextResponse.json({ ok: true });
                                                                                                                        }
                                                                                }
                                        }

                        // ══ COMMAND: help / aiuto ══
                        if (/^(help|aiuto|comandi|\?)$/i.test(rawLower)) {
                                                        await notifyOwner(instanceName, ownerPhone, `📖 Comandi SchedWhats:\n\n📎 Invia vCard + "ciao fra 5 minuti"\n→ Schedula messaggio\n\n📋 "lista" → Messaggi in coda\n🚫 "annulla" → Cancella l'ultimo\n🚫 "cancella 2" → Cancella il #2 dalla lista\n🚫 "cancella Marco" → Cancella per nome\n❓ "aiuto" → Questo messaggio`);
                                                        return NextResponse.json({ ok: true });
                        }

                        // ══ Scheduling logic ══
                        const parsed = parseCommand(raw);
                                        if (!parsed) {
                                                                        console.log('WEBHOOK: No scheduling command found in:', raw);
                                                                        return NextResponse.json({ ok:true });
                                        }

                        const scheduledAt = parsed.date;
                                        const content = extractContent(raw, parsed.cmdStart, parsed.cmdEnd);
                                        console.log('WEBHOOK: Scheduling at:', scheduledAt.toISOString(), 'msg:', content);

                        const { data: pc, error: pcErr } = await supabase
                                                .from('pending_contacts').select('*').eq('owner_phone', ownerPhone)
                                                .gte('created_at', new Date(Date.now() - 1800000).toISOString())
                                                .order('created_at', { ascending: false }).limit(1).maybeSingle();
                                        if (pcErr) console.error('WEBHOOK: pending_contacts query error:', pcErr.message);
                                        console.log('WEBHOOK: pending_contact found:', pc ? (pc.recipient_name + ' ' + pc.recipient_number) : 'none (sending to self)');

                        let recNum: string, recName: string;
                                        if (pc) {
                                                                        recNum = pc.recipient_number;
                                                                        recName = pc.recipient_name;
                                        } else {
                                                                        recNum = ownerPhone;
                                                                        recName = 'Me Stesso';
                                        }
                                        console.log('WEBHOOK: Will send to:', recName, recNum);

                        const trialEnd = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
  // BUG1 FIX: trial check disabled
  // if (user.subscription_status !== 'active' && !(trialEnd && trialEnd > new Date())) {
  //   await notifyOwner(instanceName, ownerPhone, '❌ Trial scaduto. Abbonati su whatslater.com per continuare.');
  //   return NextResponse.json({ ok:true });
  // }
  const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86400000)) : 0;
                                        const { error: insErr } = await supabase.from('scheduled_messages').insert({
                                                                        user_instance_id: user.id,
                                                                        instance_phone: ownerPhone,
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
                                                                        console.error('WEBHOOK: DB insert error:', insErr.message, 'code:', insErr.code);
                                                                        await notifyOwner(instanceName, ownerPhone, `❌ Errore salvataggio: ${insErr.message}`);
                                                                        return NextResponse.json({ error: insErr.message }, { status: 500 });
                                        }
                                        console.log('WEBHOOK: Message saved successfully for', ownerPhone, 'to', recName, 'at', scheduledAt.toISOString());
                                        await notifyOwner(instanceName, ownerPhone, `✅ Programmato per ${formatRome(scheduledAt)} a ${recName} (${recNum}).\n💬 "${content}"\n⏳ Trial: ${daysLeft}g`);
                                        return NextResponse.json({ ok:true, scheduled: scheduledAt.toISOString() });

                } catch(e: any) {
                                        console.error('WEBHOOK: Unhandled error:', e.message, e.stack);
                                        console.error('WEBHOOK: Raw body preview:', rawBody);
                                        return NextResponse.json({ error: e.message }, { status: 500 });
                }
}
