// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
    try {
          const supabase = createServiceClient()
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
          const { id } = await request.json()
          if (!id) {
                  return NextResponse.json({ error: 'Missing id' }, { status: 400 })
          }

      const supabase = createServiceClient()
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
          const { id, status } = await request.json()
          if (!id || !status) {
                  return NextResponse.json({ error: 'Missing id or status' }, { status: 400 })
          }

      const supabase = createServiceClient()
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
