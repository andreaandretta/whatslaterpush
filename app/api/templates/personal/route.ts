import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../lib/auth-cookie';

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

// GET /api/templates/personal — list user_templates for the authed user.
// Ordered most-used first (use_count desc), then updated_at desc as tiebreaker.
export async function GET(req: NextRequest) {
  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_templates')
    .select('id, category, emoji, title, body, source_template_id, use_count, created_at, updated_at')
    .eq('user_phone', phone)
    .order('use_count', { ascending: false })
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data || [] });
}

// POST /api/templates/personal — create a user_template.
// If user already has a template with identical body, returns the existing
// row (200) instead of creating a duplicate — Andrea's "Salva come tuo
// template?" dialog is fire-and-forget, no need to surface a 409 error.
export async function POST(req: NextRequest) {
  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { title, body: messageBody, category, emoji, source_template_id } = body || {};

  if (typeof title !== 'string' || title.trim().length === 0 || title.length > 200) {
    return NextResponse.json({ error: 'invalid_title' }, { status: 400 });
  }
  if (typeof messageBody !== 'string' || messageBody.trim().length === 0 || messageBody.length > 3500) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Dedupe: if a row with identical body already exists for this user, return it.
  const cleanBody = messageBody.trim();
  const { data: existing } = await supabase
    .from('user_templates')
    .select('id, category, emoji, title, body, source_template_id, use_count, created_at, updated_at')
    .eq('user_phone', phone)
    .eq('body', cleanBody)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ template: existing, deduped: true });
  }

  const { data: inserted, error: insErr } = await supabase
    .from('user_templates')
    .insert({
      user_phone: phone,
      title: title.trim().slice(0, 200),
      body: cleanBody,
      category: typeof category === 'string' && category.length > 0 ? category : null,
      emoji: typeof emoji === 'string' && emoji.length > 0 ? emoji : null,
      source_template_id: typeof source_template_id === 'string' ? source_template_id : null,
    })
    .select('id, category, emoji, title, body, source_template_id, use_count, created_at, updated_at')
    .single();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  return NextResponse.json({ template: inserted, deduped: false });
}
