import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../lib/auth-cookie';
import { logAuditEvent } from '../../../lib/audit';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 1000;
const E164_RE = /^39\d{8,11}$/;

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface ImportRow {
  name?: string;
  phone: string;
}

// POST /api/contacts/import
// Body: { rows: Array<{ name?: string, phone: string }> }
// Phone must already be E.164 starting with 39 (client normalizes via
// app/lib/csv-parser.ts before posting).
//
// Response: { imported, skipped_duplicates, errors: Array<{ row, error }> }
export async function POST(req: NextRequest) {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  if (!payload?.phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userPhone = payload.phone;

  const body = await req.json().catch(() => ({}));
  const rows = body?.rows;
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: 'empty_input' }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: 'too_many_rows', limit: MAX_ROWS }, { status: 400 });
  }

  const errors: Array<{ row: number; error: string }> = [];
  const valid: ImportRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as { name?: unknown; phone?: unknown };
    const phone = typeof r?.phone === 'string' ? r.phone.trim() : '';
    if (!E164_RE.test(phone)) {
      errors.push({ row: i, error: 'invalid_phone' });
      continue;
    }
    if (phone === userPhone) {
      errors.push({ row: i, error: 'self_target' });
      continue;
    }
    const name = typeof r?.name === 'string' ? r.name.trim().slice(0, 100) : '';
    valid.push({ phone, name: name || undefined });
  }

  if (valid.length === 0) {
    return NextResponse.json({
      imported: 0,
      skipped_duplicates: 0,
      errors,
    });
  }

  const supabase = getSupabase();

  // Pre-insert dedup: count contacts already in cache so we can report
  // skipped_duplicates honestly. The upsert itself is ON CONFLICT DO UPDATE,
  // so duplicates are not "errors" — they're just no-ops for new data.
  const numbers = Array.from(new Set(valid.map((v) => v.phone)));
  const { data: existing } = await supabase
    .from('whatsapp_contacts')
    .select('contact_number')
    .eq('user_phone', userPhone)
    .in('contact_number', numbers);
  const existingSet = new Set((existing || []).map((c: { contact_number: string }) => c.contact_number));
  const skippedDuplicates = valid.filter((v) => existingSet.has(v.phone)).length;

  // Bulk upsert via the existing RPC.
  const rpcRows = valid.map((v) => ({
    user_phone: userPhone,
    contact_number: v.phone,
    name: v.name || '',
    push_name: '',
    profile_pic_url: '',
    source: 'MANUAL_CSV',
  }));
  const { error: rpcErr } = await supabase.rpc('upsert_whatsapp_contacts', { p_rows: rpcRows });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  await logAuditEvent({
    userPhone,
    eventType: 'csv_import',
    payload: {
      imported: valid.length,
      skipped_duplicates: skippedDuplicates,
      error_count: errors.length,
    },
  });

  return NextResponse.json({
    imported: valid.length,
    skipped_duplicates: skippedDuplicates,
    errors,
  });
}
