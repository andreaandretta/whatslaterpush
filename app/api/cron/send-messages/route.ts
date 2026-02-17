// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

// Rate limiting semplice
const rateLimit = new Map();

export async function GET(req: Request) {
        try {
                  // Rate limit: max 50 invii per minuto totali
          const now = Date.now();
                  const windowStart = now - 60000;
                  let requestCount = 0;
                  for (const [time] of rateLimit) {
                              if (time > windowStart) requestCount++;
                  }
                  if (requestCount > 50) {
                              return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
                  }
                  rateLimit.set(now, true);

          // Trova utenti attivi
          const { data: users } = await supabase
                    .from('user_instances')
                    .select('id, phone_number')
                    .or('subscription_status.eq.active,trial_ends_at.gte.' + new Date().toISOString());

          let sent = 0;
                  let failed = 0;

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
                                  try {
                                                  const res = await fetch(
                                                                    process.env.EVOLUTION_API_URL + '/message/sendText/SchedWhats-Primary',
                                                        {
                                                                            method: 'POST',
                                                                            headers: {
                                                                                                  'apikey': process.env.EVOLUTION_API_KEY!,
                                                                                                  'Content-Type': 'application/json'
                                                                            },
                                                                            body: JSON.stringify({
                                                                                                  number: msg.recipient_number,
                                                                                                  text: msg.parsed_message
                                                                            })
                                                        }
                                                                  );

                                    if (!res.ok) throw new Error('HTTP ' + res.status);

                                    await supabase
                                                    .from('scheduled_messages')
                                                    .update({ 
                                                                          status: 'sent', 
                                                                        sent_at: new Date().toISOString(),
                                                                        user_notified: true
                                                    })
                                                    .eq('id', msg.id);

                                    // Notifica mittente
                                    await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/SchedWhats-Primary', {
                                                      method: 'POST',
                                                      headers: {
                                                                          'apikey': process.env.EVOLUTION_API_KEY!,
                                                                          'Content-Type': 'application/json'
                                                      },
                                                      body: JSON.stringify({
                                                                          number: msg.instance_phone,
                                                                          text: 'Messaggio inviato con successo a ' + (msg.recipient_name || msg.recipient_number) + '!'
                                                      })
                                    });

                                    sent++;

                                  } catch (err: any) {
                                                  const newRetry = (msg.retry_count || 0) + 1;
                                                  await supabase
                                                    .from('scheduled_messages')
                                                    .update({ 
                                                                          status: newRetry >= 3 ? 'failed' : 'pending',
                                                                        retry_count: newRetry,
                                                                        error_message: err.message,
                                                                        scheduled_at: newRetry < 3 ? 
                                                                          new Date(Date.now() + 5 * 60 * 1000).toISOString() :
                                                                                              msg.scheduled_at
                                                    })
                                                    .eq('id', msg.id);

                                    if (newRetry >= 3) {
                                                      await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/SchedWhats-Primary', {
                                                                          method: 'POST',
                                                                          headers: {
                                                                                                'apikey': process.env.EVOLUTION_API_KEY!,
                                                                                                'Content-Type': 'application/json'
                                                                          },
                                                                          body: JSON.stringify({
                                                                                                number: msg.instance_phone,
                                                                                                text: 'Impossibile inviare messaggio a ' + msg.recipient_number + '. Verifica che il numero sia corretto.'
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
