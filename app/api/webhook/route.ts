// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

function parseItalianDate(text: string): Date | null {
          const now = new Date();
          const lower = text.toLowerCase();
          const fraMatch = lower.match(/fra\s+(\d+)\s+(minuto|minuti|ora|ore|giorno|giorni)/);
          if (fraMatch) {
                      const num = parseInt(fraMatch[1]);
                      const unit = fraMatch[2];
                      const res = new Date(now);
                      if (unit.startsWith('minut')) res.setMinutes(res.getMinutes() + num);
                      else if (unit.startsWith('or')) res.setHours(res.getHours() + num);
                      else if (unit.startsWith('giorn')) res.setDate(res.getDate() + num);
                      return res;
          }
          const domaniMatch = lower.match(/domani\s+alle\s+(\d{1,2})[.:](\d{2})/);
          if (domaniMatch) {
                      const res = new Date(now);
                      res.setDate(res.getDate() + 1);
                      res.setHours(parseInt(domaniMatch[1]), parseInt(domaniMatch[2]), 0, 0);
                      return res;
          }
          const oggiMatch = lower.match(/oggi\s+alle\s+(\d{1,2})[.:](\d{2})/);
          if (oggiMatch) {
                      const res = new Date(now);
                      res.setHours(parseInt(oggiMatch[1]), parseInt(oggiMatch[2]), 0, 0);
                      return res;
          }
          const traMatch = lower.match(/tra\s+(\d+)\s+(min|minuti|h|ore)/);
          if (traMatch) {
                      const num = parseInt(traMatch[1]);
                      const res = new Date(now);
                      if (traMatch[2].startsWith('min')) res.setMinutes(res.getMinutes() + num);
                      else res.setHours(res.getHours() + num);
                      return res;
          }
          return new Date(now.getTime() + 5 * 60 * 1000);
}

