import { NextRequest, NextResponse } from 'next/server';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../../../lib/auth-cookie';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';

export const dynamic = 'force-dynamic';


async function authedPhone(req: NextRequest): Promise<string | null> {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  return payload?.phone ?? null;
}

// DELETE /api/labels/:id/contacts/:number — remove assignment.
// Ownership enforced via user_phone filter (defense in depth — RLS would
// also catch it if enabled).
export async function DELETE(req: NextRequest, { params }: { params: { id: string; number: string } }) {
  const phone = await authedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('contact_label_assignments')
    .delete()
    .eq('label_id', params.id)
    .eq('contact_number', params.number)
    .eq('user_phone', phone)
    .select('label_id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
