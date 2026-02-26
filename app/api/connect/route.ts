// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';

const EVO_URL = process.env.EVOLUTION_API_URL || 'http://evo-pkso00o0ccoc8ccgos0ks4cw.161.35.212.68.sslip.io';
const EVO_KEY = process.env.EVOLUTION_API_KEY || 'SCHEDWHATS_GOD_MODE_SECRET_KEY_2024';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://l8o400sowgw800swg8gcg0kk.161.35.212.68.sslip.io';

function validatePhone(raw: string): string | null {
  const clean = raw.replace(/\D/g, '');
  if (clean.length < 10 || clean.length > 15) return null;
  return clean;
}

async function forceDeleteInstance(name: string): Promise<void> {
  console.log('[connect] forceDelete start:', name);
  try {
    await fetch(`${EVO_URL}/instance/logout/${name}`, {
      method: 'DELETE',
      headers: { apikey: EVO_KEY },
    });
  } catch (e) {
    console.log('[connect] logout error (ignored):', e);
  }
  await new Promise(r => setTimeout(r, 800));
  try {
    await fetch(`${EVO_URL}/instance/delete/${name}`, {
      method: 'DELETE',
      headers: { apikey: EVO_KEY },
    });
  } catch (e) {
    console.log('[connect] delete error (ignored):', e);
  }
  await new Promise(r => setTimeout(r, 800));
  console.log('[connect] forceDelete done:', name);
}

