// Admin authorization helper. Cookie-based: reuses sw_session (the same HMAC
// cookie that protects /dashboard) and checks the authenticated phone against
// the ADMIN_PHONES allowlist. There is no separate admin password / cookie —
// the operator pairs as a normal user, and ADMIN_PHONES decides which paired
// numbers also see /admin.
//
// Defense-in-depth: middleware.ts also enforces this at the edge. This helper
// is the second gate that handler code calls explicitly, so a future endpoint
// that slips past the matcher still fails closed at the route level.

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { verifyCookie, AUTH_COOKIE_NAME } from './auth-cookie';

let warnedUnset = false;

function parseAdminPhones(): string[] {
  const raw = process.env.ADMIN_PHONES;
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export interface AdminContext {
  phone: string;
  instanceName: string;
}

// Returns the admin context on success, or a NextResponse to return immediately
// on failure. Callers do:
//   const admin = await requireAdmin(req);
//   if (admin instanceof NextResponse) return admin;
//   // ...use admin.phone
export async function requireAdmin(req: NextRequest): Promise<AdminContext | NextResponse> {
  const allowlist = parseAdminPhones();

  if (allowlist.length === 0) {
    if (!warnedUnset) {
      warnedUnset = true;
      try {
        Sentry.captureMessage('ADMIN_PHONES not configured — admin endpoints locked', 'warning');
      } catch { /* sentry not initialized in dev/test */ }
      console.warn('[admin-auth] ADMIN_PHONES not set — refusing all admin requests (fail-closed)');
    }
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const cookieRaw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(cookieRaw);
  if (!payload) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!allowlist.includes(payload.phone)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return { phone: payload.phone, instanceName: payload.instanceName };
}

// Test-only: reset the "warned once" latch so unit tests can verify the warn
// fires on first call. Not exported from a barrel — imported directly by tests.
export function __resetAdminAuthWarnLatch() {
  warnedUnset = false;
}
