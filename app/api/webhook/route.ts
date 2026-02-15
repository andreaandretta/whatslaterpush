// @ts-nocheck
/**
 * POST /api/webhook
 * Receives vCard from WhatsApp, extracts phone, parses date, schedules message
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { smartParseDate } from '@/lib/openai/parser'
import { extractPhoneFromVCard, generateJitter } from '@/lib/utils'
import { EvolutionWebhookPayload } from '@/types'

// Verify webhook token
const WEBHOOK_TOKEN = process.env.EVOLUTION_WEBHOOK_TOKEN

export async function POST(request: NextRequest) {
  try {
    // 1. Verify webhook token if configured
    const authHeader = request.headers.get('authorization')
    if (WEBHOOK_TOKEN && authHeader !== `Bearer ${WEBHOOK_TOKEN}`) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // 2. Parse webhook payload
    const payload: EvolutionWebhookPayload = await request.json()

    // 3. Only process message upserts
    if (payload.event !== 'MESSAGES_UPSERT') {
      return NextResponse.json({ success: true, message: 'Event ignored' })
    }

    // 4. Extract message data
    const messageData = payload.data
    const message = messageData.message
    
    if (!message) {
      return NextResponse.json({ success: true, message: 'No message data' })
    }

    // Get text content (direct or from quoted message for Note to Self pattern)
    let textContent = message.conversation || ''
    const extendedText = message.extendedTextMessage
    
    if (extendedText) {
      textContent = extendedText.text || ''
      
      // Check for quoted message (vCard attachment pattern)
      const quotedMessage = extendedText.contextInfo?.quotedMessage
      if (quotedMessage?.conversation) {
        // This might be a vCard - process it
        await processPotentialVCard(
          payload.instance,
          textContent, // The caption
          quotedMessage.conversation, // The potential vCard
          messageData.remoteJid || '',
          messageData.pushName || ''
        )
      }
    }

    // 5. Also check for direct vCard messages
    if (textContent.includes('BEGIN:VCARD')) {
      // Direct vCard share - needs a caption from previous/next message
      // This would require more complex state management
      // For now, we focus on the Note to Self pattern
    }

    return NextResponse.json({ success: true, message: 'Processed' })

  } catch (error) {
    console.error('Webhook processing error:', error)
    return NextResponse.json(
      { success: false, error: 'Processing failed' },
      { status: 500 }
    )
  }
}

/**
 * Process a potential vCard with caption
 */
async function processPotentialVCard(
  instanceName: string,
  caption: string,
  potentialVCard: string,
  senderJid: string,
  senderName: string
) {
  const supabase = createServiceClient()

  // 1. Verify this is a valid vCard
  if (!potentialVCard.includes('BEGIN:VCARD') || !potentialVCard.includes('END:VCARD')) {
    console.log('Not a valid vCard')
    return
  }

  // 2. Find the user by instance name
  const { data: instance, error: instanceError } = await supabase
    .from('whatsapp_instances')
    .select('user_id, id')
    .eq('instance_name', instanceName)
    .single()

  if (instanceError || !instance) {
    console.error('Instance not found:', instanceError)
    return
  }

  // 3. Extract phone number from vCard
  const phoneNumber = extractPhoneFromVCard(potentialVCard)
  if (!phoneNumber) {
    console.error('Could not extract phone number from vCard')
    await logMessageAction(supabase, null, instance.user_id, 'failed', {
      error: 'Could not extract phone number from vCard',
      vcard: potentialVCard.slice(0, 100),
    })
    return
  }

  // 4. Extract display name from vCard
  const displayNameMatch = potentialVCard.match(/FN[:;]([^\n\r]+)/i)
  const recipientName = displayNameMatch ? displayNameMatch[1].trim() : 'Unknown'

  // 5. Parse date from caption using OpenAI
  let parsedDate
  try {
    parsedDate = await smartParseDate(caption)
  } catch (parseError) {
    console.error('Date parsing error:', parseError)
    // Default to 1 hour from now
    parsedDate = {
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
      messageText: caption,
      confidence: 0.5,
      timezone: 'UTC',
    }
  }

  // 6. Add jitter to prevent exact-minute spikes
  const jitterMinutes = generateJitter()
  const scheduledAt = new Date(parsedDate.scheduledAt.getTime() + jitterMinutes * 60 * 1000)

  // 7. Save scheduled message
  const { data: scheduledMessage, error: insertError } = await supabase
    .from('scheduled_messages')
    .insert({
      user_id: instance.user_id,
      instance_id: instance.id,
      recipient_number: phoneNumber,
      recipient_name: recipientName,
      source_vcard: potentialVCard,
      caption: caption,
      parsed_message: parsedDate.messageText,
      scheduled_at: scheduledAt.toISOString(),
      timezone: parsedDate.timezone,
      jitter_minutes: jitterMinutes,
      status: 'pending',
    })
    .select()
    .single()

  if (insertError) {
    console.error('Failed to save message:', insertError)
    await logMessageAction(supabase, null, instance.user_id, 'failed', {
      error: insertError.message,
      caption,
      phoneNumber,
    })
    return
  }

  // 8. Log successful creation
  await logMessageAction(supabase, scheduledMessage.id, instance.user_id, 'created', {
    caption,
    recipientName,
    phoneNumber,
    scheduledAt: scheduledAt.toISOString(),
    confidence: parsedDate.confidence,
  })

  // 9. Send confirmation back to user (Note to Self)
  try {
    const { evolutionClient } = await import('@/lib/evolution/client')
    const confirmationMessage = `✅ Scheduled message to ${recipientName} for ${scheduledAt.toLocaleString()}`
    await evolutionClient.sendNoteToSelf(instanceName, confirmationMessage)
  } catch (confirmError) {
    console.error('Failed to send confirmation:', confirmError)
  }

  console.log('Message scheduled successfully:', scheduledMessage.id)
}

/**
 * Log message action
 */
async function logMessageAction(
  supabase: ReturnType<typeof createServiceClient>,
  messageId: string | null,
  userId: string,
  logType: string,
  details: Record<string, unknown>
) {
  try {
    await supabase.from('message_logs').insert({
      message_id: messageId,
      user_id: userId,
      log_type: logType,
      details,
    })
  } catch (error) {
    console.error('Failed to log action:', error)
  }
}

/**
 * GET /api/webhook
 * Webhook verification endpoint
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const token = searchParams.get('token')

  if (WEBHOOK_TOKEN && token !== WEBHOOK_TOKEN) {
    return NextResponse.json({ success: false }, { status: 401 })
  }

  return NextResponse.json({ 
    success: true, 
    message: 'Webhook endpoint active',
    timestamp: new Date().toISOString(),
  })
}
