'use client';

// WhatsLater "Torre di Controllo" — admin-only operational dashboard.
// Auth: middleware.ts 404s this /admin/* page for non-admins (ADMIN_PHONES);
// data comes from /api/admin/tower (requireAdmin). OPS_SECRET never reaches here.
//
// Layout (two columns on lg+):
//   LEFT  — Sezione 1: utenti e code (plan / connessione / quota / pending / 24h)
//   RIGHT — Sezione 2: capacità stack (droplet RAM, Evolution, Coolify, health)
//           Sezione 3: proiezione 15 giorni (quando RAM > 85% a +X utenti/sett)

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface TowerUser {
  phone_number: string;
  display_name: string | null;
  subscription_plan: string;
  connection_status: string;
  messages_sent_today: number;
  trial_ends_at: string | null;
  last_disconnect_code: number | null;
  last_disconnect_at: string | null;
  pending: number;
  sent_24h: number;
}
interface DropletSnap { ram_percent: number; cpu_percent: number; disk_percent: number; uptime_seconds: number; }
interface EvoInstance { name: string; connection_status: string; number: string; messages: number; contacts: number; chats: number; }
interface EvolutionSnap { count: number; open: number; instances: EvoInstance[]; }
interface CoolifyResource { kind: string; name: string; status: string; }
interface CoolifySnap { count: number; resources: CoolifyResource[]; }
interface HealthSnap {
  status: string;
  services: Record<string, boolean>;
  queue: { pending_overdue_5min: number; critical: boolean };
  instances: { disconnected_30min: number; critical: boolean };
}
interface TowerData {
  ok: boolean;
  generated_at: string;
  users: TowerUser[];
  users_error: string | null;
  droplet: DropletSnap | null;
  evolution: EvolutionSnap | null;
  coolify: CoolifySnap | null;
  health: HealthSnap | null;
}

// Daily message caps per tier — mirror app/lib/plans.ts.
const PLAN_CAPS: Record<string, number> = { free: 3, trial: 20, personal: 20, professional: 35, business: 50 };
const PLAN_LABEL: Record<string, string> = { free: 'Free', trial: 'Trial', personal: 'Personal', professional: 'Professional', business: 'Business' };

// Droplet RAM model — keep in sync with /api/ops/stress-index constants.
const DROPLET_RAM_MB = 2048;
const EST_MB_PER_INSTANCE = 50;
const PCT_PER_INSTANCE = (EST_MB_PER_INSTANCE / DROPLET_RAM_MB) * 100; // ~2.44%/utente
const RAM_WARN = 70;
const RAM_CRIT = 85;

// --- small presentational helpers ---

function connDotClass(status: string): string {
  if (status === 'open') return 'bg-green-500';
  if (status === 'connecting') return 'bg-yellow-500';
  return 'bg-red-500'; // close | refused | unknown
}
function connLabel(status: string): string {
  if (status === 'open') return 'Connesso';
  if (status === 'connecting') return 'In connessione';
  if (status === 'refused') return 'Rifiutato';
  if (status === 'close') return 'Disconnesso';
  return status || '—';
}
function ramText(pct: number): string {
  return pct >= RAM_CRIT ? 'text-red-600' : pct >= RAM_WARN ? 'text-yellow-600' : 'text-green-600';
}
function ramBarBg(pct: number): string {
  return pct >= RAM_CRIT ? 'bg-red-500' : pct >= RAM_WARN ? 'bg-yellow-500' : 'bg-green-500';
}
function metricText(pct: number): string {
  return pct >= 80 ? 'text-red-600' : pct >= 50 ? 'text-yellow-600' : 'text-green-600';
}
function statusPillClass(status: string): string {
  const s = (status || '').toLowerCase();
  if (s.includes('healthy') || s.includes('running')) return 'bg-green-100 text-green-700';
  if (s.includes('exited') || s.includes('unhealthy') || s.includes('down')) return 'bg-red-100 text-red-700';
  return 'bg-gray-100 text-gray-600';
}
function fmtUptime(s: number): string {
  if (!s || s < 0) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  if (d > 0) return `${d}g ${h}h`;
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}
function trialDaysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}
function isBanRisk(code: number | null): boolean {
  return code === 401 || code === 403;
}

