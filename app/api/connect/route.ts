// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const EVO_URL = process.env.EVOLUTION_API_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://whatslaterpush.vercel.app';

if (!EVO_URL || !EVO_KEY) {
  console.error('[connect] FATAL: EVOLUTION_API_URL or EVOLUTION_API_KEY not set');
}

function validatePhone(raw: string): string | null {
    const clean = raw.replace(/\D/g, '');
    if (clean.length < 10 || clean.length > 15) return null;
    // BUG3 FIX: normalize Italian numbers
  if (clean.startsWith('0')) return '39' + clean.substring(1);
  if (clean.startsWith('3') && !clean.startsWith('39')) return '39' + clean;
  return clean;
}

async function forceDeleteInstance(name: string): Promise<void> {
    console.log('[connect] forceDelete start:', name);
    try {
          await fetch(`${EVO_URL}/instance/logout/${name}`, {
                  method: 'DELETE',
                  headers: { apikey: EVO_KEY },
          });
    } catch (e) { console.log('[connect] logout error (ignored):', e); }
    await new Promise(r => setTimeout(r, 500));
    try {
          await fetch(`${EVO_URL}/instance/delete/${name}`, {
                  method: 'DELETE',
                  headers: { apikey: EVO_KEY },
          });
    } catch (e) { console.log('[connect] delete error (ignored):', e); }
    await new Promise(r => setTimeout(r, 500));
    // Wait extra time for Evolution API to fully clean up
  await new Promise(r => setTimeout(r, 1000));
  console.log('[connect] forceDelete done:', name);
}

async function getOwnerPhone(name: string): Promise<string | null> {
    try {
          const res = await fetch(`${EVO_URL}/instance/fetchInstances?instanceName=${name}`, {
                  headers: { apikey: EVO_KEY },
          });
          if (!res.ok) return null;
          const data = await res.json();
          console.log('[connect] fetchInstances raw:', JSON.stringify(data).substring(0, 500));
          const arr = Array.isArray(data) ? data : [data];
          const inst = arr.find((i: any) => i.instance?.instanceName === name || i.name === name);
          if (!inst) return null;
          const owner = inst.instance?.ownerJid || inst.ownerJid || inst.instance?.owner || inst.owner || null;
          if (!owner) return null;
          return owner.split('@')[0];
    } catch (e) {
          console.log('[connect] getOwnerPhone error:', e);
          return null;
    }
}

