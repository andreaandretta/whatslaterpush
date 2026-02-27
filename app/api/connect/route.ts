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
  await new Promise(r => setTimeout(r, 500));
  try {
    await fetch(`${EVO_URL}/instance/delete/${name}`, {
      method: 'DELETE',
      headers: { apikey: EVO_KEY },
    });
  } catch (e) {
    console.log('[connect] delete error (ignored):', e);
  }
  await new Promise(r => setTimeout(r, 500));
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
        console.log('[connect] owner check:', owner);
        if (owner) {
          return NextResponse.json({ status: 'open', owner });
        }
        // open but no owner yet — still say open, frontend will handle
        return NextResponse.json({ status: 'open', owner: null });
      }
      if (state === 'connecting' || state === 'qr') {
        return NextResponse.json({ status: 'connecting' });
      }
      return NextResponse.json({ status: 'close' });
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

    // Step 1: Create instance
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
      // Log create result WITHOUT the huge base64 qrcode
      const logCreate = {...createRes};
      if (logCreate.qrcode?.base64) logCreate.qrcode = { base64: '(QR_BASE64_OMITTED)' };
      console.log('[connect] create result keys:', Object.keys(createRes).join(','));
      console.log('[connect] create result:', JSON.stringify(logCreate).substring(0, 1000));
    } catch (e) {
      console.log('[connect] create error:', e);
      return NextResponse.json({ error: 'Errore creazione istanza Evolution API' }, { status: 500 });
    }

    // Step 2: Set webhook IMMEDIATELY (don't wait for connection)
    await setWebhook(instanceName);

    // Step 3: Extract QR code from create response
    let qrCode: string | null =
      createRes?.qrcode?.base64 ||
      createRes?.qrCode?.base64 ||
      createRes?.base64 ||
      null;

    // Step 4: If no QR from create, call /instance/connect to get it
    if (!qrCode) {
      console.log('[connect] no QR from create, calling /instance/connect...');
      await new Promise(r => setTimeout(r, 2000));
      try {
        const qrRes = await fetch(`${EVO_URL}/instance/connect/${instanceName}`, {
          method: 'GET',
          headers: { apikey: EVO_KEY },
        });
        const qrData = await qrRes.json();
        const logQr = {...qrData};
        if (logQr.base64) logQr.base64 = '(QR_BASE64_OMITTED)';
        console.log('[connect] connect/QR fallback:', JSON.stringify(logQr).substring(0, 500));
        qrCode = qrData?.base64 || qrData?.qrcode?.base64 || null;
      } catch (e) {
        console.log('[connect] qr fallback error:', e);
      }
    }

    // Step 5: Get pairing code
    // Try multiple approaches to get the pairing code
    let pairingCode: string | null = createRes?.pairingCode || createRes?.code || null;
    console.log('[connect] pairing from create:', pairingCode);

    if (!pairingCode) {
      // Approach 1: POST /instance/connect/{name} with number
      console.log('[connect] trying POST /instance/connect for pairing...');
      await new Promise(r => setTimeout(r, 1000));
      try {
        const pairRes1 = await fetch(`${EVO_URL}/instance/connect/${instanceName}`, {
          method: 'POST',
          headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: cleanPhone }),
        });
        const pairData1 = await pairRes1.json();
        const logP1 = {...pairData1};
        if (logP1.base64) logP1.base64 = '(OMITTED)';
        console.log('[connect] POST connect result:', JSON.stringify(logP1).substring(0, 500));
        pairingCode = pairData1?.pairingCode || pairData1?.code || null;
      } catch (e) {
        console.log('[connect] POST connect error:', e);
      }
    }

    if (!pairingCode) {
      // Approach 2: POST /instance/pairingCode/{name}
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
        } catch (e) {
          console.log('[connect] pairingCode parse error');
        }
      } catch (e) {
        console.log('[connect] pairingCode endpoint error:', e);
      }
    }

    if (!pairingCode) {
      // Approach 3: GET /instance/pairingCode/{name}
      console.log('[connect] trying GET /instance/pairingCode...');
      try {
        const pairRes3 = await fetch(`${EVO_URL}/instance/pairingCode/${instanceName}?number=${cleanPhone}`, {
          method: 'GET',
          headers: { apikey: EVO_KEY },
        });
        const pairText3 = await pairRes3.text();
        console.log('[connect] GET pairingCode status:', pairRes3.status, 'body:', pairText3.substring(0, 500));
        try {
          const pairData3 = JSON.parse(pairText3);
          pairingCode = pairData3?.code || pairData3?.pairingCode || null;
        } catch (e) {}
      } catch (e) {
        console.log('[connect] GET pairingCode error:', e);
      }
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

  // ── GET PHONE ────────────────────────────────────────────────────────────
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

  // ── SET WEBHOOK ──────────────────────────────────────────────────────────
  if (action === 'setWebhook') {
    const { instanceName } = body;
    if (!instanceName) return NextResponse.json({ error: 'instanceName required' }, { status: 400 });
    await setWebhook(instanceName);
    return NextResponse.json({ success: true });
  }

  // ── LEGACY getCode / getPairingCode — REMOVED (they were destroying active sessions) ──
  if (action === 'getCode' || action === 'getPairingCode') {
    console.log('[connect] BLOCKED legacy action:', action, '- these are deprecated and destroy sessions');
    return NextResponse.json({ error: 'Questa azione è stata rimossa. Aggiorna la pagina.' }, { status: 410 });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
