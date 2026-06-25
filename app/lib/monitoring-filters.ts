// Test-instance / test-number filtering for the monitoring checks.
//
// Goal (Round 7 "alert affilati"): pre-launch, when the only connected numbers
// are the operator's own test phones, monitoring must stay SILENT. Once real
// users connect, alerts fire only on real, non-test instances.
//
// An instance counts as a TEST instance if ANY of the following match:
//   1. instance_name starts with a configured test prefix
//      (default "wltest", override/extend with MONITORING_TEST_PREFIXES).
//   2. instance_name is listed verbatim in MONITORING_TEST_INSTANCES.
//   3. the digits of the instance_name OR the owner phone contain a fragment
//      listed in MONITORING_TEST_NUMBERS. This covers today's
//      SchedWhats-<phone> test instances (e.g. the burned 393780311526) until
//      they are renamed to the wltest* convention.
//
// All three are comma-separated env vars; whitespace is trimmed and matching is
// case-insensitive. With none set, only the default "wltest" prefix applies —
// so the convention works out of the box while staying fully configurable.

function csv(envVar: string | undefined): string[] {
  return (envVar || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getTestPrefixes(): string[] {
  const configured = csv(process.env.MONITORING_TEST_PREFIXES).map((s) => s.toLowerCase());
  // Always include the canonical "wltest" prefix, even when the operator adds
  // extra prefixes via the env var — they extend, not replace, the default.
  if (!configured.includes('wltest')) configured.push('wltest');
  return configured;
}

export function getTestInstanceNames(): string[] {
  return csv(process.env.MONITORING_TEST_INSTANCES).map((s) => s.toLowerCase());
}

export function getTestNumbers(): string[] {
  // Keep digits only so callers can list numbers in any format (+39…, 39…, etc.)
  return csv(process.env.MONITORING_TEST_NUMBERS)
    .map((s) => s.replace(/\D/g, ''))
    .filter(Boolean);
}

/**
 * True when an instance should be EXCLUDED from monitoring alerts because it is
 * a test/throwaway instance (not a real user).
 *
 * @param instanceName e.g. "wltest-1" or "SchedWhats-393780311526"
 * @param ownerPhone   optional owner phone, used for MONITORING_TEST_NUMBERS
 */
export function isTestInstance(instanceName?: string | null, ownerPhone?: string | null): boolean {
  const name = (instanceName || '').trim().toLowerCase();

  if (name) {
    if (getTestPrefixes().some((p) => p && name.startsWith(p))) return true;
    if (getTestInstanceNames().includes(name)) return true;
  }

  // Number match: SUFFIX (or exact) against the name's digits and the owner phone
  // SEPARATELY — never a concatenated haystack (which could match across the
  // name↔phone boundary). Require >= 7 digits so a short fragment can't collide
  // with a real customer's number and silently mute their alerts.
  const numbers = getTestNumbers().filter((n) => n.length >= 7);
  if (numbers.length) {
    const nameDigits = String(instanceName || '').replace(/\D/g, '');
    const phoneDigits = String(ownerPhone || '').replace(/\D/g, '');
    const matchesSuffix = (hay: string, n: string) => hay.length >= n.length && hay.endsWith(n);
    if (numbers.some((n) => matchesSuffix(nameDigits, n) || matchesSuffix(phoneDigits, n))) return true;
  }

  return false;
}
