// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  try {
    // Trova tutti gli utenti attivi (trial valido o abbonati)
    const { data: users } = await supabase
      .from('user_instances')
      .select('id, phone_number, instance_name, trial_ends_at, subscription_status')
      .or('subscription_status.eq.active,trial_ends_at.gte.' + new Date().toISOString());

    let sent = 0, failed = 0;

    for (const user of users || []) {
      // Max 10 messaggi per utente per ciclo
      const { data: messages } = await supabase
        .from('scheduled_messages')
        .select('*')
        .eq('user_instance_id', user.id)
        .eq('status', 'pending')
        .lte('scheduled_at', new Date().toISOString())
        .limit(10);

      for (const msg of messages || []) {
        // Usa l'instance_name dell'istanza dell'utente (P1 fix: non hardcoded)
        const instanceName = user.instance_name || 'SchedWhats-Primary';
        // Il phone per notificare l'owner e' instance_phone del messaggio
        const ownerPhone = msg.instance_phone || user.phone_number;

        try {
          // Invia il messaggio al destinatario
          const res = await fetch(
            process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName,
            {
              method: 'POST',
              headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
              body: JSON.stringify({ number: msg.recipient_number, text: msg.parsed_message })
            }
          );
          if (!res.ok) throw new Error('HTTP ' + res.status);

          await supabase.from('scheduled_messages')
            .update({ status: 'sent', sent_at: new Date().toISOString(), user_notified: true })
            .eq('id', msg.id);

          // Notifica owner via LA SUA istanza (P1 fix)
          await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
            method: 'POST',
            headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              number: ownerPhone,
              text: '✅ Inviato a ' + (msg.recipient_name || msg.recipient_number) + '!'
            })
          });
          sent++;
        } catch (err: any) {
          const newRetry = (msg.retry_count || 0) + 1;
          await supabase.from('scheduled_messages').update({
            status: newRetry >= 3 ? 'failed' : 'pending',
            retry_count: newRetry,
            error_message: err.message,
            scheduled_at: newRetry < 3
              ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
              : msg.scheduled_at
          }).eq('id', msg.id);

          if (newRetry >= 3) {
            await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
              method: 'POST',
              headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                number: ownerPhone,
                text: '❌ Impossibile inviare a ' + (msg.recipient_name || msg.recipient_number) + '. Verifica il numero.'
              })
            });
            failed++;
          }
        }
      }
    }

    return NextResponse.json({ sent, failed, timestamp: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
      }
