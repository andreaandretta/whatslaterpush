// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { evolutionClient } from '@/lib/evolution/client'

const CRON_SECRET = process.env.CRON_SECRET || ''
const INSTANCE_NAME = 'SchedWhats-Primary'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: NextRequest) {
      const authHeader = request.headers.get('authorization')
      if (CRON_SECRET && authHeader && authHeader !== `Bearer ${CRON_SECRET}`) {
              return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

  const supabase = createServiceClient()
      const results = []
            let processed = 0

  try {
          const now = new Date().toISOString()

        const { data: activeUsers } = await supabase
            .from('user_instances')
            .select('id, phone_number, instance_name')
            .or(`subscription_status.eq.active,trial_ends_at.gte.${now}`)

        const activeUserIds = (activeUsers || []).map(u => u.id)

        const { data: messages, error: fetchError } = await supabase
            .from('scheduled_messages')
            .select('*')
            .eq('status', 'pending')
            .lte('scheduled_at', now)
            .order('scheduled_at', { ascending: true })
            .limit(10)

        if (fetchError) {
                  console.error('Cron fetch error:', fetchError)
                  return NextResponse.json({ error: fetchError.message }, { status: 500 })
        }

        if (!messages || messages.length === 0) {
                  return NextResponse.json({ sent: 0, message: 'No pending messages' })
        }

        const eligibleMessages = messages.filter(msg => {
                  if (!msg.user_instance_id) return true
                  return activeUserIds.includes(msg.user_instance_id)
        })

        const expiredMessages = messages.filter(msg => {
                  if (!msg.user_instance_id) return false
                  return !activeUserIds.includes(msg.user_instance_id)
        })

        for (const expMsg of expiredMessages) {
                  await supabase
                    .from('scheduled_messages')
                    .update({ status: 'failed', updated_at: now })
                    .eq('id', expMsg.id)
                  results.push({ id: expMsg.id, status: 'expired_user', skipped: true })
        }

        for (const msg of eligibleMessages) {
                  processed++
                            try {
                                        await supabase
                                          .from('scheduled_messages')
                                          .update({ status: 'processing' })
                                          .eq('id', msg.id)

                    let instanceName = INSTANCE_NAME
                                        if (msg.instance_id) {
                                                      const { data: inst } = await supabase
                                                        .from('whatsapp_instances')
                                                        .select('instance_name')
                                                        .eq('id', msg.instance_id)
                                                        .single()
                                                      if (inst) instanceName = inst.instance_name
                                        }

                    const messageText = msg.parsed_message || msg.caption || 'Scheduled message'
                                        await evolutionClient.sendMessage(instanceName, {
                                                      number: msg.recipient_number,
                                                      text: messageText,
                                                      options: { delay: 1200, presence: 'composing' },
                                        })

                    await supabase
                                          .from('scheduled_messages')
                                          .update({ status: 'sent', sent_at: now })
                                          .eq('id', msg.id)

                    await supabase.from('message_logs').insert({
                                  message_id: msg.id,
                                  user_id: msg.user_id,
                                  log_type: 'sent',
                                  details: { recipient: msg.recipient_number, instanceName },
                    })

                    results.push({ id: msg.id, status: 'sent' })
                            } catch (sendError) {
                                        console.error(`Failed to send ${msg.id}:`, sendError)
                                        const retryCount = (msg.retry_count || 0) + 1
                                        const maxRetries = msg.max_retries || 3
                                        const newStatus = retryCount >= maxRetries ? 'failed' : 'pending'

                    await supabase
                                          .from('scheduled_messages')
                                          .update({ status: newStatus, retry_count: retryCount })
                                          .eq('id', msg.id)

                    results.push({ id: msg.id, status: newStatus, error: String(sendError) })
                            }
        }

        return NextResponse.json({ processed, skipped_expired: expiredMessages.length, results, timestamp: now })
  } catch (error) {
          console.error('Cron fatal error:', error)
          return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
      return GET(request)
}
