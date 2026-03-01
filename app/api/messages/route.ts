// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic';

function getSupabase() {
                // Supporta sia SUPABASE_URL (server-side) che NEXT_PUBLIC_SUPABASE_URL
        const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
                const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
                if (!url || !key) throw new Error('Missing Supabase credentials')
                return createClient(url, key)
}

// Invia notifica WhatsApp all'owner tramite Evolution API
async function notifyOwner(instanceName: string, phone: string, msg: string) {
                if (!phone || !instanceName || !process.env.EVOLUTION_API_URL) {
                                        console.log('notify skip: missing params', { instanceName, phone: !!phone, url: !!process.env.EVOLUTION_API_URL });
                                        return;
                }
                try {
                                        const r = await fetch(`${process.env.EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
                                                                        method: 'POST',
                                                                        headers: {
                                                                                                                'apikey': process.env.EVOLUTION_API_KEY!,
                                                                                                                'Content-Type': 'application/json'
                                                                                },
                                                                        body: JSON.stringify({ number: phone, text: msg })
                                        })
                                        console.log('notify result', instanceName, phone, r.status)
                } catch (e: any) {
                                        console.error('notify err:', e.message)
                }
}

// BUG1 FIX: normalizza numero IT - aggiunge 39 se manca
function normalizeItalianPhone(raw: string): string {
                const clean = raw.replace(/\D/g, '');
                if (clean.startsWith('39') && clean.length >= 11) return clean;
                if (clean.startsWith('0')) return '39' + clean;      // fisso: 081... -> 39081...
        if (clean.length === 10 && clean.startsWith('3')) return '39' + clean; // mobile: 344... -> 39344...
        return clean; // già normalizzato o numero estero
}

export async function GET(req: NextRequest) {
                const supabase = getSupabase()
                const { searchParams } = new URL(req.url)
                const phone = searchParams.get('phone')

        if (phone) {
                                const normalizedPhone = normalizeItalianPhone(phone);
                                const { data: user } = await supabase
                                        .from('user_instances')
                                        .select('id, trial_ends_at, subscription_status')
                                        .eq('phone_number', normalizedPhone)
                                        .single()

                        // BUG1 FIX: check trial DISABILITATO - tutti gli utenti hanno accesso illimitato
                        // if (user) {
                        //   const isActive = user.subscription_status === 'active' ||
                        //     (user.subscription_status === 'trial' && new Date(user.trial_ends_at) > new Date())
                        //   if (!isActive) {
                        //     return NextResponse.json({ error: 'Subscription expired', trial_ended: true, ... }, { status: 403 })
                        //   }
                        // }

                        // Leggi messaggi dell'utente (GET con phone specifico)
                        const { data, error } = await supabase
                                        .from('scheduled_messages')
                                        .select('*')
                                        .eq('instance_phone', normalizedPhone)
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
}

export async function DELETE(req: NextRequest) {
                const supabase = getSupabase()
                const body = await req.json()
                const { id, phone } = body

        if (!id) {
                                return NextResponse.json({ error: 'id required' }, { status: 400 })
        }

        const { error } = await supabase
                        .from('scheduled_messages')
                        .update({ status: 'cancelled' })
                        .eq('id', id)

        if (error) {
                                return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true })
}
