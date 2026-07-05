// Single source of truth for the Coolify API base URL (control-tower /api/ops/*
// proxies + ops-worker cron).
//
// NO hardcoded fallback, ON PURPOSE (runbook §8.1): every consumer used to fall
// back to `http://161.35.212.68:8000` — the DigitalOcean droplet DESTROYED on
// 2026-07-05. DigitalOcean recycles IPs to third parties, so any code path that
// silently fell back there would hand our Bearer COOLIFY_API_TOKEN to an unknown
// host. If COOLIFY_API_URL is missing we fail LOUD (null → caller answers 500 /
// marks the ops command failed) instead of failing dangerous.
export const COOLIFY_NOT_CONFIGURED = 'COOLIFY_API_URL not configured';

export function getCoolifyBase(): string | null {
  const raw = (process.env.COOLIFY_API_URL || '').trim();
  if (!raw) return null;
  // Normalize: no trailing slashes, callers append `/api/v1/...`.
  return raw.replace(/\/+$/, '');
}
