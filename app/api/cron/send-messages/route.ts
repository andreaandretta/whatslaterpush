// @ts-nocheck
/**
 * GET/POST /api/cron/send-messages
 * Cron endpoint: finds pending scheduled messages and sends them via Evolution API
 * Call this every minute via crontab or external cron service
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { evolutionClient } from '@/lib/evolution/client'

const CRON_SECRET = process.env.CRON_SECRET || ''
const INSTANCE_NAME = 'SchedWhats-Primary'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: NextRequest) {
    // Optional: verify cron secret
  const authHeader = request.headers.get('authorization')
    if (CRON_SECRET && authHeader && authHeader !== `Bearer ${CRON_SECRET}`) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

  const supabase = createServiceClient()
    const results = []
        let processed = 0

  try {
        // 1. Find pending messages where scheduled_at has passed
      const { data: messages, error: fetchError } = await supabase
          .from('scheduled_messages')
          .select('*')
          .eq('status', 'pending')
          .lte('scheduled_at', new Date().toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(10)

      if (fetchError) {
              console.error('Cron fetch error:', fetchError)
              return NextResponse.json({ error: fetchError.message }, { status: 500 })
      }

      if (!messages || messages.length === 0) {
              return NextResponse.json({ sent: 0, message: 'No pending messages' })
      }

      // 2. Process each message
      for (const msg of messages) {
              processed++
              try {
                        // Mark as processing
                await supabase
                          .from('scheduled_messages')
                          .update({ status: 'processing' })
                          .eq('id', msg.id)

                // Get instance name from whatsapp_instances if available
                let instanceName = INSTANCE_NAME
                        if (msg.instance_id) {
                                    const { data: inst } = await supabase
                                      .from('whatsapp_instances')
                                      .select('instance_name')
                                      .eq('id', msg.instance_id)
                                      .single()
                                    if (inst) instanceName = inst.instance_name
                        }

                // Send message via Evolution API
                const messageText = msg.parsed_message || msg.caption || 'Scheduled message'
                        await evolutionClient.sendMessage(instanceName, {
                                    number: msg.recipient_number,
                                    text: messageText,
                                    options: {
                                                  delay: 1200,
                                                  presence: 'composing',
                                    },
                        })

                // Mark as sent
                await supabase
                          .from('scheduled_messages')
                          .update({
                                        status: 'sent',
                                        sent_at: new Date().toISOString(),
                          })
                          .eq('id', msg.id)

                // Log success
                await supabase.from('message_logs').insert({
                            message_id: msg.id,
                            user_id: msg.user_id,
                            log_type: 'sent',
                            details: {
                                          recipient: msg.recipient_number,
                                          recipientName: msg.recipient_name,
                                          instanceName,
                            },
                })

                results.push({ id: msg.id, status: 'sent' })
              } catch (sendError) {
                        console.error(`Failed to send message ${msg.id}:`, sendError)
                        const retryCount = (msg.retry_count || 0) + 1
                        const maxRetries = msg.max_retries || 3
                        const newStatus = retryCount >= maxRetries ? 'failed' : 'pending'

                await supabase
                          .from('scheduled_messages')
                          .update({
                                        status: newStatus,
                                        retry_count: retryCount,
                          })
                          .eq('id', msg.id)

                // Log failure
                await supabase.from('message_logs').insert({
                            message_id: msg.id,
                            user_id: msg.user_id,
                            log_type: 'failed',
                            error_message: sendError instanceof Error ? sendError.message : 'Unknown error',
                            details: { retryCount, maxRetries },
                })

                results.push({ id: msg.id, status: newStatus, error: String(sendError) })
              }
      }

      return NextResponse.json({
              processed,
              results,
              timestamp: new Date().toISOString(),
      })
  } catch (error) {
        console.error('Cron fatal error:', error)
        return NextResponse.json(
          { error: 'Internal server error', details: String(error) },
          { status: 500 }
              )
  }
}

// Also support POST
export async function POST(request: NextRequest) {
    return GET(request)
}
