import { NextRequest, NextResponse } from 'next/server';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../../lib/auth-cookie';
import { getSupabaseAdmin } from '../../../../lib/supabase-admin';

export const dynamic = 'force-dynamic';


async function getAuthedPhone(req: NextRequest): Promise<string | null> {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  return payload?.phone ?? null;
}

// PUT /api/templates/personal/:id — update title/body/category/emoji.
// Ownership enforced via WHERE user_phone = authed.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { title, body: messageBody, category, emoji } = body || {};

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof title === 'string') {
    if (title.trim().length === 0 || title.length > 200) {
      return NextResponse.json({ error: 'invalid_title' }, { status: 400 });
    }
    updates.title = title.trim().slice(0, 200);
  }
  if (typeof messageBody === 'string') {
    if (messageBody.trim().length === 0 || messageBody.length > 3500) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    updates.body = messageBody.trim();
  }
  if (category !== undefined) updates.category = typeof category === 'string' && category.length > 0 ? category : null;
  if (emoji !== undefined) updates.emoji = typeof emoji === 'string' && emoji.length > 0 ? emoji : null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('user_templates')
    .update(updates)
    .eq('id', params.id)
    .eq('user_phone', phone)
    .select('id, category, emoji, title, body, source_template_id, use_count, created_at, updated_at')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ template: data });
}

// DELETE /api/templates/personal/:id
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('user_templates')
    .delete()
    .eq('id', params.id)
    .eq('user_phone', phone)
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
