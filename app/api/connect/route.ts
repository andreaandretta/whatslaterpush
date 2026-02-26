// @ts-nocheck
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const EVO_URL = process.env.EVOLUTION_API_URL || '';
const EVO_KEY = process.env.EVOLUTION_API_KEY || '';

const supabase = createClient(
          process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

// ══ evoFetch: handles non-ok responses gracefully ══
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

// ══ evoFetchSafe: like evoFetch but returns null instead of throwing ══
async function evoFetchSafe(endpoint: string, options: RequestInit = {}) {
          try {
                      return await evoFetch(endpoint, options);
          } catch (_) {
                      return null;
          }
}

// ══ forceDeleteInstance: logout + delete to ensure clean state ══
async function forceDeleteInstance(name: string): Promise<void> {
          // Try logout first (graceful disconnect)
  await evoFetchSafe(`/instance/logout/${name}`, { method: 'DELETE' });
          await new Promise(r => setTimeout(r, 500));
          // Then delete the instance completely
  await evoFetchSafe(`/instance/delete/${name}`, { method: 'DELETE' });
          await new Promise(r => setTimeout(r, 800));
}

// ══ buildCreateBody: safe body for /instance/create ══
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
          return body;
}

// ══ getOwnerPhone: fetch current owner of an instance ══
async function getOwnerPhone(name: string): Promise<string | null> {
          try {
                      const instances = await evoFetch('/instance/fetchInstances', { method: 'GET' });
                      const list = Array.isArray(instances) ? instances : (instances?.data || []);
                      const inst = list.find((i: any) =>
                                    (i?.instance?.instanceName || i?.instanceName) === name
                                                 );
                      const owner = inst?.instance?.owner || inst?.owner || null;
                      return owner ? owner.split('@')[0] : null;
          } catch (_) {
                      return null;
          }
}

