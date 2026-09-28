import { NextRequest, NextResponse } from 'next/server';
import { logAuditEvent } from '../../../lib/audit';
import { stampHeartbeat } from '../../../lib/heartbeat';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';

export const dynamic = 'force-dynamic';
// GET/RPC deterministico su supabase-js: la Next Data Cache lo congelerebbe
// (bug storico stress-index/reset-quote). force-no-store la disattiva. (Task 42)
export const fetchCache = 'force-no-store';

const BUCKET = 'message-media';
const RETENTION_DAYS = 30;
// Vercel Hobby cap is 10s; 100 rows per run keeps the Storage round-trip and
// the IN-list UPDATE well under budget. Cron runs weekly so backlog drains
// even if a Sunday is skipped.
const BATCH_SIZE = 100;


export interface CleanupResult {
  status: 'ok' | 'noop';
  candidates: number;
  removed_storage: number;
  nullified_rows: number;
  skipped_in_use: number;
}

// H8: partition candidate terminal rows into removable vs in-use. A media_url
// still referenced by a LIVE row (in `inUse`) must NOT be removed — recurring
// chains share one file across occurrences, so deleting a >30d 'sent' copy would
// break the live future occurrence. Duplicate media_urls collapse to one path.
export function partitionRemovableMedia(
  candidates: Array<{ id: string; media_url: string }>,
  inUse: Set<string>,
): { removablePaths: string[]; removableIds: string[]; skipped: number } {
  const removable = candidates.filter((c) => c.media_url && !inUse.has(c.media_url));
  return {
    removablePaths: Array.from(new Set(removable.map((c) => c.media_url))),
    removableIds: removable.map((c) => c.id),
    skipped: candidates.length - removable.length,
  };
}

export async function runMediaCleanup(): Promise<CleanupResult> {
  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // updated_at (trigger BEFORE UPDATE) oltre a created_at (audit 25 set 2026):
  // un promemoria programmato >30 gg prima e fallito IERI era già candidato,
  // e la domenica dopo perdeva l'allegato; il "Riprova" del lunedì partiva col
  // solo testo (o vuoto) senza avvisare nessuno. Ora un 'failed' resta intero
  // per 30 gg dal suo ultimo aggiornamento. Per 'sent' il ritardo massimo è
  // quello delle ricevute (delivered/read aggiornano la riga): trascurabile.
  const { data: candidates, error: selErr } = await supabase
    .from('scheduled_messages')
    .select('id, media_url')
    .in('status', ['sent', 'cancelled', 'failed'])
    .not('media_url', 'is', null)
    .lt('created_at', cutoff)
    .lt('updated_at', cutoff)
    .limit(BATCH_SIZE);

  if (selErr) throw new Error('cleanup-media select failed: ' + selErr.message);
  const rows = (candidates || []) as Array<{ id: string; media_url: string }>;

  if (rows.length === 0) {
    return { status: 'noop', candidates: 0, removed_storage: 0, nullified_rows: 0, skipped_in_use: 0 };
  }

  const allPaths = rows.map(r => r.media_url).filter(Boolean);

  // H8: exclude media still referenced by a LIVE (non-terminal) row. Recurring
  // chains reuse one media_url across occurrences, so a >30d 'sent' copy can share
  // its storage file with a future pending occurrence — removing it would break
  // the live chain (createSignedUrl -> 'Failed to sign media URL' forever).
  const { data: inUseRows, error: inUseErr } = await supabase.rpc('recurring_media_in_use', { p_paths: allPaths });
  if (inUseErr) throw new Error('cleanup-media in-use check failed: ' + inUseErr.message);
  const inUse = new Set<string>(((inUseRows || []) as Array<{ media_url: string }>).map((r) => r.media_url));

  // "Duplica" riusa lo stesso file (audit 28 set 2026): una copia recente, anche
  // già inviata o fallita, lo tiene vivo finché non ha anche lei 30 giorni.
  // Altrimenti il suo "Riprova" o una nuova "Duplica" partirebbero con un
  // allegato che non esiste più.
  const { data: recentRefs, error: recentErr } = await supabase
    .from('scheduled_messages')
    .select('media_url')
    .in('media_url', allPaths)
    .or(`created_at.gte.${cutoff},updated_at.gte.${cutoff}`);
  if (recentErr) throw new Error('cleanup-media recent-reference check failed: ' + recentErr.message);
  for (const r of (recentRefs || []) as Array<{ media_url: string | null }>) {
    if (r.media_url) inUse.add(r.media_url);
  }

  const { removablePaths, removableIds, skipped } = partitionRemovableMedia(rows, inUse);

  if (removablePaths.length === 0) {
    // Whole batch still referenced by live rows (e.g. active recurring media) —
    // nothing to free this run; they'll be cleaned once their chains end.
    return { status: 'ok', candidates: rows.length, removed_storage: 0, nullified_rows: 0, skipped_in_use: skipped };
  }

  // Storage remove first: if Storage fails we abort and retry next week.
  // The DB still references the (now possibly-deleted) path until cleared,
  // which is safe — send-messages only signs URLs at send time and these rows
  // are already in terminal state (sent/cancelled/failed).
  const { error: storageErr } = await supabase.storage.from(BUCKET).remove(removablePaths);
  if (storageErr) throw new Error('cleanup-media storage remove failed: ' + storageErr.message);

  const { error: updErr } = await supabase
    .from('scheduled_messages')
    .update({
      media_url: null,
      media_type: null,
      media_filename: null,
      media_caption: null,
    })
    .in('id', removableIds);
  if (updErr) throw new Error('cleanup-media update failed: ' + updErr.message);

  await logAuditEvent({
    eventType: 'media_cleanup',
    payload: { removed_count: removableIds.length, skipped_in_use: skipped, batch_size: BATCH_SIZE },
  });

  return {
    status: 'ok',
    candidates: rows.length,
    removed_storage: removablePaths.length,
    nullified_rows: removableIds.length,
    skipped_in_use: skipped,
  };
}

