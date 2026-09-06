// @ts-nocheck
/**
 * GET /api/health
 * System health check endpoint.
 *
 * Operational signals (vs config-only presence checks):
 * - queue.pending_overdue_5min: scheduled_messages stuck in 'pending'
 *   past their scheduled_at by >5 minutes. Indicates the cron has stopped
 *   firing or Evolution is unreachable.
 * - instances.disconnected_30min: user_instances with connection_status='close'
 *   AND last_connection_update older than 30 minutes. Indicates Baileys
 *   sessions that won't recover on their own.
 *
 * Critical thresholds → HTTP 503 (so external monitors page on this):
 *   queue.pending_overdue_5min >= 5  (multiple cron cycles missed)
 *   instances.disconnected_30min >= 2 (more than one user offline at once
 *                                       = likely droplet-level issue, not
 *                                       a single user abandoned the app)
 *
 * Note: last_connection_update is only refreshed when a status poll runs
 * (dashboard open / webhook CONNECTION_UPDATE). A user who disconnected
 * weeks ago and never came back will satisfy the disconnected_30min query.
 * The >=2 critical threshold filters these legitimate-abandonment cases
 * from real multi-user droplet incidents.
 */

import { NextResponse } from 'next/server'
import { getSupabaseAdminOrNull } from '../../lib/supabase-admin'

// GET/RPC deterministico su supabase-js: la Next Data Cache lo congelerebbe
// (bug storico stress-index/reset-quote). force-no-store la disattiva. (Task 42)
export const fetchCache = 'force-no-store';

const PENDING_CRITICAL = 5
const DISCONNECTED_CRITICAL = 2

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
  if (process.env.OPENAI_API_KEY) {
        checks.openai = true
  }

  // 3. Supabase: presence + operational queue / disconnect probes
  const supabase = getSupabaseAdminOrNull()

  const queue = { pending_overdue_5min: 0, critical: false }
  const instances = { disconnected_30min: 0, critical: false }

  if (supabase) {
    checks.database = true
    try {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()

      const [pendingRes, disconnectedRes] = await Promise.all([
        supabase
          .from('scheduled_messages')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .lt('scheduled_at', fiveMinAgo),
        supabase
          .from('user_instances')
          .select('id', { count: 'exact', head: true })
          .eq('connection_status', 'close')
          .lt('last_connection_update', thirtyMinAgo),
      ])

      queue.pending_overdue_5min = pendingRes.count || 0
      queue.critical = queue.pending_overdue_5min >= PENDING_CRITICAL

      instances.disconnected_30min = disconnectedRes.count || 0
      instances.critical = instances.disconnected_30min >= DISCONNECTED_CRITICAL

      if (queue.critical || instances.critical) {
        overallStatus = 'unhealthy'
        systemStatusMessage = queue.critical
          ? `pending_queue_stuck_${queue.pending_overdue_5min}`
          : `instances_disconnected_${instances.disconnected_30min}`
      } else if (queue.pending_overdue_5min > 0 || instances.disconnected_30min > 0) {
        overallStatus = overallStatus === 'healthy' ? 'degraded' : overallStatus
        systemStatusMessage = 'warning'
      }
    } catch (error) {
      console.error('Supabase operational probe error:', error)
      overallStatus = overallStatus === 'healthy' ? 'degraded' : overallStatus
    }
  }

  const response = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        version: '7.0.0',
        services: checks,
        systemStatus: systemStatusMessage,
        queue,
        instances,
  }

  const statusCode = overallStatus === 'unhealthy' ? 503 : 200

  return NextResponse.json(response, { status: statusCode })
}
