// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) throw new Error('Missing Supabase credentials')
    return createClient(url, key)
}

export async function GET(request: NextRequest) {
    try {
          const supabase = getSupabase()
          const { searchParams } = new URL(request.url)
          const phone = searchParams.get('phone')

      if (phone) {
              const { data: user } = await supabase
                .from('user_instances')
                .select('id, trial_ends_at, subscription_status')
                .eq('phone_number', phone)
                .single()

            if (user) {
                      const isActive = user.subscription_status === 'active' ||
                                  (user.subscription_status === 'trial' && new Date(user.trial_ends_at) > new Date())

                if (!isActive) {
                            return NextResponse.json({
                                          error: 'Subscription expired',
                                          trial_ended: true,
                                          subscription_status: user.subscription_status,
                                          trial_ends_at: user.trial_ends_at,
                            }, { status: 403 })
                }
            }

            const { data, error } = await supabase
                .from('scheduled_messages')
                .select('*')
                .eq('instance_phone', phone)
                .order('scheduled_at', { ascending: false })

            if (error) {
                      return NextResponse.json({ error: error.message }, { status: 500 })
            }

            return NextResponse.json({
                      messages: data || [],
                      subscription_status: user?.subscription_status || 'unknown',
                      trial_ends_at: user?.trial_ends_at || null,
            })
      }

      const { data, error } = await supabase
            .from('scheduled_messages')
            .select('*')
            .order('scheduled_at', { ascending: true })

      if (error) {
              return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json(data || [])
    } catch (err: any) {
          return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
    }
}

export async function DELETE(request: NextRequest) {
    try {
          const body = await request.json()
          const { id, phone } = body

      if (!id) {
              return NextResponse.json({ error: 'Missing id' }, { status: 400 })
      }

      const supabase = getSupabase()

      if (phone) {
              const { data: msg } = await supabase
                .from('scheduled_messages')
                .select('instance_phone')
                .eq('id', id)
                .single()

            if (msg && msg.instance_phone && msg.instance_phone !== phone) {
                      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
            }
      }

      const { error } = await supabase
            .from('scheduled_messages')
            .delete()
            .eq('id', id)

      if (error) {
              return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    } catch (err: any) {
          return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
    }
}

export async function PATCH(request: NextRequest) {
    try {
          const body = await request.json()
          const { id, status, phone } = body

      if (!id || !status) {
              return NextResponse.json({ error: 'Missing id or status' }, { status: 400 })
      }

      const supabase = getSupabase()

      if (phone) {
              const { data: msg } = await supabase
                .from('scheduled_messages')
                .select('instance_phone')
                .eq('id', id)
                .single()

            if (msg && msg.instance_phone && msg.instance_phone !== phone) {
                      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
            }
      }

      const { data, error } = await supabase
            .from('scheduled_messages')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single()

      if (error) {
              return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json(data)
    } catch (err: any) {
          return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
    }
}