async function setWebhook(name: string): Promise<void> {
    const webhookUrl = `${APP_URL}/api/webhook`;
    console.log('[connect] setting webhook:', webhookUrl, 'for', name);
    try {
          const res = await fetch(`${EVO_URL}/webhook/set/${name}`, {
                  method: 'POST',
                  headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                            webhook: {
                                        url: webhookUrl,
                                        webhook_by_events: false,
                                        webhook_base64: false,
                                        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
                            }
                  }),
          });
          const data = await res.json();
          console.log('[connect] webhook set result:', JSON.stringify(data));
    } catch (e) { console.log('[connect] setWebhook error:', e); }
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { action } = body;
    console.log('[connect] action:', action, 'body:', JSON.stringify(body));

  // ── STATUS ────────────────────────────────────────────────────────────────
  if (action === 'status' || action === 'getStatus') {
        const { instanceName } = body;
        if (!instanceName) return NextResponse.json({ status: 'not_found' });
        try {
                const res = await fetch(`${EVO_URL}/instance/connectionState/${instanceName}`, {
                          headers: { apikey: EVO_KEY },
                });
                if (!res.ok) {
                          console.log('[connect] status fetch not ok:', res.status);
                          return NextResponse.json({ status: 'not_found' });
                }
                const data = await res.json();
                console.log('[connect] connectionState:', JSON.stringify(data));
                const state = data?.instance?.state || data?.instance?.connectionStatus || data?.state || data?.connectionStatus || 'close';
                if (state === 'open') {
                          const owner = await getOwnerPhone(instanceName);
                          console.log('[connect] owner check:', owner);
                          // Always persist open status to DB regardless of owner
                          const supa = getSupabase();
                          await supa.from('user_instances')
                            .update({ connection_status: 'open', last_connection_update: new Date().toISOString() })
                            .eq('instance_name', instanceName);
                          return NextResponse.json({ status: 'open', owner: owner || null });
                }
                if (state === 'connecting' || state === 'qr') return NextResponse.json({ status: 'connecting' });
                {
        const supa = getSupabase();
        await supa.from('user_instances')
          .update({ connection_status: 'close', last_connection_update: new Date().toISOString() })
          .eq('instance_name', instanceName);
        return NextResponse.json({ status: 'close' });
      }
        } catch (e) {
                console.log('[connect] status error:', e);
                return NextResponse.json({ status: 'not_found' });
        }
  }

  // ── GET CODE AND PAIRING (unified) ────────────────────────────────────────
  if (action === 'getCodeAndPairing') {
        const { phone } = body;
        const cleanPhone = validatePhone(phone || '');
  console.log('[connect] BUG3 - raw phone input:', phone, '| cleaned+normalized:', cleanPhone);
        if (!cleanPhone) {
                return NextResponse.json(
                  { error: 'Inserisci numero completo con prefisso internazionale (es: 393509898408)' },
                  { status: 400 }
                        );
        }
        const instanceName = `SchedWhats-${cleanPhone}`;

    // ═══ ROUTING FIX: Clean up duplicate user_instances ═══
    // Delete all rows with this instance_name but different phone_number
    // Then upsert the correct row
    try {
      const supa = getSupabase();
      // Delete stale rows: same instance_name but wrong phone
      await supa.from('user_instances')
        .delete()
        .eq('instance_name', instanceName)
        .neq('phone_number', cleanPhone);
      // Upsert the correct row (create or update)
      await supa.from('user_instances').upsert(
        {
          phone_number: cleanPhone,
          instance_name: instanceName,
          subscription_status: 'trial',
          trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        },
        { onConflict: 'phone_number' }
      );
      console.log('[connect] user_instances cleaned for', instanceName, cleanPhone);
    } catch (e: any) {
      console.error('[connect] user_instances cleanup error:', e.message);
    }
        console.log('[connect] getCodeAndPairing for:', instanceName);

      // Force delete any existing instance
      await forceDeleteInstance(instanceName);

      // BUG1 FIX: Create instance with qrcode:true AND number to get BOTH QR and pairingCode
      // Evolution v2 generates pairingCode only when number is provided at create time
      let createRes: any;
        try {
                const webhookCreateUrl = `${APP_URL}/api/webhook`;
                const createBody = {
                          instanceName,
                          number: cleanPhone,      // REQUIRED for pairing code generation
                          qrcode: true,            // BUG1 FIX: true to get QR from create response
                          integration: 'WHATSAPP-BAILEYS',
                          webhook: {
                                      url: webhookCreateUrl,
                                      webhook_by_events: false,
                                      webhook_base64: false,
                                      events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
                          },
                };
                console.log('[connect] creating instance:', JSON.stringify(createBody));
                const res = await fetch(`${EVO_URL}/instance/create`, {
                          method: 'POST',
                          headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
                          body: JSON.stringify(createBody),
                });
                createRes = await res.json();
                const logCreate = { ...createRes };
                if (logCreate.qrcode?.base64) logCreate.qrcode = { base64: '(QR_BASE64_OMITTED)', pairingCode: logCreate.qrcode.pairingCode };
                console.log('[connect] create result keys:', Object.keys(createRes).join(','));
                console.log('[connect] create result:', JSON.stringify(logCreate).substring(0, 1000));
        } catch (e) {
                console.log('[connect] create error:', e);
      console.error('[connect] FULL CREATE ERROR - phone:', cleanPhone, 'instanceName:', instanceName, 'error details:', JSON.stringify(e));
                return NextResponse.json({ error: 'Errore creazione istanza Evolution API' }, { status: 500 });
        }

      // Step 2: Set webhook immediately
      await setWebhook(instanceName);

      // BUG1 FIX: Extract QR and pairingCode from create response
      // Evolution v2 returns: { instance: {...}, qrcode: { base64: "...", pairingCode: "XXXX-YYYY" } }
      let qrCode: string | null =
              createRes?.qrcode?.base64 ||
              createRes?.qrCode?.base64 ||
              createRes?.base64 ||
              null;

      let pairingCode: string | null =
              createRes?.qrcode?.pairingCode ||    // Evolution v2.3+ main location
              createRes?.qrcode?.code ||
              createRes?.pairingCode ||
              createRes?.code ||
              null;

      console.log('[connect] from create: qrCode=' + (qrCode ? 'YES' : 'NULL') + ' pairingCode=' + (pairingCode || 'NULL'));

      // If no QR from create, call /instance/connect to get it
      if (!qrCode) {
              console.log('[connect] no QR from create, calling /instance/connect...');
              await new Promise(r => setTimeout(r, 1000));
              try {
                        const qrRes = await fetch(`${EVO_URL}/instance/connect/${instanceName}`, {
                                    method: 'GET',
                                    headers: { apikey: EVO_KEY },
                        });
                        const qrData = await qrRes.json();
                        const logQr = { ...qrData };
                        if (logQr.base64) logQr.base64 = '(QR_BASE64_OMITTED)';
                        console.log('[connect] connect/QR fallback:', JSON.stringify(logQr).substring(0, 500));
                        qrCode = qrData?.base64 || qrData?.qrcode?.base64 || null;
                        if (!pairingCode) {
                                    pairingCode = qrData?.pairingCode || qrData?.qrcode?.pairingCode || qrData?.code || null;
                        }
              } catch (e) { console.log('[connect] qr fallback error:', e); }
      }

      // If still no pairingCode, try POST /instance/connect with number (v2 pairing code endpoint)
      if (!pairingCode) {
              console.log('[connect] trying POST /instance/connect for pairing...');
              await new Promise(r => setTimeout(r, 1500));
              try {
                        const pairRes1 = await fetch(`${EVO_URL}/instance/connect/${instanceName}`, {
                                    method: 'POST',
                                    headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ number: cleanPhone }),
                        });
                        const pairData1 = await pairRes1.json();
                        const logP1 = { ...pairData1 };
                        if (logP1.base64) logP1.base64 = '(OMITTED)';
                        console.log('[connect] POST connect result:', JSON.stringify(logP1).substring(0, 500));
                        pairingCode = pairData1?.pairingCode || pairData1?.pairing_code || pairData1?.code || null;
              } catch (e) { console.log('[connect] POST connect error:', e); }
      }

      // If still no pairingCode, try /instance/pairingCode endpoint
      if (!pairingCode) {
              console.log('[connect] trying POST /instance/pairingCode...');
              try {
                        const pairRes2 = await fetch(`${EVO_URL}/instance/pairingCode/${instanceName}`, {
                                    method: 'POST',
                                    headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ number: cleanPhone }),
                        });
                        const statusCode = pairRes2.status;
                        const pairText = await pairRes2.text();
                        console.log('[connect] pairingCode endpoint status:', statusCode, 'body:', pairText.substring(0, 500));
                        try {
                                    const pairData2 = JSON.parse(pairText);
                                    pairingCode = pairData2?.code || pairData2?.pairingCode || null;
                        } catch (e) { console.log('[connect] pairingCode parse error'); }
              } catch (e) { console.log('[connect] pairingCode endpoint error:', e); }
      }

      console.log('[connect] final result: qrCode=' + (qrCode ? 'YES' : 'NULL') + ' pairingCode=' + (pairingCode || 'NULL'));

      if (!qrCode && !pairingCode) {
              return NextResponse.json(
                { error: 'Impossibile generare QR o codice. Riprova tra qualche secondo.' },
                { status: 500 }
                      );
      }

      return NextResponse.json({ instanceName, qrCode, pairingCode });
  }

  // ── GET PHONE ─────────────────────────────────────────────────────────────
  if (action === 'getPhone') {
        const { instanceName } = body;
        if (!instanceName) return NextResponse.json({ error: 'instanceName required' }, { status: 400 });
        let attempts = 0;
        while (attempts < 10) {
                attempts++;
                await new Promise(r => setTimeout(r, 3000));
                const owner = await getOwnerPhone(instanceName);
                if (owner) {
                          await setWebhook(instanceName);
                          return NextResponse.json({ phone: owner });
                }
                console.log('[connect] getPhone attempt', attempts, '- owner not yet set');
        }
        return NextResponse.json({ error: 'Timeout: WhatsApp non connesso dopo 30s' }, { status: 408 });
  }

  // ── DISCONNECT ────────────────────────────────────────────────────────────
  if (action === 'disconnect') {
        const { instanceName } = body;
        if (!instanceName) return NextResponse.json({ error: 'instanceName required' }, { status: 400 });
        await forceDeleteInstance(instanceName);
        const supa = getSupabase();
        await supa.from('user_instances')
          .update({ connection_status: 'close', last_connection_update: new Date().toISOString() })
          .eq('instance_name', instanceName);
        return NextResponse.json({ success: true });
  }

  // ── SET WEBHOOK ───────────────────────────────────────────────────────────
  if (action === 'setWebhook') {
        const { instanceName } = body;
        if (!instanceName) return NextResponse.json({ error: 'instanceName required' }, { status: 400 });
        await setWebhook(instanceName);
        return NextResponse.json({ success: true });
  }

  // ── LEGACY getCode / getPairingCode — REMOVED ─────────────────────────────
  if (action === 'getCode' || action === 'getPairingCode') {
        console.log('[connect] BLOCKED legacy action:', action, '- these are deprecated and destroy sessions');
        return NextResponse.json({ error: 'Questa azione è stata rimossa. Aggiorna la pagina.' }, { status: 410 });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
