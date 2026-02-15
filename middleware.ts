// @ts-nocheck
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
    // Allow all requests through for now
  // Auth will be re-enabled once Supabase is properly configured
  return NextResponse.next()
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhook|api/connect|api/health).*)'],
}
