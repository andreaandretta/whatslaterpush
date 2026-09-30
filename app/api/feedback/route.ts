import { NextRequest, NextResponse } from 'next/server';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../lib/auth-cookie';
import { getSupabaseAdmin } from '../../lib/supabase-admin';
import { FAKE_DOOR_FEATURE, isFakeDoorActive, isFakeDoorAnswer } from '../../lib/fake-door';
import { romeDayStart } from '../../lib/anti-ban';

export const dynamic = 'force-dynamic';
// GET/RPC deterministico su supabase-js: la Next Data Cache lo congelerebbe
// (bug storico stress-index/reset-quote). force-no-store la disattiva. (Task 42)
export const fetchCache = 'force-no-store';

// Porta finta "foto del calendario" (D14) e segnale di uso dell'app (D15).
// Tutto in audit_events, nessuna migrazione. Insert diretti con controllo
// dell'errore (non logAuditEvent, che non lo riporta) e ip_address sempre NULL.

async function getAuthedPhone(req: NextRequest): Promise<string | null> {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  return payload?.phone ?? null;
}

// Una risposta già data per questo utente? Errore di lettura → "no".
async function hasAnswered(supabase: any, phone: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('audit_events')
      .select('id')
      .eq('user_phone', phone)
      .eq('event_type', 'fake_door_answer')
      .eq('payload->>feature', FAKE_DOOR_FEATURE)
      .limit(1);
    if (error) return false;
    return Array.isArray(data) ? data.length > 0 : !!data;
  } catch {
    return false;
  }
}

// dashboard_seen al massimo una volta per giorno di Roma. Best-effort: non fa mai fallire il GET.
async function markDashboardSeen(supabase: any, phone: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('audit_events')
      .select('id')
      .eq('user_phone', phone)
      .eq('event_type', 'dashboard_seen')
      .gte('created_at', romeDayStart(new Date()).toISOString())
      .limit(1);
    if (error) return;
    if (Array.isArray(data) ? data.length > 0 : !!data) return;
    const { error: insErr } = await supabase.from('audit_events').insert({
      user_phone: phone,
      event_type: 'dashboard_seen',
      payload: {},
      ip_address: null,
    });
    if (insErr) console.warn('FEEDBACK: dashboard_seen insert failed: ' + insErr.message);
  } catch (err: any) {
    console.warn('FEEDBACK: dashboard_seen failed: ' + (err?.message || err));
  }
}

export async function GET(req: NextRequest) {
  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const [answered] = await Promise.all([hasAnswered(supabase, phone), markDashboardSeen(supabase, phone)]);
  return NextResponse.json(
    { [FAKE_DOOR_FEATURE]: { active: isFakeDoorActive(), answered } },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function POST(req: NextRequest) {
  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (body?.feature !== FAKE_DOOR_FEATURE || !isFakeDoorAnswer(body?.answer)) {
    return NextResponse.json({ error: 'invalid_answer', message: 'Risposta non valida.' }, { status: 400 });
  }
  if (!isFakeDoorActive()) {
    return NextResponse.json({ error: 'fake_door_closed', message: 'Questa domanda non è più attiva.' }, { status: 409 });
  }

  const supabase = getSupabaseAdmin();
  // Idempotente: con una risposta già salvata non se ne scrive un'altra.
  if (await hasAnswered(supabase, phone)) return NextResponse.json({ ok: true, already: true });

  const { error } = await supabase.from('audit_events').insert({
    user_phone: phone,
    event_type: 'fake_door_answer',
    payload: { feature: FAKE_DOOR_FEATURE, answer: body.answer, v: 1 },
    ip_address: null,
  });
  if (error) {
    console.error('FEEDBACK: fake_door_answer insert failed: ' + error.message);
    return NextResponse.json({ error: 'save_failed', message: 'Non sono riuscito a salvare la risposta: riprova.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
