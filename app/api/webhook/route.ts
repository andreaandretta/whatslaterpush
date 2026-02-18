// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

// Mappa numeri italiani in lettere → cifre
const NUMERI_IT: Record<string, number> = {
      'un': 1, 'uno': 1, 'una': 1,
      'due': 2,
      'tre': 3,
      'quattro': 4,
      'cinque': 5,
      'sei': 6,
      'sette': 7,
      'otto': 8,
      'nove': 9,
      'dieci': 10,
      'undici': 11,
      'dodici': 12,
      'quindici': 15,
      'venti': 20,
      'trenta': 30,
      'quaranta': 40,
      'cinquanta': 50,
      'sessanta': 60,
};

function parseItalianDate(text: string): Date | null {
      const now = new Date();
      const lower = text.toLowerCase();

  // Normalizza numeri in lettere → cifre
  let normalized = lower;
      for (const [word, num] of Object.entries(NUMERI_IT)) {
              normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'gi'), String(num));
      }

  // Pattern: "fra N minuti/ore/giorni"
  const fraMatch = normalized.match(/fra\s+(\d+)\s*(minuto|minuti|ora|ore|giorno|giorni)/);
      if (fraMatch) {
              const amount = parseInt(fraMatch[1]);
              const unit = fraMatch[2];
              const d = new Date(now);
              if (unit.startsWith('minuto') || unit.startsWith('minuti')) d.setMinutes(d.getMinutes() + amount);
              else if (unit.startsWith('ora') || unit.startsWith('ore')) d.setHours(d.getHours() + amount);
              else if (unit.startsWith('giorno') || unit.startsWith('giorni')) d.setDate(d.getDate() + amount);
              return d;
      }

  // Pattern: "alle HH:MM" o "alle H"
  const timeMatch = normalized.match(/alle?\s+(\d{1,2})(?::(\d{2}))?/);
      if (timeMatch) {
              const h = parseInt(timeMatch[1]);
              const m = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
              const d = new Date(now);
              d.setHours(h, m, 0, 0);
              if (d <= now) d.setDate(d.getDate() + 1);
              return d;
      }

  // Pattern: "domani alle H" o "domani H:MM"
  const domaniMatch = normalized.match(/domani(?:\s+alle?\s+(\d{1,2})(?::(\d{2}))?)?/);
      if (domaniMatch) {
              const d = new Date(now);
              d.setDate(d.getDate() + 1);
              if (domaniMatch[1]) {
                        d.setHours(parseInt(domaniMatch[1]), domaniMatch[2] ? parseInt(domaniMatch[2]) : 0, 0, 0);
              }
              return d;
      }

  return null;
}

function formatDateItalian(date: Date): string {
      return date.toLocaleString('it-IT', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              timeZone: 'Europe/Rome'
      });
}

async function notifyUser(phone: string, message: string) {
      if (!phone) return;
      try {
              const res = await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/SchedWhats-Primary', {
                        method: 'POST',
                        headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ number: phone, text: message })
              });
              console.log('notifyUser status:', res.status, 'phone:', phone);
      } catch (e: any) {
              console.error('notifyUser error:', e.message);
      }
}

