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

export async function POST(request: Request) {
    try {
          const body = await request.json();
          const { action, phoneNumber, instanceName } = body;

      if (action === 'getCode') {
              const name = phoneNumber ? `SchedWhats-${phoneNumber}` : (instanceName || 'SchedWhats-Primary');
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
                        const data = await evoFetch('/instance/create', {
                                    method: 'POST',
                                    body: JSON.stringify({
                                                  instanceName: name,
                                                  qrcode: true,
                                                  integration: 'WHATSAPP-BAILEYS',
                                                  token: '',
                                                  number: '',
                                    }),
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

      // ═══ ISSUE #1 FIX: getPhone with retry-aware logic ═══
      if (action === 'getPhone') {
              const name = instanceName || 'SchedWhats-Primary';
              const attempt = body.attempt || 1;

            try {
                      // Step 1: confirm connection is open
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

                // Step 2: fetch owner from instances list
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

                // Upsert user in DB (ignoreDuplicates to not overwrite existing trial)
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

                // Auto-configure webhook for this instance
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

      if (action === 'create') {
              const name = instanceName || `schedwhats_${Date.now()}`;
              const data = await evoFetch('/instance/create', {
                        method: 'POST',
                        body: JSON.stringify({
                                    instanceName: name,
                                    qrcode: true,
                                    integration: 'WHATSAPP-BAILEYS',
                                    token: '',
                                    number: '',
                        }),
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

      if (action === 'disconnect') {
              const name = instanceName || 'SchedWhats-Primary';
              await evoFetch(`/instance/logout/${name}`, { method: 'DELETE' });
              return NextResponse.json({
                        success: true,
                        data: { instanceName: name, status: 'disconnected' },
              });
      }

      // Legacy
      const name = `schedwhats_${Date.now()}`;
          const data = await evoFetch('/instance/create', {
                  method: 'POST',
                  body: JSON.stringify({
                            instanceName: name,
                            qrcode: true,
                            integration: 'WHATSAPP-BAILEYS',
                            number: phoneNumber || '',
                  }),
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