async function getOwnerPhone(name: string): Promise<string | null> {
  try {
    const res = await fetch(`${EVO_URL}/instance/fetchInstances?instanceName=${name}`, {
      headers: { apikey: EVO_KEY },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const arr = Array.isArray(data) ? data : [data];
    const inst = arr.find((i: any) => i.instance?.instanceName === name || i.name === name);
    if (!inst) return null;
    const owner = inst.instance?.owner || inst.owner || null;
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
        url: webhookUrl,
        webhook_by_events: false,
        webhook_base64: false,
        events: ['MESSAGES_UPSERT'],
      }),
    });
    const data = await res.json();
    console.log('[connect] webhook set result:', JSON.stringify(data));
  } catch (e) {
    console.log('[connect] setWebhook error:', e);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;
  console.log('[connect] action:', action, 'body:', JSON.stringify(body));

  // ── STATUS ────────────────────────────────────────────────────────────────
  if (action === 'status') {
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
      const state = data?.instance?.state || data?.state || 'close';

      if (state === 'open') {
        const owner = await getOwnerPhone(instanceName);
        console.log('[connect] owner:', owner);
        if (owner) {
          return NextResponse.json({ status: 'open', owner });
        } else {
          return NextResponse.json({ status: 'connecting' });
        }
      } else if (state === 'connecting' || state === 'qr') {
        return NextResponse.json({ status: 'connecting' });
      } else {
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
    if (!cleanPhone) {
      return NextResponse.json(
        { error: 'Inserisci numero completo con prefisso internazionale (es: 393509898408)' },
        { status: 400 }
      );
    }

    const instanceName = `SchedWhats-${cleanPhone}`;
    console.log('[connect] getCodeAndPairing for:', instanceName);

    // Force delete any existing instance
    await forceDeleteInstance(instanceName);

    // Create instance with phone number (enables pairing code)
    let createRes: any;
    try {
      const createBody = {
        instanceName,
        number: cleanPhone,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      };
      console.log('[connect] creating instance:', JSON.stringify(createBody));
      const res = await fetch(`${EVO_URL}/instance/create`, {
        method: 'POST',
        headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
      });
      createRes = await res.json();
      console.log('[connect] create result:', JSON.stringify(createRes));
    } catch (e) {
      console.log('[connect] create error:', e);
      return NextResponse.json({ error: 'Errore creazione istanza Evolution API' }, { status: 500 });
    }

    // Extract QR code from create response
    let qrCode: string | null =
      createRes?.qrcode?.base64 ||
      createRes?.qrCode?.base64 ||
      createRes?.base64 ||
      null;

    // Wait for QR to be ready if not immediately available
    if (!qrCode) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const qrRes = await fetch(`${EVO_URL}/instance/connect/${instanceName}`, {
          method: 'GET',
          headers: { apikey: EVO_KEY },
        });
        const qrData = await qrRes.json();
        console.log('[connect] qr fallback data:', JSON.stringify(qrData));
        qrCode = qrData?.base64 || qrData?.qrcode?.base64 || null;
      } catch (e) {
        console.log('[connect] qr fallback error:', e);
      }
    }

    // Extract pairing code from create response
    let pairingCode: string | null =
      createRes?.pairingCode ||
      createRes?.code ||
      null;

    // Try to get pairing code via dedicated endpoint if not in create response
    if (!pairingCode) {
      await new Promise(r => setTimeout(r, 1500));
      try {
        const pairRes = await fetch(`${EVO_URL}/instance/pairingCode/${instanceName}`, {
          method: 'POST',
          headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: cleanPhone }),
        });
        const pairData = await pairRes.json();
        console.log('[connect] pairingCode result:', JSON.stringify(pairData));
        pairingCode = pairData?.code || pairData?.pairingCode || null;
      } catch (e) {
        console.log('[connect] pairingCode error:', e);
      }
    }

    if (!qrCode && !pairingCode) {
      return NextResponse.json(
        { error: 'Impossibile generare QR o codice. Riprova tra qualche secondo.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      instanceName,
      qrCode,
      pairingCode,
    });
  }

  // ── GET PHONE (retrieve owner from connected instance) ────────────────────
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

  // ── DISCONNECT ─────────────────────────────────────────────────────────────
  if (action === 'disconnect') {
    const { instanceName } = body;
    if (!instanceName) return NextResponse.json({ error: 'instanceName required' }, { status: 400 });
    await forceDeleteInstance(instanceName);
    return NextResponse.json({ success: true });
  }

  // ── SET WEBHOOK (manual trigger) ──────────────────────────────────────────
  if (action === 'setWebhook') {
    const { instanceName } = body;
    if (!instanceName) return NextResponse.json({ error: 'instanceName required' }, { status: 400 });
    await setWebhook(instanceName);
    return NextResponse.json({ success: true });
  }

  // ── LEGACY: getCode ────────────────────────────────────────────────────────
  if (action === 'getCode') {
    const { phone } = body;
    const cleanPhone = validatePhone(phone || '');
    if (!cleanPhone) {
      return NextResponse.json({ error: 'Numero non valido' }, { status: 400 });
    }
    const instanceName = `SchedWhats-${cleanPhone}`;
    await forceDeleteInstance(instanceName);
    try {
      const res = await fetch(`${EVO_URL}/instance/create`, {
        method: 'POST',
        headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
      });
      const data = await res.json();
      await new Promise(r => setTimeout(r, 1500));
      const qrRes = await fetch(`${EVO_URL}/instance/connect/${instanceName}`, {
        headers: { apikey: EVO_KEY },
      });
      const qrData = await qrRes.json();
      const qrCode = qrData?.base64 || data?.qrcode?.base64 || null;
      return NextResponse.json({ instanceName, qrCode });
    } catch (e) {
      return NextResponse.json({ error: 'Errore QR' }, { status: 500 });
    }
  }

  // ── LEGACY: getPairingCode ────────────────────────────────────────────────
  if (action === 'getPairingCode') {
    const { phone } = body;
    const cleanPhone = validatePhone(phone || '');
    if (!cleanPhone) {
      return NextResponse.json({ error: 'Numero non valido' }, { status: 400 });
    }
    const instanceName = `SchedWhats-${cleanPhone}`;
    await forceDeleteInstance(instanceName);
    try {
      const createRes = await fetch(`${EVO_URL}/instance/create`, {
        method: 'POST',
        headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName, number: cleanPhone, qrcode: false, integration: 'WHATSAPP-BAILEYS' }),
      });
      const createData = await createRes.json();
      await new Promise(r => setTimeout(r, 1500));
      const pairRes = await fetch(`${EVO_URL}/instance/pairingCode/${instanceName}`, {
        method: 'POST',
        headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: cleanPhone }),
      });
      const pairData = await pairRes.json();
      const pairingCode = pairData?.code || createData?.pairingCode || null;
      return NextResponse.json({ instanceName, pairingCode });
    } catch (e) {
      return NextResponse.json({ error: 'Errore pairing code' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
