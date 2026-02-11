/**
 * OpenAI Date Parser
 * Extracts date/time from natural language using GPT
 */

import OpenAI from 'openai'
import { ParsedDateResult } from '@/types'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const SYSTEM_PROMPT = `You are a date/time parser for a WhatsApp message scheduler.
Extract the scheduled date/time and the clean message text from user captions.

Rules:
1. Parse natural language dates like "tomorrow at 9", "next Monday", "in 2 hours", "Friday 3pm"
2. Return the result in strict JSON format
3. Use ISO 8601 format for dates
4. Set confidence: 0-1 based on parsing certainty
5. If no date found, use "ASAP" (within 5 minutes)
6. Preserve the original timezone context
7. Remove date references from the message text

Response format:
{
  "scheduledAt": "2024-01-15T09:00:00Z",
  "messageText": "clean message without date references",
  "confidence": 0.95,
  "timezone": "America/Sao_Paulo"
}`

/**
 * Parse natural language date from caption
 */
export async function parseDateFromCaption(
  caption: string,
  userTimezone: string = 'UTC'
): Promise<ParsedDateResult> {
  const now = new Date().toISOString()

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Current time: ${now}\nUser timezone: ${userTimezone}\nCaption: "${caption}"\n\nParse this into JSON:`,
      },
    ],
    temperature: 0.1,
    max_tokens: 300,
    response_format: { type: 'json_object' },
  })

  const content = response.choices[0].message.content
  if (!content) {
    throw new Error('No response from OpenAI')
  }

  const parsed = JSON.parse(content)

  // Handle ASAP case
  if (parsed.scheduledAt === 'ASAP' || !parsed.scheduledAt) {
    const asapDate = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes from now
    parsed.scheduledAt = asapDate.toISOString()
  }

  return {
    scheduledAt: new Date(parsed.scheduledAt),
    messageText: parsed.messageText || caption,
    confidence: parsed.confidence || 0.8,
    timezone: parsed.timezone || userTimezone,
  }
}

/**
 * Quick parser for common patterns (fallback when OpenAI is slow/unavailable)
 */
export function quickDateParse(
  caption: string,
  userTimezone: string = 'UTC'
): ParsedDateResult | null {
  const now = new Date()
  const lowerCaption = caption.toLowerCase()
  let scheduledAt = new Date()
  let messageText = caption
  let matched = false

  // "Tomorrow at X"
  const tomorrowMatch = lowerCaption.match(/tomorrow(?:\s+at)?\s*(\d+)(?::(\d+))?\s*(am|pm)?/i)
  if (tomorrowMatch) {
    scheduledAt.setDate(scheduledAt.getDate() + 1)
    const hour = parseInt(tomorrowMatch[1])
    const minute = tomorrowMatch[2] ? parseInt(tomorrowMatch[2]) : 0
    const ampm = tomorrowMatch[3]
    
    let finalHour = hour
    if (ampm === 'pm' && hour !== 12) finalHour += 12
    if (ampm === 'am' && hour === 12) finalHour = 0
    
    scheduledAt.setHours(finalHour, minute, 0, 0)
    messageText = caption.replace(tomorrowMatch[0], '').trim()
    matched = true
  }

  // "In X minutes/hours"
  const inMatch = lowerCaption.match(/in\s+(\d+)\s+(minute|hour|min|hr)s?/i)
  if (inMatch && !matched) {
    const amount = parseInt(inMatch[1])
    const unit = inMatch[2].startsWith('hour') || inMatch[2].startsWith('hr') ? 'hours' : 'minutes'
    
    if (unit === 'hours') {
      scheduledAt.setHours(scheduledAt.getHours() + amount)
    } else {
      scheduledAt.setMinutes(scheduledAt.getMinutes() + amount)
    }
    messageText = caption.replace(inMatch[0], '').trim()
    matched = true
  }

  // "Today at X"
  const todayMatch = lowerCaption.match(/today(?:\s+at)?\s*(\d+)(?::(\d+))?\s*(am|pm)?/i)
  if (todayMatch && !matched) {
    const hour = parseInt(todayMatch[1])
    const minute = todayMatch[2] ? parseInt(todayMatch[2]) : 0
    const ampm = todayMatch[3]
    
    let finalHour = hour
    if (ampm === 'pm' && hour !== 12) finalHour += 12
    if (ampm === 'am' && hour === 12) finalHour = 0
    
    scheduledAt.setHours(finalHour, minute, 0, 0)
    messageText = caption.replace(todayMatch[0], '').trim()
    matched = true
  }

  if (!matched) return null

  return {
    scheduledAt,
    messageText: messageText || caption,
    confidence: 0.7,
    timezone: userTimezone,
  }
}

/**
 * Smart parser that tries quick parse first, then OpenAI
 */
export async function smartParseDate(
  caption: string,
  userTimezone: string = 'UTC'
): Promise<ParsedDateResult> {
  // Try quick parse first
  const quickResult = quickDateParse(caption, userTimezone)
  if (quickResult && quickResult.confidence > 0.8) {
    return quickResult
  }

  // Fall back to OpenAI
  try {
    const aiResult = await parseDateFromCaption(caption, userTimezone)
    return aiResult
  } catch (error) {
    // If OpenAI fails, use quick result or default to ASAP
    if (quickResult) return quickResult
    
    // Default: schedule for 5 minutes from now
    return {
      scheduledAt: new Date(Date.now() + 5 * 60 * 1000),
      messageText: caption,
      confidence: 0.5,
      timezone: userTimezone,
    }
  }
}
