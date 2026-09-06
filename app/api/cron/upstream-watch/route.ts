import { NextRequest, NextResponse } from 'next/server';
import { sendAlertWithChannel } from '../../../lib/monitoring';
import { stampHeartbeat } from '../../../lib/heartbeat';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';

// Task 57 (tier pairing-resilience) — sentinella upstream.
//
// Il 28-29 lug 2026 WhatsApp ha cambiato il protocollo di collegamento e TUTTO
// l'ecosistema Baileys ha smesso di collegare dispositivi nuovi; noi l'abbiamo
// scoperto il 17 ago, a diagnosi già in corso. Questa sentinella settimanale
// confronta l'ultima release di Baileys ed Evolution con l'ultima vista
// (audit_events) e manda un'email informativa quando esce qualcosa: è il
// preavviso sia delle FIX (aggiorna la scialuppa p3) sia dei prossimi muri.
//
// GitHub API senza auth: 60 req/h per IP — a cadenza settimanale è irrilevante.

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const REPOS = [
  { repo: 'WhiskeySockets/Baileys', label: 'Baileys' },
  { repo: 'evolution-foundation/evolution-api', label: 'Evolution API' },
];

function authorized(req: NextRequest): boolean {
  const provided =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    req.nextUrl.searchParams.get('secret');
  return !!provided && !!process.env.CRON_SECRET && provided === process.env.CRON_SECRET;
}


export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  void stampHeartbeat('upstream-watch'); // Task 56 (#6)

  const supabase = getSupabaseAdmin();
  const news: string[] = [];
  const seen: Array<{ repo: string; tag: string }> = [];

  for (const { repo, label } of REPOS) {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'whatslater-upstream-watch' },
      });
      if (!res.ok) continue; // GH giù o repo rinominato: riproverà tra 7 giorni
      const rel = await res.json();
      const tag: string | undefined = rel?.tag_name;
      if (!tag) continue;

      const { data } = await supabase
        .from('audit_events')
        .select('payload')
        .eq('event_type', 'upstream_release_seen')
        .eq('payload->>repo', repo)
        .order('created_at', { ascending: false })
        .limit(1);
      const lastSeen: string | null = (data?.[0] as any)?.payload?.tag || null;
      if (lastSeen === tag) continue;

      await supabase.from('audit_events').insert({
        event_type: 'upstream_release_seen',
        payload: { repo, tag, name: rel?.name || null },
      });
      seen.push({ repo, tag });
      // Prima osservazione in assoluto: registra la baseline senza allarmare.
      if (lastSeen) news.push(`${label}: ${lastSeen} → ${tag}`);
    } catch {
      // rete/parse: silenzioso, ritenta al prossimo giro settimanale
    }
  }

  if (news.length > 0) {
    await sendAlertWithChannel(
      {
        name: 'upstream_release',
        status: 'warning',
        message: news.join(' · '),
        checked_at: new Date().toISOString(),
      },
      ['email']
    );
  }

  return NextResponse.json({ ok: true, news, seen });
}
