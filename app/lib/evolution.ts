// Shared Evolution-instance teardown. Extracted from app/api/auth/init and
// app/api/connect (where forceDeleteInstance was duplicated) so /api/auth/logout
// can reuse it. A dashboard "Disconnetti" must actually tear down the Evolution
// instance — not just clear the session cookie — otherwise the number stays
// user_instances.connection_status='open' and the anti-hijack guard in
// /api/auth/init (commit 6124075) blocks the legitimate owner from re-pairing
// their own number after logout ("Questo numero è già collegato").

export function instanceNameForPhone(phone: string): string {
  return `SchedWhats-${phone}`;
}

// Best-effort: logout (frees the Baileys socket + unlinks the WhatsApp device)
// then delete the Evolution instance. Tolerates every failure — the instance may
// already be gone or Evolution may be unreachable, and callers (logout, re-pair)
// must never depend on it succeeding. Mirrors the prior inline implementations:
// logout, wait, delete, wait (gives Evolution time to release the slot before a
// caller recreates the instance).
export async function forceDeleteInstance(name: string): Promise<void> {
  const evoUrl = process.env.EVOLUTION_API_URL;
  const evoKey = process.env.EVOLUTION_API_KEY;
  if (!evoUrl || !evoKey) return;
  try {
    await fetch(`${evoUrl}/instance/logout/${name}`, { method: 'DELETE', headers: { apikey: evoKey } });
  } catch { /* ignore — best effort */ }
  await new Promise(r => setTimeout(r, 500));
  try {
    await fetch(`${evoUrl}/instance/delete/${name}`, { method: 'DELETE', headers: { apikey: evoKey } });
  } catch { /* ignore — best effort */ }
  await new Promise(r => setTimeout(r, 1500));
}
