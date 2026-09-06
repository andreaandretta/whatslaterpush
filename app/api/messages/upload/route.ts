import { NextRequest, NextResponse } from 'next/server';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../lib/auth-cookie';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';

export const dynamic = 'force-dynamic';

const BUCKET = 'message-media';
const MAX_BYTES = 16 * 1024 * 1024; // 16MB — Evolution API ceiling

// MIME whitelist by media kind. Anything not in here is rejected to keep
// .exe / .js / .html / .svg (XSS surface) out of the bucket.
const ALLOWED_MIME: Record<string, RegExp> = {
  image: /^image\/(jpeg|png|gif|webp)$/,
  video: /^video\/(mp4|webm|quicktime|3gpp|x-msvideo)$/,
  audio: /^audio\/(mpeg|ogg|wav|webm|aac|x-m4a|mp4)$/,
  document: /^application\/(pdf|msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|vnd\.ms-(excel|powerpoint)|zip)$|^text\/(plain|csv)$/,
};

export function classifyMediaType(mime: string): 'image' | 'video' | 'audio' | 'document' | null {
  for (const [kind, re] of Object.entries(ALLOWED_MIME)) {
    if (re.test(mime)) return kind as 'image' | 'video' | 'audio' | 'document';
  }
  return null;
}


function sanitizeFilename(name: string): string {
  // Strip path separators, control chars, and anything not in a safe set.
  // Keep extension intact for Evolution's fileName field (used on docs/videos).
  return name
    .replace(/[\\/\x00-\x1f]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 120) || 'file';
}

// POST /api/messages/upload — multipart upload to Supabase Storage.
// Response: { media_url, media_type, media_filename }
// Caller (ScheduleModal/MediaPicker) then passes these three fields to
// POST /api/messages alongside the text body.
export async function POST(req: NextRequest) {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  if (!payload?.phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userPhone = payload.phone;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_form' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  }

  if (file.size === 0) return NextResponse.json({ error: 'empty_file' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'file_too_large', limit_mb: 16 }, { status: 400 });
  }

  const mediaType = classifyMediaType(file.type);
  if (!mediaType) {
    return NextResponse.json({ error: 'unsupported_mime', mime: file.type }, { status: 400 });
  }

  const filename = sanitizeFilename(file.name || 'file');
  const uuid = (globalThis.crypto as Crypto & { randomUUID(): string }).randomUUID();
  const path = `${userPhone}/${uuid}-${filename}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const supabase = getSupabaseAdmin();
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: false,
    });
  if (upErr) {
    console.error('UPLOAD: storage error', upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Return a signed URL (1h) so the cron + Evolution can fetch the media
  // without exposing the private bucket. The url is re-resolved each cron
  // tick if expired — see cron/send-messages for the fetch flow.
  // For now we store the storage path and let the cron re-sign.
  // Public-facing field is the path; cron resolves to signed URL at send time.
  return NextResponse.json({
    media_url: path,             // storage path, NOT public URL
    media_type: mediaType,
    media_filename: filename,
    bytes: file.size,
  });
}
