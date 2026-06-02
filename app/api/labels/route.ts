import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../lib/auth-cookie';
import { isValidLabelColor } from '../../lib/labels';
import { getPlanLimits } from '../../lib/plans';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function authedPhone(req: NextRequest): Promise<string | null> {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  return payload?.phone ?? null;
}

// GET /api/labels — list user's labels with assignment counts
export async function GET(req: NextRequest) {
  const phone = await authedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabase();
  const { data: labels, error } = await supabase
    .from('contact_labels')
    .select('id, name, color, display_order, created_at')
    .eq('user_phone', phone)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Counts per label.
  const ids = (labels || []).map(l => l.id);
  const countByLabel = new Map<string, number>();
  if (ids.length > 0) {
    const { data: assignments } = await supabase
      .from('contact_label_assignments')
      .select('label_id')
      .eq('user_phone', phone)
      .in('label_id', ids);
    for (const a of (assignments || []) as Array<{ label_id: string }>) {
      countByLabel.set(a.label_id, (countByLabel.get(a.label_id) || 0) + 1);
    }
  }

  return NextResponse.json({
    labels: (labels || []).map(l => ({ ...l, contact_count: countByLabel.get(l.id) || 0 })),
  });
}

// POST /api/labels — create a label
export async function POST(req: NextRequest) {
  const phone = await authedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { name, color, display_order } = body || {};

  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 60) {
    return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
  }
  if (typeof color !== 'string' || !isValidLabelColor(color)) {
    return NextResponse.json({ error: 'invalid_color' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Tier gate: Free plan can still see existing label rows via GET, but
  // cannot create new ones. Returns 403 plan_label_locked so the UI can
  // route to the upgrade flow.
  const { data: user } = await supabase
    .from('user_instances')
    .select('subscription_plan')
    .eq('phone_number', phone)
    .single();
  const plan = user?.subscription_plan || 'free';
  if (!getPlanLimits(plan).customLabels) {
    return NextResponse.json({ error: 'plan_label_locked', plan }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('contact_labels')
    .insert({
      user_phone: phone,
      name: name.trim().slice(0, 60),
      color,
      display_order: typeof display_order === 'number' ? display_order : 0,
    })
    .select('id, name, color, display_order, created_at')
    .single();
  if (error) {
    // Postgres unique violation surfaces as code 23505.
    if (error.code === '23505') return NextResponse.json({ error: 'duplicate_name' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ label: { ...data, contact_count: 0 } });
}
