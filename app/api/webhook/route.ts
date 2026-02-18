// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
          );

function parseItalianDate(text: string): Date | null {
            const now = new Date();
            const lower = text.toLowerCase();
            const fraMatch = lower.match(/fra\s+(\d+)\s*(minuto|minuti|ora|ore|giorno|giorni)/);
            if (fraMatch) {
                          const amount = parseInt(fraMatch[1]);
                          const unit = fraMatch[2];
                          const d = new Date(now);
                          if (unit.startsWith('minuto') || unit.startsWith('minuti')) d.setMinutes(d.getMinutes() + amount);
                          else if (unit.startsWith('ora') || unit.startsWith('ore')) d.setHours(d.getHours() + amount);
                          else if (unit.startsWith('giorno') || unit.startsWith('giorni')) d.setDate(d.getDate() + amount);
                          return d;
            }
            const timeMatch = lower.match(/alle?\s+(\d{1,2})(?::(\d{2}))?/);
            if (timeMatch) {
                          const h = parseInt(timeMatch[1]);
                          const m = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
                          const d = new Date(now);
                          d.setHours(h, m, 0, 0);
                          if (d <= now) d.setDate(d.getDate() + 1);
                          return d;
            }
            return null;
}

function formatDateItalian(date: Date): string {
            return date.toLocaleString('it-IT', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
            });
}

async function notifyUser(phone: string, message: string) {
            if (!phone) return;
            await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/SchedWhats-Primary', {
                          method: 'POST',
                          headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ number: phone, text: message })
            });
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

              // Trova l'OWNER dell'istanza (chi ha scansionato il QR) - usa SEMPRE questo per le notifiche
              const instanceName = payload.instance || 'SchedWhats-Primary';
                          const { data: ownerInstance } = await supabase
                            .from('user_instances')
                            .select('phone_number, id')
                            .eq('instance_name', instanceName)
                            .order('created_at', { ascending: true })
                            .limit(1)
                            .single();

              // ownerPhone e' il numero di chi ha scansionato il QR (Note to Self)
              const ownerPhone = ownerInstance?.phone_number;
                          const userInstanceId = ownerInstance?.id;

              if (!ownerPhone || !userInstanceId) {
                              console.log('Owner not found for instance:', instanceName);
                              return NextResponse.json({ ok: true });
              }

              // Estrai il testo del messaggio
              const messageText =
                              data.message?.conversation ||
                              data.message?.extendedTextMessage?.text ||
                              data.message?.imageMessage?.caption ||
                              '';

              if (!messageText) {
                              return NextResponse.json({ ok: true });
              }

              // Parsa la data/ora dal testo
              const scheduledDate = parseItalianDate(messageText);
                          if (!scheduledDate) {
                                          return NextResponse.json({ ok: true });
                          }

              // FIX ESTRAZIONE DESTINATARIO:
              // Cerca prima in extendedTextMessage.contextInfo.quotedMessage.contactMessage (risposta a vCard)
              let recipientNumber: string | null = null;
                          let recipientName: string | null = null;

              const extText = data.message?.extendedTextMessage;
                          const quotedContact = extText?.contextInfo?.quotedMessage?.contactMessage;

              if (quotedContact) {
                              recipientName = quotedContact.displayName || 'Contatto';
                              const vcard = quotedContact.vcard || '';
                              const telMatch = vcard.match(/TEL[:;][^:]*:([+\d\s()-]+)/i) || vcard.match(/TEL[:;]+([+\d\s()-]+)/i);
                              if (telMatch) recipientNumber = telMatch[1].replace(/[\s()-]/g, '');
              }

              // Fallback: cerca in data.contextInfo diretto
              if (!recipientNumber && data.contextInfo?.quotedMessage?.contactMessage) {
                              const contact = data.contextInfo.quotedMessage.contactMessage;
                              recipientName = contact.displayName || 'Contatto';
                              const vcard = contact.vcard || '';
                              const telMatch = vcard.match(/TEL[:;][^:]*:([+\d\s()-]+)/i) || vcard.match(/TEL[:;]+([+\d\s()-]+)/i);
                              if (telMatch) recipientNumber = telMatch[1].replace(/[\s()-]/g, '');
              }

              // Fallback: se non e' una risposta a vCard, usa remoteJid come destinatario
              // (messaggio diretto a un contatto)
              if (!recipientNumber) {
                              const remoteJid = data.key?.remoteJid || '';
                              const extracted = remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');
                              // Se remoteJid e' il mio stesso numero (chat con me stesso / Note to Self), usa ownerPhone
                            if (extracted === ownerPhone || extracted === ownerPhone.replace(/^39/, '')) {
                                              recipientNumber = ownerPhone;
                                              recipientName = 'Me Stesso';
                            } else {
                                              recipientNumber = extracted;
                                              recipientName = 'Contatto';
                            }
              }

              // Verifica abbonamento
              const { data: user } = await supabase
                            .from('user_instances')
                            .select('id, trial_ends_at, subscription_status')
                            .eq('phone_number', ownerPhone)
                            .single();

              if (!user) {
                              await notifyUser(ownerPhone, '❌ Account non trovato. Scansiona il QR su ' + process.env.NEXT_PUBLIC_APP_URL);
                              return NextResponse.json({ ok: true });
              }

              const trialEnd = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
                          const isActive = user.subscription_status === 'active';
                          const isTrialValid = trialEnd && trialEnd > new Date();

              if (!isActive && !isTrialValid) {
                              await notifyUser(ownerPhone, '❌ Trial scaduto. Abbonati su ' + process.env.NEXT_PUBLIC_APP_URL);
                              return NextResponse.json({ ok: true });
              }

              // Calcola giorni rimanenti del trial
              let daysLeft = 0;
                          if (trialEnd) {
                                          daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                          }

              const timeStr = formatDateItalian(scheduledDate);

              // Inserisci nel DB
              const { data: insertData, error: insertError } = await supabase
                            .from('scheduled_messages')
                            .insert({
                                              user_id: null,
                                              user_instance_id: user.id,
                                              instance_phone: ownerPhone,       // NUMERO DELL'OWNER (Note to Self)
                                              recipient_number: recipientNumber, // NUMERO DEL CONTATTO ALLEGATO
                                              recipient_name: recipientName,     // NOME DEL CONTATTO
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
                              await notifyUser(ownerPhone, '❌ Errore salvataggio: ' + insertError.message);
                              return NextResponse.json({ error: insertError.message }, { status: 500 });
              }

              console.log('Insert SUCCESS:', JSON.stringify(insertData));

              // Notifica SEMPRE l'owner (Note to Self), MAI il destinatario
              await notifyUser(
                              ownerPhone,
                              `✅ Programmato per ${timeStr} a ${recipientName} (${recipientNumber}). Hai ${daysLeft} giorni di trial rimanenti.`
                            );

              return NextResponse.json({ ok: true, scheduled: scheduledDate.toISOString() });

            } catch (err: any) {
                          console.error('Webhook error:', err.message);
                          return NextResponse.json({ error: err.message }, { status: 500 });
            }
}