export default function TowerPage() {
  const router = useRouter();
  const [data, setData] = useState<TowerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('');
  const [rate, setRate] = useState(5); // nuovi utenti / settimana per la proiezione

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/tower', { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) { router.push('/'); return; }
      if (res.ok) {
        const json = (await res.json()) as TowerData;
        setData(json);
        setLastUpdate(new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      }
    } catch { /* silent; keep last good snapshot */ }
    setLoading(false);
  }, [router]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 60000); // refresh automatico 60s
    return () => clearInterval(id);
  }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const users = data?.users ?? [];
  const droplet = data?.droplet ?? null;
  const evolution = data?.evolution ?? null;
  const coolify = data?.coolify ?? null;
  const health = data?.health ?? null;

  // --- Sezione 3: proiezione ---
  const cur = droplet?.ram_percent ?? null;
  const safeUsers = cur == null ? null : Math.max(0, Math.floor((RAM_CRIT - cur) / PCT_PER_INSTANCE));
  const ramAtDay = (r: number, day: number) => (cur == null ? null : cur + PCT_PER_INSTANCE * r * (day / 7));
  const daysTo85 = (r: number): number | null => {
    if (cur == null) return null;
    if (cur >= RAM_CRIT) return 0;
    if (r <= 0) return Infinity;
    return (RAM_CRIT - cur) / (PCT_PER_INSTANCE * r / 7);
  };
  const projDays = daysTo85(rate);
  const projDate = projDays != null && isFinite(projDays)
    ? new Date(Date.now() + projDays * 86400000).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
    : null;
  const ram15 = ramAtDay(rate, 15);
  const verdictText = ram15 == null ? 'text-gray-500' : ramText(ram15);
  const verdictLabel = ram15 == null ? 'n/d' : ram15 >= RAM_CRIT ? 'A rischio OOM' : ram15 >= RAM_WARN ? 'Sotto pressione' : 'Margine ampio';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <a href="/admin" className="text-sm text-gray-500 hover:text-gray-900">&larr; Admin</a>
          <h1 className="text-xl font-bold text-gray-900">Torre di Controllo</h1>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>Agg: {lastUpdate || '—'}</span>
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
        </div>
      </header>

      <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 max-w-7xl mx-auto">
        {/* ===================== COLONNA SINISTRA — SEZIONE 1 ===================== */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-gray-900">Utenti e code</h2>
            <span className="text-sm text-gray-500">{users.length} istanze · {users.filter(u => u.connection_status === 'open').length} connesse</span>
          </div>
          {data?.users_error && (
            <p className="text-xs text-red-600 mb-2">Errore dati utenti: {data.users_error}</p>
          )}
          <div className="space-y-2">
            {users.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">Nessuna istanza.</p>}
            {users.map((u) => {
              const cap = PLAN_CAPS[u.subscription_plan] ?? 0;
              const capPct = cap > 0 ? Math.min(100, (u.messages_sent_today / cap) * 100) : 0;
              const tdl = trialDaysLeft(u.trial_ends_at);
              const ban = isBanRisk(u.last_disconnect_code);
              return (
                <div key={u.phone_number} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`shrink-0 h-2.5 w-2.5 rounded-full ${connDotClass(u.connection_status)}`} title={connLabel(u.connection_status)} />
                      <span className="font-mono text-sm text-gray-900 truncate">{u.phone_number}</span>
                      <span className="shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{PLAN_LABEL[u.subscription_plan] ?? u.subscription_plan}</span>
                      {ban && <span className="shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700" title={`Disconnect code ${u.last_disconnect_code}`}>ban-risk {u.last_disconnect_code}</span>}
                    </div>
                    <span className="shrink-0 text-xs text-gray-500">{connLabel(u.connection_status)}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[11px] text-gray-400 uppercase tracking-wide">Oggi</p>
                      <p className={`text-sm font-bold ${capPct >= 100 ? 'text-red-600' : capPct >= 80 ? 'text-yellow-600' : 'text-gray-900'}`}>{u.messages_sent_today}<span className="text-gray-400 font-normal">/{cap || '—'}</span></p>
                    </div>
                    <div>
                      <p className="text-[11px] text-gray-400 uppercase tracking-wide">In coda</p>
                      <p className={`text-sm font-bold ${u.pending > 0 ? 'text-blue-600' : 'text-gray-900'}`}>{u.pending}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-gray-400 uppercase tracking-wide">24h</p>
                      <p className="text-sm font-bold text-gray-900">{u.sent_24h}</p>
                    </div>
                  </div>
                  {cap > 0 && (
                    <div className="mt-2 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full ${capPct >= 100 ? 'bg-red-500' : capPct >= 80 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${capPct}%` }} />
                    </div>
                  )}
                  {u.subscription_plan === 'trial' && tdl != null && (
                    <p className={`mt-2 text-[11px] ${tdl <= 0 ? 'text-red-600' : tdl <= 2 ? 'text-yellow-600' : 'text-gray-400'}`}>
                      {tdl <= 0 ? 'Trial scaduto' : `Trial: ${tdl} giorni rimasti`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ===================== COLONNA DESTRA ===================== */}
        <div className="space-y-4 sm:space-y-6">
          {/* SEZIONE 2 — capacità stack */}
          <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <h2 className="text-lg font-bold text-gray-900 mb-3">Capacità stack</h2>

            {/* Droplet */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-gray-700">Droplet (2GB · 1 vCPU)</span>
                <span className="text-xs text-gray-400">uptime {droplet ? fmtUptime(droplet.uptime_seconds) : '—'}</span>
              </div>
              {droplet ? (
                <>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-[11px] text-gray-400 uppercase tracking-wide">RAM</p>
                      <p className={`text-2xl font-bold ${ramText(droplet.ram_percent)}`}>{droplet.ram_percent}%</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-gray-400 uppercase tracking-wide">CPU</p>
                      <p className={`text-2xl font-bold ${metricText(droplet.cpu_percent)}`}>{droplet.cpu_percent}%</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-gray-400 uppercase tracking-wide">Disco</p>
                      <p className={`text-2xl font-bold ${metricText(droplet.disk_percent)}`}>{droplet.disk_percent}%</p>
                    </div>
                  </div>
                  <div className="mt-2 h-2 w-full bg-gray-100 rounded-full overflow-hidden relative">
                    <div className={`h-full ${ramBarBg(droplet.ram_percent)}`} style={{ width: `${droplet.ram_percent}%` }} />
                    {/* soglia 85% */}
                    <div className="absolute top-0 h-full border-r-2 border-red-400" style={{ left: `${RAM_CRIT}%` }} title="Soglia critica 85%" />
                  </div>
                </>
              ) : <p className="text-sm text-gray-400">Metriche droplet non disponibili (n/d)</p>}
            </div>

            {/* Evolution */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-gray-700">Evolution API</span>
                <span className="text-xs text-gray-400">{evolution ? `${evolution.open}/${evolution.count} aperte` : 'n/d'}</span>
              </div>
              {evolution ? (
                <div className="space-y-1">
                  {evolution.instances.map((i) => (
                    <div key={i.name} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className={`shrink-0 h-2 w-2 rounded-full ${connDotClass(i.connection_status)}`} />
                        <span className="font-mono text-gray-700 truncate">{i.number || i.name}</span>
                      </span>
                      <span className="text-gray-400 shrink-0">{i.messages} msg · {i.contacts} contatti</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">n/d</p>}
            </div>

            {/* Coolify */}
            <div className="mb-4">
              <span className="text-sm font-semibold text-gray-700">Coolify</span>
              {coolify ? (
                <div className="mt-1 space-y-1">
                  {coolify.resources.map((r) => (
                    <div key={r.name} className="flex items-center justify-between text-xs gap-2">
                      <span className="text-gray-600 truncate">{r.kind === 'service' ? '🟢' : '📦'} {r.name.split('-')[0]}</span>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded font-semibold ${statusPillClass(r.status)}`}>{r.status}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">n/d</p>}
            </div>

            {/* Health */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-gray-700">Health</span>
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${health?.status === 'healthy' || health?.status === 'ok' ? 'bg-green-100 text-green-700' : health ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>{health?.status ?? 'n/d'}</span>
              </div>
              {health ? (
                <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
                  <span>DB: {health.services?.database ? '✅' : '❌'}</span>
                  <span>Evolution: {health.services?.evolution ? '✅' : '❌'}</span>
                  <span>OpenAI: {health.services?.openai ? '✅' : '❌'}</span>
                  <span>Coda overdue: <span className={health.queue?.critical ? 'text-red-600 font-semibold' : ''}>{health.queue?.pending_overdue_5min ?? 0}</span></span>
                  <span>Disc. 30min: <span className={health.instances?.critical ? 'text-red-600 font-semibold' : ''}>{health.instances?.disconnected_30min ?? 0}</span></span>
                </div>
              ) : <p className="text-sm text-gray-400">n/d</p>}
            </div>
          </section>

          {/* SEZIONE 3 — proiezione 15 giorni */}
          <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-gray-900">Proiezione capacità</h2>
              <div className="flex items-center gap-1">
                {[2, 5, 10].map((r) => (
                  <button
                    key={r}
                    onClick={() => setRate(r)}
                    className={`text-xs font-semibold px-2 py-1 rounded ${rate === r ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >+{r}/sett</button>
                ))}
              </div>
            </div>

            {cur == null ? (
              <p className="text-sm text-gray-400">Proiezione non disponibile senza metriche droplet.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-[11px] text-gray-400 uppercase tracking-wide">RAM attuale</p>
                    <p className={`text-2xl font-bold ${ramText(cur)}`}>{cur}%</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-[11px] text-gray-400 uppercase tracking-wide">Utenti prima di 85%</p>
                    <p className="text-2xl font-bold text-gray-900">{safeUsers ?? '—'}</p>
                  </div>
                </div>

                <div className={`rounded-lg p-3 mb-3 ${ram15 != null && ram15 >= RAM_CRIT ? 'bg-red-50' : ram15 != null && ram15 >= RAM_WARN ? 'bg-yellow-50' : 'bg-green-50'}`}>
                  <p className="text-sm text-gray-700">
                    A <strong>+{rate} utenti/settimana</strong>, RAM 85% prevista{' '}
                    {projDays == null ? '—' : projDays === 0 ? <strong className="text-red-600">già superata</strong> : !isFinite(projDays) ? 'mai a questo ritmo' : (
                      <><strong>tra ~{Math.round(projDays)} giorni</strong>{projDate ? ` (${projDate})` : ''}</>
                    )}.
                  </p>
                  <p className={`text-sm font-bold mt-1 ${verdictText}`}>Esito 15 giorni: {verdictLabel}{ram15 != null ? ` (RAM ~${Math.round(ram15)}%)` : ''}</p>
                </div>

                {/* curva 7 / 15 / 30 giorni */}
                <div className="space-y-2">
                  {[7, 15, 30].map((day) => {
                    const v = ramAtDay(rate, day);
                    const vc = v == null ? 0 : Math.min(100, Math.max(0, v));
                    return (
                      <div key={day} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-12 shrink-0">{day}gg</span>
                        <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden relative">
                          <div className={`h-full ${v != null ? ramBarBg(v) : 'bg-gray-300'}`} style={{ width: `${vc}%` }} />
                          <div className="absolute top-0 h-full border-r-2 border-red-400" style={{ left: `${RAM_CRIT}%` }} />
                        </div>
                        <span className={`text-xs font-semibold w-10 text-right shrink-0 ${v != null ? ramText(v) : 'text-gray-400'}`}>{v != null ? `${Math.round(v)}%` : '—'}</span>
                      </div>
                    );
                  })}
                </div>

                <p className="mt-3 text-[11px] text-gray-400">
                  Modello: ~{EST_MB_PER_INSTANCE}MB ({PCT_PER_INSTANCE.toFixed(1)}%) per istanza su {DROPLET_RAM_MB / 1024}GB.
                  Soglie: <span className="text-green-600 font-semibold">verde &lt;{RAM_WARN}%</span> · <span className="text-yellow-600 font-semibold">giallo {RAM_WARN}–{RAM_CRIT}%</span> · <span className="text-red-600 font-semibold">rosso &ge;{RAM_CRIT}%</span>.
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