export async function POST(req: Request) {
          try {
                      const payload = await req.json();
                      console.log("Webhook event:", payload.event, "instance:", payload.instance);

            if (payload.event?.toLowerCase() !== 'messages.upsert') {
                          return NextResponse.json({ ok: true });
            }

            const data = payload.data;
                      const remoteJid = data.key?.remoteJid || '';
                      const fromMe = data.key?.fromMe;

            // SOLO messaggi inviati da noi (fromMe=true)
            if (!fromMe) {
                          console.log("Skipped: fromMe=false");
                          return NextResponse.json({ ok: true });
            }

            // ===== FIX PROBLEMA 1: ownerPhone invece di senderPhone =====
            // Quando fromMe=true, remoteJid è il DESTINATARIO, non il mittente.
            // Il mittente (owner) è chi ha scansionato il QR = phone_number in user_instances.
            const recipientFromJid = remoteJid.split('@')[0].replace(/\D/g, '');

            // Trova l'owner dell'istanza (chi ha scansionato il QR)
            const instanceName = payload.instance || 'SchedWhats-Primary';
                      const { data: instanceOwner } = await supabase
                        .from('user_instances')
                        .select('*')
                        .eq('instance_name', instanceName)
                        .order('created_at', { ascending: true })
                        .limit(1)
                        .single();

            const ownerPhone = instanceOwner?.phone_number;
                      console.log("Instance:", instanceName, "Owner phone:", ownerPhone, "Recipient from JID:", recipientFromJid);

            if (!ownerPhone) {
                          console.log("No owner found for instance:", instanceName);
                          return NextResponse.json({ ok: true });
            }

            // Estrai testo del messaggio
            let messageText = '';
                      if (data.message?.conversation) {
                                    messageText = data.message.conversation;
                      } else if (data.message?.extendedTextMessage?.text) {
                                    messageText = data.message.extendedTextMessage.text;
                      }
                      console.log("Message text:", messageText);

            if (!messageText) {
                          console.log("No message text, skipping");
                          return NextResponse.json({ ok: true, skipped: "no_text" });
            }

            // Estrai vCard per il destinatario
            let recipientNumber: string | null = null;
                      let recipientName: string | null = null;

            const contextInfo = data.message?.extendedTextMessage?.contextInfo;
                      const quoted = contextInfo?.quotedMessage;

            if (quoted?.contactMessage?.vcard) {
                          const vcard = quoted.contactMessage.vcard;
                          recipientName = quoted.contactMessage.displayName || '';
                          const telMatch = vcard.match(/TEL[^:]*:([+\d\s-]+)/i);
                          if (telMatch) recipientNumber = telMatch[1].replace(/[\s-]/g, '');
                          console.log("vCard from quoted:", recipientNumber, recipientName);
            }
                      if (!recipientNumber && data.message?.contactMessage?.vcard) {
                                    const vcard = data.message.contactMessage.vcard;
                                    recipientName = data.message.contactMessage.displayName || '';
                                    const telMatch = vcard.match(/TEL[^:]*:([+\d\s-]+)/i);
                                    if (telMatch) recipientNumber = telMatch[1].replace(/[\s-]/g, '');
                      }
                      if (!recipientNumber && data.message?.contactsArrayMessage?.contacts?.[0]?.vcard) {
                                    const contact = data.message.contactsArrayMessage.contacts[0];
                                    recipientName = contact.displayName || '';
                                    const telMatch = contact.vcard.match(/TEL[^:]*:([+\d\s-]+)/i);
                                    if (telMatch) recipientNumber = telMatch[1].replace(/[\s-]/g, '');
                      }

            // Se nessuna vCard, il destinatario è chi hai scritto (il remoteJid quando fromMe=true)
            if (!recipientNumber) {
                          recipientNumber = recipientFromJid;
                          console.log("Using remoteJid as recipient:", recipientNumber);
            }

            // Usa l'user trovato dall'instance
            const user = instanceOwner;
                      console.log("Using user id:", user.id, "phone:", user.phone_number);

            // Verifica trial
            const now = new Date();
                      const trialEnd = new Date(user.trial_ends_at);
                      const isActive = trialEnd > now || user.subscription_status === 'active';
                      if (!isActive) {
                                    // Notifica SEMPRE l'owner (Note to Self)
                        await notifyUser(ownerPhone, "Trial scaduto! Attiva abbonamento: http://l8o400sowgw800swg8gcg0kk.161.35.212.68.sslip.io/payment");
                                    return NextResponse.json({ error: "Trial expired" }, { status: 403 });
                      }

            const scheduledDate = parseItalianDate(messageText);
                      console.log("Scheduled for:", scheduledDate?.toISOString(), "recipient:", recipientNumber);

            const insertPayload = {
                          user_id: null,
                          user_instance_id: user.id,
                          instance_phone: ownerPhone,  // SEMPRE il numero dell'owner
                          recipient_number: recipientNumber,
                          recipient_name: recipientName || recipientFromJid,
                          caption: messageText,
                          parsed_message: messageText,
                          scheduled_at: scheduledDate?.toISOString() || new Date(Date.now() + 60 * 1000).toISOString(),
                          status: 'pending',
                          retry_count: 0,
                          max_retries: 3
            };
                      console.log("Inserting:", JSON.stringify(insertPayload));

            const { data: insertData, error: msgError } = await supabase
                        .from('scheduled_messages')
                        .insert(insertPayload)
                        .select();

            if (msgError) {
                          console.error("Insert error:", JSON.stringify(msgError));
                          return NextResponse.json({ error: msgError.message, code: msgError.code }, { status: 500 });
            }

            console.log("Insert SUCCESS id:", insertData?.[0]?.id);

            const timeStr = scheduledDate?.toLocaleString('it-IT', {
                          hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short'
            });
                      const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

            // NOTIFICA SEMPRE L'OWNER (Note to Self), mai il destinatario
            await notifyUser(ownerPhone, "✅ Programmato per " + timeStr + " a " + (recipientName || recipientNumber) + ". Trial: " + daysLeft + "gg rimanenti.");

            return NextResponse.json({ success: true, id: insertData?.[0]?.id });

          } catch (err: any) {
                      console.error("Webhook fatal error:", err?.message);
                      return NextResponse.json({ error: err.message }, { status: 500 });
          }
}

async function notifyUser(phone: string, message: string) {
          if (!phone) { console.error("notifyUser: no phone!"); return; }
          try {
                      const url = process.env.EVOLUTION_API_URL + '/message/sendText/SchedWhats-Primary';
                      const res = await fetch(url, {
                                    method: 'POST',
                                    headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ number: phone, text: message })
                      });
                      console.log("Notify to", phone, ":", res.status);
          } catch (e) {
                      console.error("Notify failed:", e);
          }
}
