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
          else if (unit.startsWith('ora')) res.setHours(res.getHours() + num);
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
          const remoteJid = data.key?.remoteJid || '';
          const senderPhone = remoteJid.split('@')[0].replace(/\D/g, '');

      if (!senderPhone || data.key?.fromMe === false) {
              return NextResponse.json({ ok: true });
      }

      // Estrai testo
      let messageText = '';
          if (data.message?.conversation) {
                  messageText = data.message.conversation;
          } else if (data.message?.extendedTextMessage?.text) {
                  messageText = data.message.extendedTextMessage.text;
          }

      // Estrai vCard da contactMessage
      let recipientNumber = null;
          let recipientName = null;
          const quoted = data.contextInfo?.quotedMessage;

      if (quoted?.contactMessage?.vcard) {
              const vcard = quoted.contactMessage.vcard;
              recipientName = quoted.contactMessage.displayName || '';
              const telMatch = vcard.match(/TEL[:;]+([+\d\s-]+)/i);
              if (telMatch) recipientNumber = telMatch[1].replace(/\s/g, '');
      } else if (quoted?.conversation) {
              recipientNumber = quoted.conversation.replace(/\s/g, '');
      }

      if (!recipientNumber) recipientNumber = senderPhone;

      // Gestione utente
      let { data: user } = await supabase
            .from('user_instances')
            .select('*')
            .eq('phone_number', senderPhone)
            .single();

      if (!user) {
              const { data: newUser } = await supabase
                .from('user_instances')
                .insert({
                            phone_number: senderPhone,
                            instance_name: payload.instance || 'SchedWhats-Primary',
                            trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                            subscription_status: 'trial'
                })
                .select()
                .single();
              user = newUser;
      }

      // Verifica trial
      const now = new Date();
          const trialEnd = new Date(user.trial_ends_at);
          const isActive = trialEnd > now || user.subscription_status === 'active';

      if (!isActive) {
              await notifyUser(senderPhone, "Trial scaduto! Attiva l'abbonamento a 1.99/mese per continuare: http://l8o400sowgw800swg8gcg0kk.161.35.212.68.sslip.io/payment");
              return NextResponse.json({ error: "Trial expired" }, { status: 403 });
      }

      const scheduledDate = parseItalianDate(messageText);

      const { error } = await supabase
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

      if (error) throw error;

      const timeStr = scheduledDate?.toLocaleString('it-IT', {hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short'});
          const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime())/(1000*60*60*24));
          await notifyUser(senderPhone, "Messaggio programmato per " + timeStr + " a " + (recipientName || recipientNumber) + ". Hai " + daysLeft + " giorni di trial rimanenti.");

      return NextResponse.json({ success: true });

    } catch (err: any) {
          console.error(err);
          return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

async function notifyUser(phone: string, message: string) {
    try {
          await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/SchedWhats-Primary', {
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
    } catch (e) {
          console.error("Notify failed:", e);
    }
}
