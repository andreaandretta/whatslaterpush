import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeItalianPhone } from '../../lib/phone'
import { getPlanLimits } from '../../lib/plans'

export const dynamic = 'force-dynamic';

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing Supabase credentials')
  return createClient(url, key)
}

export async function GET(req: NextRequest) {
                const supabase = getSupabase()
                const { searchParams } = new URL(req.url)
                const phone = searchParams.get('phone')

        if (phone) {
                                const normalizedPhone = normalizeItalianPhone(phone);
                                // Verify that this phone has an active instance (basic auth check)
                                const { data: user } = await supabase
                                        .from('user_instances')
                                        .select('id, trial_ends_at, subscription_plan, connection_status')
                                        .eq('phone_number', normalizedPhone)
                                        .single()

                                if (!user) {
                                        return NextResponse.json({ error: 'User not found' }, { status: 404 })
                                }
                        const planLimits = getPlanLimits(user.subscription_plan || 'free')
                        const historyStart = new Date(Date.now() - planLimits.historyDays * 24 * 60 * 60 * 1000).toISOString()

                        const { data, error } = await supabase
                                        .from('scheduled_messages')
                                        .select('*')
                                        .eq('instance_phone', normalizedPhone)
                                        .gte('created_at', historyStart)
                                        .order('scheduled_at', { ascending: false })

                        if (error) {
                                                        return NextResponse.json({ error: error.message }, { status: 500 })
                        }

                        return NextResponse.json({
                                                        messages: data || [],
                                                        subscription_plan: user?.subscription_plan || 'unknown',
                                                        trial_ends_at: user?.trial_ends_at || null,
                        })
        }

        return NextResponse.json({ error: 'phone parameter required' }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
                const supabase = getSupabase()
                const body = await req.json()
                const { id, phone } = body

        if (!id || !phone) {
                                return NextResponse.json({ error: 'id and phone required' }, { status: 400 })
        }

        // Verify ownership: message must belong to this phone
        const normalizedPhone = normalizeItalianPhone(phone);
        const { data: msg } = await supabase
                        .from('scheduled_messages')
                        .select('id, instance_phone')
                        .eq('id', id)
                        .eq('instance_phone', normalizedPhone)
                        .single()

        if (!msg) {
                                return NextResponse.json({ error: 'Message not found or not owned by this phone' }, { status: 403 })
        }

        const { error } = await supabase
                        .from('scheduled_messages')
                        .update({ status: 'cancelled' })
                        .eq('id', id)
                        .eq('instance_phone', normalizedPhone)

        if (error) {
                                return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true })
}
