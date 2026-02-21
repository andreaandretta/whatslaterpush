// @ts-nocheck
import { NextResponse } from 'next/server';

const EVO_URL = process.env.EVOLUTION_API_URL || '';
const EVO_KEY = process.env.EVOLUTION_API_KEY || '';

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

        // ── P1: getCode con istanza dinamica per multi-utente ──────────────────
        if (action === 'getCode') {
                  // Se viene passato un phoneNumber, usa istanza dedicata SchedWhats-{phone}
                // Altrimenti fallback a instanceName passato o SchedWhats-Primary
                const name = phoneNumber
                    ? `SchedWhats-${phoneNumber}`
                            : (instanceName || 'SchedWhats-Primary');
                  try {
                              const data = await evoFetch(`/instance/connect/${name}`, {
                                            method: 'GET',
                              });
                              return NextResponse.json({
                                            success: true,
                                            data: {
                                                            instanceName: name,
                                                            qrCode: data?.base64 || data?.qrcode?.base64 || data?.qrcode || null,
                                                            pairingCode: data?.pairingCode || data?.code || null,
                                                            status: 'connecting',
                                            },
                              });
                  } catch (err) {
                              // Istanza non esiste: creala
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
                                                            qrCode: data?.qrcode?.base64 || data?.qrcode || null,
                                                            pairingCode: data?.pairingCode || null,
                                                            status: 'created',
                                            },
                              });
                  }
        }

        // ── P2: getPhone — recupera il numero connesso all'istanza ─────────────
        if (action === 'getPhone') {
                  const name = instanceName || 'SchedWhats-Primary';
                  try {
                              const instances = await evoFetch('/instance/fetchInstances', { method: 'GET' });
                              const list = Array.isArray(instances) ? instances : (instances?.data || []);
                              const inst = list.find((i: any) =>
                                            (i?.instance?.instanceName || i?.instanceName) === name
                                                             );
                              // owner format: "393xxxxxxxxx@s.whatsapp.net"
                    const owner = inst?.instance?.owner || inst?.owner || null;
                              const phone = owner ? owner.split('@')[0] : null;
                              console.log('getPhone', name, '->', phone);
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
                  const data = await evoFetch(`/instance/connectionState/${name}`, {
                              method: 'GET',
                  });
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

        // Legacy support
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
