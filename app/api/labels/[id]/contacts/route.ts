import { NextRequest, NextResponse } from 'next/server';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../../lib/auth-cookie';
import { validatePhone } from '../../../../lib/phone';
import { getSupabaseAdmin } from '../../../../lib/supabase-admin';

export const dynamic = 'force-dynamic';


async function authedPhone(req: NextRequest): Promise<string | null> {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  return payload?.phone ?? null;
}

// POST /api/labels/:id/contacts — assign a contact_number to the label.
// Idempotent via upsert on the composite PK (label_id, contact_number).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const phone = await authedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { contact_number: raw } = body || {};
  const normalized = typeof raw === 'string' ? validatePhone(raw) : null;
  if (!normalized) return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });

  const supabase = getSupabaseAdmin();

  // Ownership guard — label must belong to authed user.
  const { data: owned } = await supabase
    .from('contact_labels')
    .select('id')
    .eq('id', params.id)
    .eq('user_phone', phone)
    .maybeSingle();
  if (!owned) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { error } = await supabase
    .from('contact_label_assignments')
    .upsert({
      label_id: params.id,
      user_phone: phone,
      contact_number: normalized,
    }, { onConflict: 'label_id,contact_number', ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