export async function POST(req: Request) {
      try {
              const payload = await req.json();
              const data = payload?.data;

        if (!data?.message || !data?.key) {
                  return NextResponse.json({ ok: true });
        }

        // Solo messaggi inviati da noi (fromMe=true)
        if (!data.key?.fromMe) {
                  return NextResponse.json({ ok: true });
        }

        const instanceName = payload.instance || 'SchedWhats-Primary';

        // Trova l'OWNER dell'istanza
        const { data: ownerInstance } = await supabase
                .from('user_instances')
                .select('phone_number, id')
                .eq('instance_name', instanceName)
                .order('created_at', { ascending: true })
                .limit(1)
                .single();

        const ownerPhone = ownerInstance?.phone_number;
              const userInstanceId = ownerInstance?.id;

        if (!ownerPhone || !userInstanceId) {
                  console.log('Owner not found for instance:', instanceName);
                  return NextResponse.json({ ok: true });
        }

        const msgKeys = Object.keys(data.message || {});
              console.log('=== WEBHOOK ===', 'owner:', ownerPhone, 'msgType:', JSON.stringify(msgKeys));

        // STEP 1: contactMessage → salva pending contact
        if (data.message?.contactMessage) {
                  const contact = data.message.contactMessage;
                  const vcard = contact.vcard || '';
                  const displayName = contact.displayName || 'Contatto';

                // Prova prima il campo waid nel TEL (più affidabile per numeri WhatsApp)
                // TEL;type=CELL;waid=393780858599:+39 378 085 8599
                const waidMatch = vcard.match(/waid=(\d+)/i);
                  let recipientNumber = waidMatch ? waidMatch[1] : null;

                // Fallback: estrai dal TEL standard
                if (!recipientNumber) {
                            const telMatch = vcard.match(/TEL[^:]*:([+\d\s()-]+)/i) ||
                                                         vcard.match(/TEL[:;]+([+\d\s()-]+)/i);
                            if (telMatch) {
                                          recipientNumber = telMatch[1].replace(/[\s()\-+]/g, '');
                                          // Aggiungi prefisso 39 se numero italiano senza prefisso internazionale
                              if (recipientNumber.startsWith('0')) {
                                              recipientNumber = '39' + recipientNumber;
                              }
                            }
                }

                console.log('contactMessage:', displayName, 'waid:', waidMatch?.[1], 'recipientNumber:', recipientNumber);

                if (recipientNumber) {
                            // Cancella pending precedenti per questo owner
                    await supabase.from('pending_contacts').delete().eq('owner_phone', ownerPhone);

                    const { error } = await supabase.from('pending_contacts').insert({
                                  owner_phone: ownerPhone,
                                  recipient_number: recipientNumber,
                                  recipient_name: displayName
                    });

                    if (error) {
                                  console.error('Error saving pending contact:', error.message);
                    } else {
                                  console.log('Pending contact saved:', displayName, recipientNumber);
                    }
                } else {
                            console.log('Could not extract number from vCard:', vcard);
                }

                return NextResponse.json({ ok: true });
        }

        // STEP 2: testo → cerca pending contact e schedula
        const messageText = data.message?.conversation ||
                                    data.message?.extendedTextMessage?.text ||
                                    data.message?.imageMessage?.caption || '';

        console.log('messageText:', messageText);

        if (!messageText) {
                  return NextResponse.json({ ok: true });
        }

        const scheduledDate = parseItalianDate(messageText);
              if (!scheduledDate) {
                        console.log('No date found in message:', messageText);
                        return NextResponse.json({ ok: true });
              }

        console.log('Parsed date:', scheduledDate.toISOString());

        // Cerca pending contact (max 10 minuti fa)
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
              const { data: pendingContact } = await supabase
                .from('pending_contacts')
                .select('*')
                .eq('owner_phone', ownerPhone)
                .gte('created_at', tenMinutesAgo)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

        let recipientNumber: string;
              let recipientName: string;

        if (pendingContact) {
                  recipientNumber = pendingContact.recipient_number;
                  recipientName = pendingContact.recipient_name;
                  console.log('Using pending contact:', recipientName, recipientNumber);
                  // Cancella il pending usato
                await supabase.from('pending_contacts').delete().eq('id', pendingContact.id);
        } else {
                  // Fallback: Note to Self
                const remoteJid = data.key?.remoteJid || '';
                  recipientNumber = remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');
                  recipientName = 'Me Stesso';
                  console.log('No pending contact, fallback to self:', recipientNumber);
        }

        console.log('FINAL recipient:', recipientName, recipientNumber);

        // Verifica abbonamento
        const { data: user } = await supabase
                .from('user_instances')
                .select('id, trial_ends_at, subscription_status')
                .eq('phone_number', ownerPhone)
                .single();

        if (!user) {
                  await notifyUser(ownerPhone, '❌ Account non trovato.');
                  return NextResponse.json({ ok: true });
        }

        const trialEnd = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
              const isActive = user.subscription_status === 'active';
              const isTrialValid = trialEnd && trialEnd > new Date();

        if (!isActive && !isTrialValid) {
                  await notifyUser(ownerPhone, '❌ Trial scaduto. Abbonati su ' + process.env.NEXT_PUBLIC_APP_URL);
                  return NextResponse.json({ ok: true });
        }

        let daysLeft = 0;
              if (trialEnd) {
                        daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
              }

        const timeStr = formatDateItalian(scheduledDate);

        const { data: insertData, error: insertError } = await supabase
                .from('scheduled_messages')
                .insert({
                            user_id: null,
                            user_instance_id: user.id,
                            instance_phone: ownerPhone,
                            recipient_number: recipientNumber,
                            recipient_name: recipientName,
                            caption: messageText,
                            parsed_message: messageText,
                            scheduled_at: scheduledDate.toISOString(),
                            status: 'pending',
                            retry_count: 0,
                            max_retries: 3
                })
                .select();

        if (insertError) {
                  console.error('Insert error:', JSON.stringify(insertError));
                  await notifyUser(ownerPhone, '❌ Errore: ' + insertError.message);
                  return NextResponse.json({ error: insertError.message }, { status: 500 });
        }

        console.log('Scheduled successfully:', JSON.stringify(insertData?.[0]?.id));

        await notifyUser(
                  ownerPhone,
                  `✅ Programmato per ${timeStr} a ${recipientName} (${recipientNumber}). Trial: ${daysLeft} giorni.`
                );

        return NextResponse.json({ ok: true, scheduled: scheduledDate.toISOString() });

      } catch (err: any) {
              console.error('Webhook error:', err.message);
              return NextResponse.json({ error: err.message }, { status: 500 });
      }
}
