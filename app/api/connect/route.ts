/**
 * POST /api/connect
 * Orchestrates WhatsApp connection via Evolution API
 */

import { NextRequest, NextResponse } from 'next/server'
import { orchestrateConnection } from '@/lib/evolution/client'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const connectSchema = z.object({
  phoneNumber: z.string().min(8).max(20).optional(),
  instanceName: z.string().min(3).max(50).optional(),
})

export async function POST(request: NextRequest) {
  try {
    // 1. Check system status
    const systemStatus = process.env.SYSTEM_STATUS
    if (systemStatus === 'maintenance') {
      return NextResponse.json(
        { success: false, error: 'System is under maintenance' },
        { status: 503 }
      )
    }

    // 2. Authenticate user
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // 3. Parse request body
    const body = await request.json()
    const result = connectSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', details: result.error.flatten() },
        { status: 400 }
      )
    }

    const { phoneNumber, instanceName: customInstanceName } = result.data

    // 4. Generate instance name if not provided
    const instanceName = customInstanceName || `schedwhats_${user.id.slice(0, 8)}_${Date.now()}`

    // 5. Orchestrate connection with Evolution API
    const connectionResult = await orchestrateConnection(instanceName, phoneNumber)

    // 6. Save instance to database
    const { data: instance, error: dbError } = await supabase
      .from('whatsapp_instances')
      .upsert({
        user_id: user.id,
        instance_name: instanceName,
        status: connectionResult.status === 'connecting' ? 'connecting' : 'awaiting_qr',
        pairing_code: connectionResult.pairingCode,
        qr_code: connectionResult.qrCode,
        phone_number: phoneNumber,
      }, {
        onConflict: 'user_id,instance_name',
      })
      .select()
      .single()

    if (dbError) {
      console.error('Database error:', dbError)
      return NextResponse.json(
        { success: false, error: 'Failed to save instance' },
        { status: 500 }
      )
    }

    // 7. Configure webhook for this instance
    try {
      const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook`
      const { evolutionClient } = await import('@/lib/evolution/client')
      await evolutionClient.setWebhook(instanceName, webhookUrl)
    } catch (webhookError) {
      console.error('Webhook setup error:', webhookError)
      // Non-critical, continue
    }

    // 8. Return success response
    return NextResponse.json({
      success: true,
      data: {
        instanceId: instance.id,
        instanceName: connectionResult.instanceName,
        pairingCode: connectionResult.pairingCode,
        qrCode: connectionResult.qrCode,
        status: connectionResult.status,
      },
    })

  } catch (error) {
    console.error('Connect API error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
