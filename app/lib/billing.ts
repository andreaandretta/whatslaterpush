/**
 * Billing kill-switch for the free beta (decision 2026-07-07).
 *
 * SERVER-ONLY — never import this from 'use client' components: in the
 * browser bundle process.env.BILLING_ENABLED is inlined to undefined, so the
 * predicate would always report "billing on". The client learns the effective
 * plan from the GET /api/messages payload instead (subscription_plan =
 * effective, raw_plan = stored).
 *
 * Contract (docs/RUNBOOK-riattivazione-billing.md):
 * - env unset, or any value other than the exact string 'false' → billing
 *   ENFORCED (safe default; opt-out idiom, same as MONITORING_ALERTS_ENABLED).
 * - BILLING_ENABLED='false' → beta mode: every user resolves to the synthetic
 *   'beta' plan (registered in PLANS; never persisted — the DB CHECK
 *   constraint on subscription_plan rejects it by design).
 * - Reactivation = delete the env + redeploy, then follow the runbook.
 */

export const BETA_PLAN = 'beta';

export function isBillingEnabled(): boolean {
  return process.env.BILLING_ENABLED !== 'false';
}

/**
 * The plan whose limits actually apply. Billing on → the stored plan
 * (fallback 'free', mirroring the `|| 'free'` at today's call sites); billing
 * off → the synthetic beta plan for everyone. Returns a NEW value: never
 * write it back into the DB row's subscription_plan (an UPDATE with 'beta'
 * violates the CHECK constraint — that constraint is the physical enforcement
 * of "beta is runtime-only").
 */
export function getEffectivePlan(rawPlan: string | null | undefined): string {
  if (!isBillingEnabled()) return BETA_PLAN;
  return rawPlan || 'free';
}
