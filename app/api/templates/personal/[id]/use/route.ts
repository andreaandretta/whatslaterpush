import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../../../lib/auth-cookie';

export const dynamic = 'force-dynamic';

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase credentials');
  return createClient(url, key);
}

async function getAuthedPhone(req: NextRequest): Promise<string | null> {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  return payload?.phone ?? null;
}

// POST /api/templates/personal/:id/use — atomic increment use_count.
// Called from the UI when a user picks a personal template to schedule.
// Ownership check happens via a guard SELECT first; the RPC itself is owner-
// agnostic so we don't let one user bump another user's counter.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabase();

  // Ownership guard.
  const { data: owned } = await supabase
    .from('user_templates')
    .select('id')
    .eq('id', params.id)
    .eq('user_phone', phone)
    .maybeSingle();
  if (!owned) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data, error } = await supabase.rpc('user_template_increment_use', { p_template_id: params.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}
