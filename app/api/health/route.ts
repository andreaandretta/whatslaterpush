/**
 * GET /api/health
 * System health check endpoint
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { HealthCheckResponse } from '@/types'

export async function GET() {
  const checks: HealthCheckResponse['services'] = {
    database: false,
    evolution: false,
    openai: false,
  }

  let overallStatus: HealthCheckResponse['status'] = 'healthy'
  let systemStatusMessage = 'active'

  // 1. Check Database
  try {
    const supabase = createServiceClient()
    const { error } = await supabase.from('system_status').select('status').single()
    
    if (!error) {
      checks.database = true
    } else {
      console.error('Database health check failed:', error)
      overallStatus = 'degraded'
    }
  } catch (error) {
    console.error('Database connection error:', error)
    overallStatus = 'unhealthy'
  }

  // 2. Check Evolution API
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

  // 3. Check OpenAI
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY
    if (OPENAI_API_KEY) {
      // We don't make an actual request to avoid costs, just verify key exists
      checks.openai = true
    }
  } catch (error) {
    console.error('OpenAI config error:', error)
  }

  // 4. Check system status from DB
  try {
    const supabase = createServiceClient()
    const { data: sysStatus } = await supabase
      .from('system_status')
      .select('status, message')
      .single()
    
    if (sysStatus) {
      systemStatusMessage = sysStatus.status
      if (sysStatus.status === 'maintenance') {
        overallStatus = 'degraded'
      }
    }
  } catch (error) {
    // Use default
  }

  // If critical services are down, mark as unhealthy
  if (!checks.database) {
    overallStatus = 'unhealthy'
  }

  const response: HealthCheckResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: '7.0.0',
    services: checks,
    systemStatus: systemStatusMessage,
  }

  const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503

  return NextResponse.json(response, { status: statusCode })
}