export async function POST(request: Request) {
          try {
                      const body = await request.json();
                      const { action, phoneNumber, instanceName } = body;

            // ══ getCode: QR flow — force delete first to prevent ghost-connected state ══
            if (action === 'getCode') {
                          const name = instanceName || 'SchedWhats-Primary';

                        // BUG1 FIX: Always force-delete existing instance before generating new QR
                        // This prevents old open sessions from auto-connecting without real scan
                        await forceDeleteInstance(name);

                        // Create fresh instance (no phone number = QR only)
                        const data = await evoFetch('/instance/create', {
                                        method: 'POST',
                                        body: JSON.stringify(buildCreateBody(name)),
                        });

                        // Wait a moment then fetch QR via connect endpoint
                        await new Promise(r => setTimeout(r, 1500));
                          let qrCode = data?.qrcode?.base64 || data?.qrcode || null;
                          try {
                                          const connectData = await evoFetch(`/instance/connect/${name}`, { method: 'GET' });
                                          qrCode = connectData?.base64 || connectData?.qrcode?.base64 || qrCode;
                          } catch (_) {}

                        return NextResponse.json({
                                        success: true,
                                        data: {
                                                          instanceName: name,
                                                          phoneNumber: phoneNumber || null,
                                                          qrCode,
                                                          pairingCode: null,
                                                          status: 'created',
                                        },
                        });
            }

            // ══ getPairingCode: pairing flow — force delete + retry on 403 ══
            if (action === 'getPairingCode') {
                          // BUG4 FIX: Robust number cleaning — strip ALL non-digits including +, spaces, dashes
                        const cleanNumber = (phoneNumber || '').replace(/\D/g, '');

                        if (!cleanNumber || cleanNumber.length < 10 || cleanNumber.length > 15) {
                                        return NextResponse.json(
                                                {
                                                                    success: false,
                                                                    error: `Numero non valido. Usa formato internazionale senza simboli (es: 393442582226). Solo cifre, da 10 a 15.`,
                                                },
                                                { status: 400 }
                                                        );
                        }

                        const name = `SchedWhats-${cleanNumber}`;

                        // BUG2 FIX: Force delete existing instance BEFORE creating, handles "name already in use" 403
                        await forceDeleteInstance(name);

                        // Create instance WITH number → Evolution calls requestPairingCode()
                        let data: any = null;
                          let createError: string | null = null;

                        try {
                                        data = await evoFetch('/instance/create', {
                                                          method: 'POST',
                                                          body: JSON.stringify(buildCreateBody(name, cleanNumber)),
                                        });
                        } catch (err: any) {
                                        createError = err.message || '';
                                        // BUG2 FIX: If 403 "already in use", retry with harder delete
                            if (createError.includes('403') || createError.toLowerCase().includes('already in use')) {
                                              console.log('getPairingCode: 403 on create, retrying with harder delete for', name);
                                              // Harder delete: try both logout and delete endpoints
                                          await evoFetchSafe(`/instance/logout/${name}`, { method: 'DELETE' });
                                              await new Promise(r => setTimeout(r, 1000));
                                              await evoFetchSafe(`/instance/delete/${name}`, { method: 'DELETE' });
                                              await new Promise(r => setTimeout(r, 1500));
                                              // Final retry
                                          try {
                                                              data = await evoFetch('/instance/create', {
                                                                                    method: 'POST',
                                                                                    body: JSON.stringify(buildCreateBody(name, cleanNumber)),
                                                              });
                                                              createError = null;
                                          } catch (retryErr: any) {
                                                              createError = retryErr.message || 'Unknown error on retry';
                                          }
                            }
                        }

                        if (createError) {
                                        return NextResponse.json({ success: false, error: createError }, { status: 500 });
                        }

                        const pCode = data?.qrcode?.pairingCode || data?.pairingCode || null;

                        // If no pairing code in create response, wait and try connect endpoint
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

            // ══ getPhone: detect phone after QR/pairing — BUG1 FIX: verify owner != null ══
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

                            // BUG1 FIX: Even if state=open, verify owner is set (real scan happened)
                            const phone = await getOwnerPhone(name);
                                          console.log('getPhone attempt', attempt, name, '->', phone, 'state:', state);

                            if (!phone) {
                                              // state is open but no owner => ghost connection (old session), NOT a real scan
                                            return NextResponse.json({
                                                                success: false,
                                                                phone: null,
                                                                reason: 'owner_not_ready',
                                                                retry: attempt < 8,
                                            });
                            }

                            // Valid connection: upsert user
                            const { error: upsertErr } = await supabase
                                            .from('user_instances')
                                            .upsert(
                                                    {
                                                                          phone_number: phone,
                                                                          instance_name: name,
                                                                          subscription_status: 'trial',
                                                                          trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                                                    },
                                                    { onConflict: 'phone_number', ignoreDuplicates: true }
                                                              );
                                          if (upsertErr) {
                                                            console.error('getPhone upsert err:', upsertErr.message);
                                          } else {
                                                            console.log('getPhone: user confirmed for', phone);
                                          }

                            // BUG3 FIX: Set webhook after successful connection
                            try {
                                              const webhookUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
                                              if (webhookUrl) {
                                                                  const whRes = await evoFetch(`/webhook/set/${name}`, {
                                                                                        method: 'POST',
                                                                                        body: JSON.stringify({
                                                                                                                url: `${webhookUrl}/api/webhook`,
                                                                                                                webhook_by_events: false,
                                                                                                                webhook_base64: false,
                                                                                                                events: ['MESSAGES_UPSERT'],
                                                                                                }),
                                                                  });
                                                                  console.log('getPhone: webhook set for', name, '->', JSON.stringify(whRes));
                                              } else {
                                                                  console.error('getPhone: NEXT_PUBLIC_APP_URL not set, webhook NOT configured!');
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

            // ══ checkConnected: BUG1 FIX — verify state=open AND owner is set ══
            if (action === 'status') {
                          const name = instanceName || 'SchedWhats-Primary';
                          try {
                                          const data = await evoFetch(`/instance/connectionState/${name}`, { method: 'GET' });
                                          const rawState = (data?.instance?.state || data?.state || 'unknown').toLowerCase();

                            // BUG1 FIX: If state is "open" but no owner, report as "connecting" not "open"
                            if (rawState === 'open') {
                                              const owner = await getOwnerPhone(name);
                                              if (!owner) {
                                                                  console.log('status: state=open but owner=null for', name, '=> returning connecting');
                                                                  return NextResponse.json({
                                                                                        success: true,
                                                                                        data: { instanceName: name, status: 'connecting' },
                                                                  });
                                              }
                            }

                            return NextResponse.json({
                                              success: true,
                                              data: { instanceName: name, status: rawState },
                            });
                          } catch (e: any) {
                                          return NextResponse.json({
                                                            success: true,
                                                            data: { instanceName: name, status: 'unknown' },
                                          });
                          }
            }

            // ══ create ══
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

            // ══ disconnect ══
            if (action === 'disconnect') {
                          const name = instanceName || 'SchedWhats-Primary';
                          await forceDeleteInstance(name);
                          return NextResponse.json({
                                          success: true,
                                          data: { instanceName: name, status: 'disconnected' },
                          });
            }

            // ══ Legacy fallback ══
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
