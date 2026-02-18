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
              console.log("Webhook:", payload.event);

        if (payload.event?.toLowerCase() !== 'messages.upsert') {
                  return NextResponse.json({ ok: true });
        }

        const data = payload.data;
              console.log("Webhook data keys:", JSON.stringify(Object.keys(data || {})));
              console.log("Webhook message keys:", JSON.stringify(Object.keys(data?.message || {})));

        const remoteJid = data.key?.remoteJid || '';
              const senderPhone = remoteJid.split('@')[0].replace(/\D/g, '');

        if (!senderPhone || data.key?.fromMe === false) {
                  console.log("Skipped: no senderPhone or fromMe=false");
                  return NextResponse.json({ ok: true });
        }

        // Estrai testo
        let messageText = '';
              if (data.message?.conversation) {
                        messageText = data.message.conversation;
              } else if (data.message?.extendedTextMessage?.text) {
                        messageText = data.message.extendedTextMessage.text;
              }

        console.log("Message text:", messageText);

        // ===== FIX: Estrai vCard da contextInfo (percorso corretto) =====
        let recipientNumber: string | null = null;
              let recipientName: string | null = null;

        // Percorso 1: vCard in extendedTextMessage.contextInfo.quotedMessage
        const contextInfo = data.message?.extendedTextMessage?.contextInfo;
              const quoted = contextInfo?.quotedMessage;

        console.log("contextInfo exists:", !!contextInfo);
              console.log("quotedMessage exists:", !!quoted);

        if (quoted?.contactMessage?.vcard) {
                  console.log("Found vCard in quoted contactMessage");
                  const vcard = quoted.contactMessage.vcard;
                  recipientName = quoted.contactMessage.displayName || '';
                  const telMatch = vcard.match(/TEL[^:]*:([+\d\s-]+)/i);
                  if (telMatch) recipientNumber = telMatch[1].replace(/[\s-]/g, '');
                  console.log("vCard recipient:", recipientNumber, recipientName);
        }

        // Percorso 2: Messaggio diretto contactMessage (invio contatto senza testo)
        if (!recipientNumber && data.message?.contactMessage?.vcard) {
                  console.log("Found vCard in direct contactMessage");
                  const vcard = data.message.contactMessage.vcard;
                  recipientName = data.message.contactMessage.displayName || '';
                  const telMatch = vcard.match(/TEL[^:]*:([+\d\s-]+)/i);
                  if (telMatch) recipientNumber = telMatch[1].replace(/[\s-]/g, '');
        }

        // Percorso 3: contactsArrayMessage (contatto multiplo)
        if (!recipientNumber && data.message?.contactsArrayMessage?.contacts?.[0]?.vcard) {
                  console.log("Found vCard in contactsArrayMessage");
                  const contact = data.message.contactsArrayMessage.contacts[0];
                  const vcard = contact.vcard;
                  recipientName = contact.displayName || '';
                  const telMatch = vcard.match(/TEL[^:]*:([+\d\s-]+)/i);
                  if (telMatch) recipientNumber = telMatch[1].replace(/[\s-]/g, '');
        }

        // Fallback: usa il numero del mittente
        if (!recipientNumber) {
                  console.log("No recipient found, using sender phone:", senderPhone);
                  recipientNumber = senderPhone;
        }

        if (!messageText) {
                  console.log("No message text found, skipping");
                  return NextResponse.json({ ok: true, skipped: "no_text" });
        }

        // ===== FIX: Gestione utente con null safety =====
        let { data: user, error: selectError } = await supabase
                .from('user_instances')
                .select('*')
                .eq('phone_number', senderPhone)
                .single();

        console.log("User lookup result:", user ? "found" : "not found", selectError?.message || "");

        if (!user) {
                  console.log("Creating new user for phone:", senderPhone);
                  const { data: newUser, error: insertError } = await supabase
                    .from('user_instances')
                    .insert({
                                  phone_number: senderPhone,
                                  instance_name: payload.instance || 'SchedWhats-Primary',
                                  trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                                  subscription_status: 'trial'
                    })
                    .select()
                    .single();

                console.log("User insert result:", newUser ? "success" : "failed", insertError?.message || "");

                if (insertError || !newUser) {
                            console.error("Failed to create user:", insertError);
                            return NextResponse.json({ error: "Failed to create user: " + (insertError?.message || "unknown") }, { status: 500 });
                }
                  user = newUser;
        }

        // Verifica trial (con null safety)
        const now = new Date();
              const trialEnd = new Date(user.trial_ends_at);
              const isActive = trialEnd > now || user.subscription_status === 'active';

        if (!isActive) {
                  await notifyUser(senderPhone, "Trial scaduto! Attiva l'abbonamento a 1.99/mese per continuare: http://l8o400sowgw800swg8gcg0kk.161.35.212.68.sslip.io/payment");
                  return NextResponse.json({ error: "Trial expired" }, { status: 403 });
        }

        const scheduledDate = parseItalianDate(messageText);

        const { error: msgError } = await supabase
                .from('scheduled_messages')
                .insert({
                            user_instance_id: user.id,
                            instance_phone: senderPhone,
                            recipient_number: recipientNumber,
                            recipient_name: recipientName || 'Contatto',
                            caption: messageText,
                            parsed_message: messageText,
                            scheduled_at: scheduledDate?.toISOString() || new Date(Date.now() + 60 * 1000).toISOString(),
                            status: 'pending'
                });

        if (msgError) {
                  console.error("Failed to insert scheduled_message:", msgError);
                  throw msgError;
        }

        const timeStr = scheduledDate?.toLocaleString('it-IT', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
              const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        await notifyUser(senderPhone, "Messaggio programmato per " + timeStr + " a " + (recipientName || recipientNumber) + ". Hai " + daysLeft + " giorni di trial rimanenti.");

        console.log("SUCCESS: Message scheduled for", recipientNumber, "at", scheduledDate?.toISOString());
              return NextResponse.json({ success: true });

      } catch (err: any) {
              console.error("Webhook error:", err);
              return NextResponse.json({ error: err.message }, { status: 500 });
      }
}

async function notifyUser(phone: string, message: string) {
      try {
              const url = process.env.EVOLUTION_API_URL + '/message/sendText/SchedWhats-Primary';
              console.log("Sending notification to:", phone, "via:", url);
              const res = await fetch(url, {
                        method: 'POST',
                        headers: {
                                    'apikey': process.env.EVOLUTION_API_KEY!,
                                    'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                                    number: phone,
                                    text: message
                        })
              });
              const result = await res.text();
              console.log("Notification result:", res.status, result);
      } catch (e) {
              console.error("Notify failed:", e);
      }
}
