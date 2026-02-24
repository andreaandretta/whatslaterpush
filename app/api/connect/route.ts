// @ts-nocheck
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const EVO_URL = process.env.EVOLUTION_API_URL || '';
const EVO_KEY = process.env.EVOLUTION_API_KEY || '';

const supabase = createClient(
        process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

async function evoFetch(endpoint: string, options: RequestInit = {}) {
        const url = `${EVO_URL}${endpoint}`;
        const res = await fetch(url, {
                    ...options,
                    headers: {
                                    'Content-Type': 'application/json',
                                    'apikey': EVO_KEY,
                                    ...(options.headers || {}),
                    },
        });
        if (!res.ok) {
                    const text = await res.text();
                    throw new Error(`Evolution API ${res.status}: ${text}`);
        }
        const ct = res.headers.get('content-type');
        if (ct && ct.includes('application/json')) {
                    return res.json();
        }
        return {};
}

// ═══ HELPER: build body for /instance/create ═══
// If phoneNumber is valid (10+ digits), include it so Evolution generates pairingCode.
// If empty/missing, OMIT the number field entirely (empty string "" causes 400).
function buildCreateBody(instanceName: string, phoneNumber?: string | null) {
        const cleanNum = phoneNumber ? phoneNumber.replace(/\D/g, '') : '';
        const body: Record<string, any> = {
                    instanceName,
                    qrcode: true,
                    integration: 'WHATSAPP-BAILEYS',
                    token: '',
        };
        if (cleanNum && cleanNum.length >= 10) {
                    body.number = cleanNum;
        }
        // If no valid number, do NOT include 'number' key at all
    return body;
}

export async function POST(request: Request) {
        try {
                    const body = await request.json();
                    const { action, phoneNumber, instanceName } = body;

            // ═══ getCode: QR code flow (no phone number needed) ═══
            if (action === 'getCode') {
                            const name = instanceName || 'SchedWhats-Primary';

                        try {
                                            const data = await evoFetch(`/instance/connect/${name}`, { method: 'GET' });
                                            return NextResponse.json({
                                                                    success: true,
                                                                    data: {
                                                                                                instanceName: name,
                                                                                                phoneNumber: phoneNumber || null,
                                                                                                qrCode: data?.base64 || data?.qrcode?.base64 || data?.qrcode || null,
                                                                                                pairingCode: data?.pairingCode || data?.code || null,
                                                                                                status: 'connecting',
                                                                    },
                                            });
                        } catch (err) {
                                            // Instance doesn't exist yet — create it (NO number field)
                                const data = await evoFetch('/instance/create', {
                                                        method: 'POST',
                                                        body: JSON.stringify(buildCreateBody(name)),
                                });

                                return NextResponse.json({
                                                        success: true,
                                                        data: {
                                                                                    instanceName: name,
                                                                                    phoneNumber: phoneNumber || null,
                                                                                    qrCode: data?.qrcode?.base64 || data?.qrcode || null,
                                                                                    pairingCode: data?.pairingCode || null,
                                                                                    status: 'created',
                                                        },
                                });
                        }
            }

            // ═══ getPairingCode: pairing code flow (phone number REQUIRED) ═══
            if (action === 'getPairingCode') {
                            const cleanNumber = (phoneNumber || '').replace(/\D/g, '');
                            if (!cleanNumber || cleanNumber.length < 10) {
                                                return NextResponse.json(
                                                    { success: false, error: 'Numero di telefono non valido. Usa formato internazionale senza + (es: 393401234567)' },
                                                    { status: 400 }
                                                                    );
                            }

                        const name = instanceName || `SchedWhats-${cleanNumber}`;

                        // Delete existing instance to force fresh pairing
                        try {
                                            await evoFetch(`/instance/logout/${name}`, { method: 'DELETE' });
                        } catch (_) {
                                            // Ignore — instance may not exist
                        }

                        // Small delay after logout
                        await new Promise(r => setTimeout(r, 1000));

                        // Create instance WITH number → Evolution calls requestPairingCode()
                        const data = await evoFetch('/instance/create', {
                                            method: 'POST',
                                            body: JSON.stringify(buildCreateBody(name, cleanNumber)),
                        });

                        const pCode = data?.qrcode?.pairingCode || data?.pairingCode || null;

                        // If no pairing code in create response, try connect endpoint
                        if (!pCode) {
                                            await new Promise(r => setTimeout(r, 2000));
                                            try {
                                                                    const connectData = await evoFetch(`/instance/connect/${name}`, { method: 'GET' });
                                                                    return NextResponse.json({
                                                                                                success: true,
                                                                                                data: {
                                                                                                                                instanceName: name,
                                                                                                                                phoneNumber: cleanNumber,
                                                                                                                                pairingCode: connectData?.pairingCode || connectData?.qrcode?.pairingCode || null,
                                                                                                                                qrCode: connectData?.base64 || connectData?.qrcode?.base64 || null,
                                                                                                                                status: 'pairing',
                                                                                                    },
                                                                    });
                                            } catch (connectErr) {
                                                                    return NextResponse.json({
                                                                                                success: true,
                                                                                                data: {
                                                                                                                                instanceName: name,
                                                                                                                                phoneNumber: cleanNumber,
                                                                                                                                pairingCode: null,
                                                                                                                                status: 'created_no_pairing',
                                                                                                    },
                                                                    });
                                            }
                        }

                        return NextResponse.json({
                                            success: true,
                                            data: {
                                                                    instanceName: name,
                                                                    phoneNumber: cleanNumber,
                                                                    pairingCode: pCode,
                                                                    qrCode: data?.qrcode?.base64 || null,
                                                                    status: 'pairing',
                                            },
                        });
            }

            // ═══ getPhone: detect phone after QR/pairing connection ═══
            if (action === 'getPhone') {
                            const name = instanceName || 'SchedWhats-Primary';
                            const attempt = body.attempt || 1;

                        try {
                                            const stateRes = await evoFetch(`/instance/connectionState/${name}`, { method: 'GET' });
                                            const state = (stateRes?.instance?.state || stateRes?.state || '').toLowerCase();

                                if (state !== 'open') {
                                                        return NextResponse.json({
                                                                                    success: false,
                                                                                    phone: null,
                                                                                    reason: 'not_open',
                                                                                    state,
                                                        });
                                }

                                const instances = await evoFetch('/instance/fetchInstances', { method: 'GET' });
                                            const list = Array.isArray(instances) ? instances : (instances?.data || []);
                                            const inst = list.find((i: any) =>
                                                                    (i?.instance?.instanceName || i?.instanceName) === name
                                                                                   );

                                const owner = inst?.instance?.owner || inst?.owner || null;
                                            const phone = owner ? owner.split('@')[0] : null;

                                console.log('getPhone attempt', attempt, name, '->', phone);

                                if (!phone) {
                                                        return NextResponse.json({
                                                                                    success: false,
                                                                                    phone: null,
                                                                                    reason: 'owner_not_ready',
                                                                                    retry: attempt < 6,
                                                            });
                                }

                                const { error: upsertErr } = await supabase
                                                .from('user_instances')
                                                .upsert({
                                                                            phone_number: phone,
                                                                            instance_name: name,
                                                                            subscription_status: 'trial',
                                                                            trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                                                }, {
                                                                            onConflict: 'phone_number',
                                                                            ignoreDuplicates: true,
                                                });

                                if (upsertErr) {
                                                        console.error('getPhone upsert err:', upsertErr.message);
                                } else {
                                                        console.log('getPhone: user confirmed for', phone);
                                }

                                try {
                                                        const webhookUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
                                                        if (webhookUrl) {
                                                                                    await evoFetch(`/webhook/set/${name}`, {
                                                                                                                    method: 'POST',
                                                                                                                    body: JSON.stringify({
                                                                                                                                                        url: `${webhookUrl}/api/webhook`,
                                                                                                                                                        webhook_by_events: false,
                                                                                                                                                        webhook_base64: false,
                                                                                                                                                        events: ['MESSAGES_UPSERT'],
                                                                                                                        }),
                                                                                        });
                                                                                    console.log('getPhone: webhook set for', name);
                                                        }
                                } catch (whErr: any) {
                                                        console.error('webhook set err (non-fatal):', whErr.message);
                                }

                                return NextResponse.json({ success: true, phone });
                        } catch (e: any) {
                                            console.error('getPhone err:', e.message);
                                            return NextResponse.json({ success: false, phone: null, error: e.message });
                        }
            }

            // ═══ create: create instance (no phone number) ═══
            if (action === 'create') {
                            const name = instanceName || `schedwhats_${Date.now()}`;
                            const data = await evoFetch('/instance/create', {
                                                method: 'POST',
                                                body: JSON.stringify(buildCreateBody(name)),
                            });

                        return NextResponse.json({
                                            success: true,
                                            data: {
                                                                    instanceName: name,
                                                                    instanceId: data?.instance?.instanceId || data?.instanceId || name,
                                                                    status: 'created',
                                                                    qrCode: data?.qrcode?.base64 || data?.qrcode || null,
                                                                    pairingCode: data?.pairingCode || null,
                                            },
                        });
            }

            // ═══ status ═══
            if (action === 'status') {
                            const name = instanceName || 'SchedWhats-Primary';
                            const data = await evoFetch(`/instance/connectionState/${name}`, { method: 'GET' });
                            return NextResponse.json({
                                                success: true,
                                                data: {
                                                                        instanceName: name,
                                                                        status: data?.instance?.state || data?.state || 'unknown',
                                                },
                            });
            }

            // ═══ disconnect ═══
            if (action === 'disconnect') {
                            const name = instanceName || 'SchedWhats-Primary';
                            await evoFetch(`/instance/logout/${name}`, { method: 'DELETE' });
                            return NextResponse.json({
                                                success: true,
                                                data: { instanceName: name, status: 'disconnected' },
                            });
            }

            // ═══ Legacy fallback ═══
            const name = `schedwhats_${Date.now()}`;
                    const data = await evoFetch('/instance/create', {
                                    method: 'POST',
                                    body: JSON.stringify(buildCreateBody(name, phoneNumber)),
                    });

            return NextResponse.json({
                            success: true,
                            data: {
                                                instanceName: name,
                                                qrCode: data?.qrcode?.base64 || data?.qrcode || null,
                                                status: 'created',
                            },
            });

        } catch (error) {
                    console.error('Connect API Error:', error);
                    return NextResponse.json(
                        { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
                        { status: 500 }
                                );
        }
}

export async function GET() {
        try {
                    const data = await evoFetch('/instance/fetchInstances', { method: 'GET' });
                    return NextResponse.json({ success: true, data });
        } catch (error) {
                    return NextResponse.json(
                        { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
                        { status: 500 }
                                );
        }
}