// ── Upload orfani ────────────────────────────────────────────────────────────
// Il file si carica PRIMA che esista la riga (upload/route.ts, upload/sign):
// modale chiusa, file sostituito, POST rifiutato → l'oggetto resta nel bucket
// per sempre, perché la pulizia sopra cammina solo su scheduled_messages. In
// prod il 25 set: 6 file su 11 orfani, circolari e PDF di clienti caricati 3
// volte. Qui: tutti gli oggetti <telefono>/<file> più vecchi della soglia che
// NESSUNA riga (di qualsiasi stato) referenzia. La soglia lascia margine a una
// modale rimasta aperta; i file referenziati li gestisce la retention a 30 gg.
export const ORPHAN_MIN_AGE_HOURS = 48;
const ORPHAN_SCAN_CAP = 500; // budget del cron: il resto la domenica dopo
const LIST_PAGE = 1000;

export interface OrphanSweepResult { scanned: number; orphans: number; removed: number }

export async function sweepOrphanUploads(nowMs: number = Date.now()): Promise<OrphanSweepResult> {
  const supabase = getSupabaseAdmin();
  const cutoffMs = nowMs - ORPHAN_MIN_AGE_HOURS * 60 * 60 * 1000;

  // Primo livello: le cartelle per telefono (Storage le restituisce con id null).
  const { data: top, error: topErr } = await supabase.storage.from(BUCKET).list('', { limit: LIST_PAGE });
  if (topErr) throw new Error('orphan sweep list failed: ' + topErr.message);
  const folders = ((top || []) as Array<{ name: string; id: string | null }>).filter((e) => e.name && e.id === null);

  let scanned = 0;
  const oldPaths: string[] = [];
  for (const folder of folders) {
    if (scanned >= ORPHAN_SCAN_CAP) break;
    const { data: files, error: listErr } = await supabase.storage.from(BUCKET).list(folder.name, {
      limit: LIST_PAGE,
      sortBy: { column: 'created_at', order: 'asc' },
    });
    if (listErr) throw new Error('orphan sweep list failed: ' + listErr.message);
    for (const f of (files || []) as Array<{ name: string; id: string | null; created_at?: string | null }>) {
      if (!f.name || f.id === null) continue; // sotto-cartelle: non le creiamo noi
      scanned++;
      const created = f.created_at ? new Date(f.created_at).getTime() : NaN;
      // Data ignota = non provato vecchio → si tiene.
      if (Number.isFinite(created) && created < cutoffMs) oldPaths.push(folder.name + '/' + f.name);
      if (scanned >= ORPHAN_SCAN_CAP) break;
    }
  }
  if (oldPaths.length === 0) return { scanned, orphans: 0, removed: 0 };

  // Qualsiasi riga, anche cancelled/failed/sent: se la riga c'è il file lo
  // gestisce la retention sopra. Errore di query → nessuna cancellazione.
  const { data: refs, error: refErr } = await supabase
    .from('scheduled_messages')
    .select('media_url')
    .in('media_url', oldPaths);
  if (refErr) throw new Error('orphan sweep reference check failed: ' + refErr.message);
  const referenced = new Set(((refs || []) as Array<{ media_url: string | null }>).map((r) => r.media_url));
  const orphans = oldPaths.filter((p) => !referenced.has(p));
  if (orphans.length === 0) return { scanned, orphans: 0, removed: 0 };

  const { error: rmErr } = await supabase.storage.from(BUCKET).remove(orphans);
  if (rmErr) throw new Error('orphan sweep remove failed: ' + rmErr.message);

  await logAuditEvent({
    eventType: 'media_orphan_cleanup',
    payload: { removed_count: orphans.length, scanned, min_age_hours: ORPHAN_MIN_AGE_HOURS },
  });
  return { scanned, orphans: orphans.length, removed: orphans.length };
}

export async function GET(req: NextRequest) {
  // Accept CRON_SECRET via `Authorization: Bearer` header (what Vercel Cron
  // sends) OR the legacy ?secret= query — matching send-messages. Reading only
  // the query 401'd every scheduled Vercel Cron run (#4).
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? new URL(req.url).searchParams.get('secret');
  if (!provided || provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  void stampHeartbeat('cleanup-media'); // Task 56 (#6)

  try {
    const result = await runMediaCleanup();
    // Best-effort e separato: un errore sugli orfani non deve far fallire la
    // retention (né viceversa); si riprova la domenica dopo.
    let orphans: OrphanSweepResult | { error: string };
    try {
      orphans = await sweepOrphanUploads();
    } catch (e: any) {
      console.error('[cleanup-media] orphan sweep failed:', e?.message || e);
      orphans = { error: e?.message || 'orphan sweep failed' };
    }
    return NextResponse.json({ ...result, orphans });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'cleanup failed' }, { status: 500 });
  }
}
