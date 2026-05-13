import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../../lib/auth-cookie';
import { validatePhone } from '../../../../lib/phone';
import { evolutionClient } from '../../../../../lib/evolution/client';

export const dynamic = 'force-dynamic';

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase credentials');
  return createClient(url, key);
}

export async function GET(
  req: NextRequest,
  { params }: { params: { phone: string } }
) {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  if (!payload?.phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const target = validatePhone(params.phone || '');
  if (!target) return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });

  const supabase = getSupabase();
  const { data: user } = await supabase
    .from('user_instances')
    .select('instance_name')
    .eq('phone_number', payload.phone)
    .single();

  if (!user?.instance_name) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // TEMP DEBUG: photos aren't appearing in production — log raw Evolution
  // response shape so we can see whether profilePictureUrl is even present.
  console.log(`PHOTO: request target=${target} instance=${user.instance_name}`);

  let pictureUrl: string | null = null;
  try {
    const profile = await evolutionClient.fetchProfile(user.instance_name, target);
    console.log(`PHOTO: fetchProfile response for ${target}:`, JSON.stringify(profile));
    pictureUrl = profile?.profilePictureUrl || profile?.picture || null;
    console.log(`PHOTO: pictureUrl for ${target} = ${pictureUrl ? pictureUrl : '<MISSING>'} (profilePictureUrl=${profile?.profilePictureUrl ?? 'undef'}, picture=${profile?.picture ?? 'undef'})`);
  } catch (e: any) {
    const msg = (e?.message || '') as string;
    console.log(`PHOTO: fetchProfile error for ${target}: ${msg}`);
    if (msg.includes('timeout') || msg.includes('aborted')) {
      return NextResponse.json({ error: 'evolution_timeout' }, { status: 504 });
    }
    return NextResponse.json({ error: 'evolution_unavailable' }, { status: 502 });
  }

  if (!pictureUrl) {
    console.log(`PHOTO: no pictureUrl for ${target} — returning 404 no_photo`);
    return NextResponse.json({ error: 'no_photo' }, { status: 404 });
  }

  // Proxy the actual image bytes so the browser can use this as <img src>
  // without CORS issues against pps.whatsapp.net.
  let imgRes: Response;
  try {
    imgRes = await fetch(pictureUrl, { signal: AbortSignal.timeout(8000) });
  } catch {
    return NextResponse.json({ error: 'photo_fetch_failed' }, { status: 502 });
  }

  if (!imgRes.ok) return NextResponse.json({ error: 'no_photo' }, { status: 404 });

  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const buf = await imgRes.arrayBuffer();

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // WhatsApp profile pictures change rarely — cache aggressively in the
      // browser but allow a quick stale-while-revalidate to pick up changes.
      'Cache-Control': 'private, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
