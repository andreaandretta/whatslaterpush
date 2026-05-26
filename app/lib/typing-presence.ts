// Pre-send typing simulation. Calls Evolution's /chat/sendPresence with
// presence=composing, waits for the computed delay, then returns control to
// the caller which sends the real message. The recipient sees the "is typing…"
// indicator for a duration roughly proportional to the message length, which:
//   1) reduces anti-burst signals to WhatsApp (looks like a human, not a bot)
//   2) gives a more natural UX (the contact sees activity before the message)

const PRESENCE_TIMEOUT_MS = 5000;
const MS_PER_CHAR = 50;
const MAX_TYPING_MS = 4000;

// Linear typing duration capped at MAX_TYPING_MS. A 30-char message yields 1.5s;
// anything ≥80 chars caps at the 4s ceiling. Tuned to fit within Vercel Hobby's
// 8s lambda budget alongside the existing intra-batch jitter (800-2500ms).
export function computeTypingDelay(messageLength: number): number {
  if (!Number.isFinite(messageLength) || messageLength <= 0) return 0;
  return Math.min(Math.floor(messageLength) * MS_PER_CHAR, MAX_TYPING_MS);
}

export interface TypingPresenceArgs {
  evoUrl: string;
  evoKey: string;
  instanceName: string;
  recipientJid: string;
  typingMs: number;
}

// Fire-and-await the composing presence call. Returns { ok } so the caller
// can log/skip without crashing. Network/timeout/5xx all map to ok=false —
// the caller proceeds to send the real message regardless.
export async function sendTypingPresence(args: TypingPresenceArgs): Promise<{ ok: boolean; status?: number }> {
  const { evoUrl, evoKey, instanceName, recipientJid, typingMs } = args;
  if (typingMs <= 0) return { ok: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PRESENCE_TIMEOUT_MS);
  try {
    const res = await fetch(`${evoUrl}/chat/sendPresence/${instanceName}`, {
      method: 'POST',
      headers: { 'apikey': evoKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: recipientJid, presence: 'composing', delay: typingMs }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn('TYPING: presence call failed status=' + res.status + ' inst=' + instanceName);
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    console.warn('TYPING: presence call threw ' + (err as Error)?.message);
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}
