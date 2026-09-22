import { NextRequest, NextResponse } from 'next/server';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../../lib/auth-cookie';
import { getSupabaseAdmin } from '../../../../lib/supabase-admin';
import { classifyMediaType } from '../route';
import { MAX_UPLOAD_BYTES } from '../../../../lib/upload-limits';

export const dynamic = 'force-dynamic';

const BUCKET = 'message-media';

function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/\x00-\x1f]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 120) || 'file';
}

// POST /api/messages/upload/sign — { filename, mime, size } → signed upload URL.
//
// Vercel drops any request body above ~4.5 MB at the edge (plain 413, no JSON),
// so files that big cannot pass through /api/messages/upload. The browser asks
// here for a one-shot signed URL and PUTs the bytes straight into Supabase
// Storage; the bucket stays private and the path shape is the same as the
// multipart route, so the cron and cleanup-media do not change.
export async function POST(req: NextRequest) {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  if (!payload?.phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userPhone = payload.phone;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const size = Number(body?.size);
  const mime = typeof body?.mime === 'string' ? body.mime : '';
  if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ error: 'empty_file' }, { status: 400 });
  if (size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'file_too_large', limit_mb: 16 }, { status: 400 });

  const mediaType = classifyMediaType(mime);
  if (!mediaType) return NextResponse.json({ error: 'unsupported_mime', mime }, { status: 400 });

  const filename = sanitizeFilename(typeof body?.filename === 'string' ? body.filename : 'file');
  const uuid = (globalThis.crypto as Crypto & { randomUUID(): string }).randomUUID();
  const path = `${userPhone}/${uuid}-${filename}`;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) {
    console.error('UPLOAD/SIGN: storage error', error?.message);
    return NextResponse.json({ error: error?.message || 'sign_failed' }, { status: 500 });
  }

  return NextResponse.json({
    signed_url: data.signedUrl,
    media_url: path,            // storage path, same contract as /api/messages/upload
    media_type: mediaType,
    media_filename: filename,
  });
}
