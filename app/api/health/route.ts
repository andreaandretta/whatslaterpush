// @ts-nocheck
/**
 * GET /api/health
 * System health check endpoint
 */

import { NextResponse } from 'next/server'

export async function GET() {
    const checks = {
          database: false,
          evolution: false,
          openai: false,
    }

  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'
    let systemStatusMessage = 'active'

  // 1. Check Evolution API
  try {
        const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL
        const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY

      if (EVOLUTION_API_URL && EVOLUTION_API_KEY) {
              const response = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
                        headers: { 'apikey': EVOLUTION_API_KEY },
                        cache: 'no-store',
              })

          if (response.ok) {
                    checks.evolution = true
          } else {
                    console.error('Evolution API health check failed:', response.status)
                    overallStatus = overallStatus === 'healthy' ? 'degraded' : overallStatus
          }
      }
  } catch (error) {
        console.error('Evolution API connection error:', error)
        overallStatus = overallStatus === 'healthy' ? 'degraded' : overallStatus
  }

  // 2. Check OpenAI
  try {
        const OPENAI_API_KEY = process.env.OPENAI_API_KEY
        if (OPENAI_API_KEY) {
                checks.openai = true
        }
  } catch (error) {
        console.error('OpenAI config error:', error)
  }

  // 3. Check Supabase
  try {
        const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
        if (SUPABASE_URL) {
                checks.database = true
        }
  } catch (error) {
        console.error('Supabase config error:', error)
  }

  const response = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        version: '7.0.0',
        services: checks,
        systemStatus: systemStatusMessage,
  }

  const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503

  return NextResponse.json(response, { status: statusCode })
}
