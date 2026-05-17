import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../lib/auth-cookie';

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
    const webhookSecret = process.env.WEBHOOK_SECRET || '';
    console.log('[connect] setting webhook:', webhookUrl, 'for', name, 'secret:', webhookSecret ? 'SET' : 'NONE');
    try {
          // Evolution API v2: flat config (no wrapper object)
          const webhookBody: any = {
                            enabled: true,
                            url: webhookUrl,
                            webhook_by_events: false,
                            webhook_base64: false,
                            events: [
                              'MESSAGES_UPSERT',
                              'CONTACTS_SET',
                              'CONTACTS_UPSERT',
                              'CONTACTS_UPDATE',
                              'MESSAGING_HISTORY_SET',
                              'CONNECTION_UPDATE',
                              'QRCODE_UPDATED',
                            ],
          };
          if (webhookSecret) {
                  webhookBody.headers = { 'x-webhook-secret': webhookSecret };
          }
          // Try flat format first (Evolution API v2.x)
          const res = await fetch(`${EVO_URL}/webhook/set/${name}`, {
                  method: 'POST',
                  headers: { apikey: EVO_KEY!, 'Content-Type': 'application/json' },
                  body: JSON.stringify(webhookBody),
          });
          const data = await res.json();
          console.log('[connect] webhook set result:', JSON.stringify(data));

          // If flat format returned error, try wrapped format (v2.0 compat)
          if (data?.error || data?.status === 'error' || !res.ok) {
                  console.log('[connect] flat format failed, trying wrapped format...');
                  const res2 = await fetch(`${EVO_URL}/webhook/set/${name}`, {
                          method: 'POST',
                          headers: { apikey: EVO_KEY!, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ webhook: webhookBody }),
                  });
                  const data2 = await res2.json();
                  console.log('[connect] webhook set (wrapped) result:', JSON.stringify(data2));
          }
    } catch (e) { console.log('[connect] setWebhook error:', e); }
}

async function requireCookieAuth(req: NextRequest): Promise<{ phone: string; instanceName: string } | null> {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  if (!payload) return null;
  return { phone: payload.phone, instanceName: payload.instanceName };
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { action } = body;
    console.log('[connect] action:', action, 'body:', JSON.stringify(body));

  const PROTECTED_ACTIONS = new Set(['status', 'getStatus', 'getPhone', 'disconnect']);
  if (PROTECTED_ACTIONS.has(action)) {
    const auth = await requireCookieAuth(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { instanceName } = body;
    if (instanceName && instanceName !== auth.instanceName) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  if (action === 'getCodeAndPairing') {
    return NextResponse.json(
      { error: 'Endpoint rimosso. Usa POST /api/auth/init' },
      { status: 410 }
    );
  }

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

  // ── REFRESH WEBHOOKS — re-set webhook on all active instances ────────────
  if (action === 'refreshWebhooks') {
        const { secret } = body;
        if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const supa = getSupabase();
        const { data: instances } = await supa.from('user_instances')
          .select('instance_name, connection_status')
          .in('connection_status', ['open', 'connecting']);
        const results: any[] = [];
        for (const inst of (instances || [])) {
          try {
                await setWebhook(inst.instance_name);
                results.push({ instance: inst.instance_name, status: 'ok' });
          } catch (e: any) {
                results.push({ instance: inst.instance_name, status: 'error', error: e.message });
          }
        }
        // Also check current webhook config for each instance
        const configs: any[] = [];
        for (const inst of (instances || [])) {
          try {
                const res = await fetch(`${EVO_URL}/webhook/find/${inst.instance_name}`, {
                          headers: { apikey: EVO_KEY! },
                });
                const data = await res.json();
                configs.push({ instance: inst.instance_name, webhook: data });
          } catch (e: any) {
                configs.push({ instance: inst.instance_name, error: e.message });
          }
        }
        return NextResponse.json({ refreshed: results, configs });
  }

  // ── LEGACY getCode / getPairingCode — REMOVED ─────────────────────────────
  if (action === 'getCode' || action === 'getPairingCode') {
        console.log('[connect] BLOCKED legacy action:', action, '- these are deprecated and destroy sessions');
        return NextResponse.json({ error: 'Questa azione è stata rimossa. Aggiorna la pagina.' }, { status: 410 });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
