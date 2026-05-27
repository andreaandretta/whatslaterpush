'use client';

import { useEffect, useState } from 'react';

interface SlaResponse {
  since: '24h' | '7d' | '30d';
  totals: {
    sent: number;
    failed: number;
    on_time_pct: number;
    late_pct: number;
    very_late_pct: number;
    failure_rate_pct: number;
    avg_drift_ms: number;
    delivery_rate_pct: number;
    read_rate_pct: number;
  };
  counts: {
    on_time: number;
    late: number;
    very_late: number;
    sent_total: number;
    delivered: number;
    read: number;
  };
  daily: Array<{ day: string; sent: number; on_time: number; late: number; very_late: number }>;
}

const RANGES: Array<{ value: '24h' | '7d' | '30d'; label: string }> = [
  { value: '24h', label: 'Ultime 24h' },
  { value: '7d', label: 'Ultimi 7 giorni' },
  { value: '30d', label: 'Ultimi 30 giorni' },
];

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

export function SlaSection({ secret }: { secret: string }) {
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('24h');
  const [data, setData] = useState<SlaResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!secret) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/admin/sla?since=${range}&secret=${encodeURIComponent(secret)}`)
      .then(async (r) => {
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setErr(body.error || 'Errore fetch SLA');
          setLoading(false);
          return;
        }
        setData(body as SlaResponse);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(e?.message || 'Errore di rete');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [range, secret]);

  return (
    <section className="mb-12">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-800">SLA monitoring</h2>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRange(r.value)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                range === r.value ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm mb-4">{err}</div>
      )}
      {loading && !data && (
        <div className="text-sm text-gray-500">Caricamento…</div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <KpiCard
              label="On-time delivery"
              value={`${data.totals.on_time_pct}%`}
              sub={`${data.counts.on_time}/${data.totals.sent} entro 1 min`}
              tone={data.totals.on_time_pct >= 95 ? 'good' : data.totals.on_time_pct >= 80 ? 'warn' : 'bad'}
            />
            <KpiCard
              label="Drift medio"
              value={formatMs(data.totals.avg_drift_ms)}
              sub={`${data.totals.late_pct}% late, ${data.totals.very_late_pct}% very late`}
              tone={data.totals.avg_drift_ms < 60_000 ? 'good' : data.totals.avg_drift_ms < 300_000 ? 'warn' : 'bad'}
            />
            <KpiCard
              label="Read rate"
              value={`${data.totals.read_rate_pct}%`}
              sub={`${data.counts.read}/${data.counts.delivered} consegnati letti · delivery ${data.totals.delivery_rate_pct}%`}
              tone="neutral"
            />
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-3 py-2">Giorno</th>
                  <th className="text-right px-3 py-2">Inviati</th>
                  <th className="text-right px-3 py-2">On time</th>
                  <th className="text-right px-3 py-2">Late</th>
                  <th className="text-right px-3 py-2">Very late</th>
                </tr>
              </thead>
              <tbody>
                {data.daily.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-gray-500 py-4">
                      Nessun evento negli ultimi 7 giorni
                    </td>
                  </tr>
                )}
                {data.daily.map((d) => (
                  <tr key={d.day} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium text-gray-700">{d.day}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.sent}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-700">{d.on_time}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-700">{d.late}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-700">{d.very_late}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.totals.failure_rate_pct > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              Fail rate (msg falliti / msg tentati): {data.totals.failure_rate_pct}% — {data.totals.failed} eventi message_failed nel periodo.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
}) {
  const colors: Record<typeof tone, string> = {
    good: 'text-green-700',
    warn: 'text-amber-700',
    bad: 'text-red-700',
    neutral: 'text-gray-800',
  };
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colors[tone]}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{sub}</p>
    </div>
  );
}
