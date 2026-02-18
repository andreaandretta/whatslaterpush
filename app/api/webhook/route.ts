// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

// Parsing date intelligente (ITALIANO) - Senza OpenAI
function parseItalianDate(text: string): Date | null {
        const now = new Date();
        const lower = text.toLowerCase();

  // Pattern: "fra X minuti/ora/giorni"
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

  // Pattern: "domani alle XX:XX"
  const domaniMatch = lower.match(/domani\s+alle\s+(\d{1,2})[.:](\d{2})/);
        if (domaniMatch) {
                  const res = new Date(now);
                  res.setDate(res.getDate() + 1);
                  res.setHours(parseInt(domaniMatch[1]), parseInt(domaniMatch[2]), 0, 0);
                  return res;
        }

  // Pattern: "oggi alle XX:XX"
  const oggiMatch = lower.match(/oggi\s+alle\s+(\d{1,2})[.:](\d{2})/);
        if (oggiMatch) {
                  const res = new Date(now);
                  res.setHours(parseInt(oggiMatch[1]), parseInt(oggiMatch[2]), 0, 0);
                  return res;
        }

  // Pattern: "tra X minuti" (variante)
  const traMatch = lower.match(/tra\s+(\d+)\s+(min|minuti|h|ore)/);
        if (traMatch) {
                  const num = parseInt(traMatch[1]);
                  const res = new Date(now);
                  if (traMatch[2].startsWith('min')) res.setMinutes(res.getMinutes() + num);
                  else res.setHours(res.getHours() + num);
                  return res;
        }

  // Default: tra 5 minuti
  return new Date(now.getTime() + 5 * 60 * 1000);
}

export async function POST(req: Request) {
        try {
                  const payload = await req.json();
                  console.log("Webhook received event:", payload.event);

          if (payload.event?.toLowerCase() !== 'messages.upsert') {
                      return NextResponse.json({ ok: true });
          }

          const data = payload.data;
                  console.log("Data keys:", JSON.stringify(Object.keys(data || {})));
                  console.log("Message keys:", JSON.stringify(Object.keys(data?.message || {})));

          const remoteJid = data.key?.remoteJid || '';
                  const senderPhone = remoteJid.split('@')[0].replace(/\D/g, '');

          if (!senderPhone || data.key?.fromMe === false) {
                      console.log("Skipped: no senderPhone or fromMe=false, senderPhone:", senderPhone, "fromMe:", data.key?.fromMe);
                      return NextResponse.json({ ok: true });
          }

          // Estrai testo
          let messageText = '';
                  if (data.message?.conversation) {
                              messageText = data.message.conversation;
                  } else if (data.message?.extendedTextMessage?.text) {
                              messageText = data.message.extendedTextMessage.text;
                  }
                  console.log("Message text:", messageText, "Sender:", senderPhone);

          // Estrai vCard
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
                      console.log("vCard from direct:", recipientNumber, recipientName);
          }

          if (!recipientNumber && data.message?.contactsArrayMessage?.contacts?.[0]?.vcard) {
                      const contact = data.message.contactsArrayMessage.contacts[0];
                      recipientName = contact.displayName || '';
                      const telMatch = contact.vcard.match(/TEL[^:]*:([+\d\s-]+)/i);
                      if (telMatch) recipientNumber = telMatch[1].replace(/[\s-]/g, '');
                      console.log("vCard from array:", recipientNumber, recipientName);
          }

          if (!recipientNumber) {
                      recipientNumber = senderPhone;
                      console.log("Fallback recipient to sender:", recipientNumber);
          }

          if (!messageText) {
                      console.log("No message text, skipping");
                      return NextResponse.json({ ok: true, skipped: "no_text" });
          }

          // Gestione utente
          let { data: user, error: selectError } = await supabase
                    .from('user_instances')
                    .select('*')
                    .eq('phone_number', senderPhone)
                    .single();

          console.log("User lookup:", user ? "found id=" + user.id : "not found", selectError?.message || "");

          if (!user) {
                      const { data: newUser, error: insertUserError } = await supabase
                        .from('user_instances')
                        .insert({
                                        phone_number: senderPhone,
                                        instance_name: payload.instance || 'SchedWhats-Primary',
                                        trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                                        subscription_status: 'trial'
                        })
                        .select()
                        .single();

                    if (insertUserError || !newUser) {
                                  console.error("Failed to create user:", JSON.stringify(insertUserError));
                                  return NextResponse.json({ error: "Failed to create user: " + (insertUserError?.message || "unknown") }, { status: 500 });
                    }
                      user = newUser;
                      console.log("Created new user id:", user.id);
          }

          // Verifica trial
          const now = new Date();
                  const trialEnd = new Date(user.trial_ends_at);
                  const isActive = trialEnd > now || user.subscription_status === 'active';

          if (!isActive) {
                      await notifyUser(senderPhone, "Trial scaduto! Attiva l'abbonamento a 1.99/mese: http://l8o400sowgw800swg8gcg0kk.161.35.212.68.sslip.io/payment");
                      return NextResponse.json({ error: "Trial expired" }, { status: 403 });
          }

          const scheduledDate = parseItalianDate(messageText);
                  console.log("Scheduled date:", scheduledDate?.toISOString());

          // INSERT in scheduled_messages
          // user_id is nullable (no auth user for webhook), user_instance_id = user.id (FK to user_instances)
          const insertPayload = {
                      user_id: null,
                      user_instance_id: user.id,
                      instance_phone: senderPhone,
                      recipient_number: recipientNumber,
                      recipient_name: recipientName || 'Contatto',
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
                      console.error("Insert error details - code:", msgError.code, "message:", msgError.message, "details:", msgError.details, "hint:", msgError.hint);
                      return NextResponse.json({ error: msgError.message, details: msgError.details, code: msgError.code }, { status: 500 });
          }

          console.log("Insert SUCCESS:", JSON.stringify(insertData));

          const timeStr = scheduledDate?.toLocaleString('it-IT', {
                      hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short'
          });
                  const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                  await notifyUser(senderPhone, "✅ Messaggio programmato per " + timeStr + " a " + (recipientName || recipientNumber) + ". Hai " + daysLeft + " giorni di trial rimanenti.");

          return NextResponse.json({ success: true, id: insertData?.[0]?.id });

        } catch (err: any) {
                  console.error("Webhook fatal error:", err?.message, JSON.stringify(err));
                  return NextResponse.json({ error: err.message }, { status: 500 });
        }
}

async function notifyUser(phone: string, message: string) {
        try {
                  const url = process.env.EVOLUTION_API_URL + '/message/sendText/SchedWhats-Primary';
                  const res = await fetch(url, {
                              method: 'POST',
                              headers: {
                                            'apikey': process.env.EVOLUTION_API_KEY!,
                                            'Content-Type': 'application/json'
                              },
                              body: JSON.stringify({ number: phone, text: message })
                  });
                  const result = await res.text();
                  console.log("Notify result:", res.status, result);
        } catch (e) {
                  console.error("Notify failed:", e);
        }
}
