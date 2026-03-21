'use client';

import { Suspense, useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// --- Types ---

interface CheckResult {
  name: string;
  status: 'ok' | 'warning' | 'critical';
  message: string;
  checked_at: string;
}

interface AdminData {
  system: CheckResult[];
  business: {
    totalUsers: number;
    byPlan: { free: number; trial: number; personal: number; business: number };
    trialExpiring: { phone_number: string; trial_ends_at: string }[];
    trialChurned: { phone_number: string; trial_ends_at: string }[];
    mrr: number;
    recentUsers: { phone_number: string; subscription_plan: string; connection_status: string; created_at: string }[];
  };
  stripe: {
    recentPayments: { amount: number; plan: string; date: string; status: string }[];
    activeSubscriptions: number;
    failedPayments: { amount: number; date: string; error: string }[];
    monthlyRevenue: number;
  };
  alerts: { id: string; check_name: string; status: string; message: string; channel: string; created_at: string }[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

// --- Helpers ---

const STATUS_DOT: Record<string, string> = {
  ok: 'bg-green-500',
  warning: 'bg-yellow-500',
  critical: 'bg-red-500',
};

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-400',
  trial: 'bg-blue-400',
  personal: 'bg-green-500',
  business: 'bg-purple-600',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function fmtDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: 'short', year: 'numeric' });
}

// --- Component ---

export default function AdminPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="animate-spin w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full" /></div>}>
      <AdminPage />
    </Suspense>
  );
}

function AdminPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const secret = searchParams.get('secret') || '';

  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/data?secret=${encodeURIComponent(secret)}`);
      if (res.status === 401) { router.push('/'); return; }
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLastUpdate(new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [secret, router]);

  useEffect(() => {
    if (!secret) { router.push('/'); return; }
    fetchData();
    const interval = setInterval(fetchData, 300000);
    return () => clearInterval(interval);
  }, [secret, fetchData, router]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const askChat = async () => {
    const q = chatInput.trim();
    if (!q) return;
    setChatMessages(prev => [...prev.slice(-4), { role: 'user', text: q }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const res = await fetch('/api/admin/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, question: q }),
      });
      const json = await res.json();
      setChatMessages(prev => [...prev, { role: 'assistant', text: json.answer || 'Nessuna risposta.' }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', text: 'Errore di connessione.' }]);
    }
    setChatLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!data) return null;

  const { system, business, stripe, alerts } = data;
  const maxPlan = Math.max(business.byPlan.free, business.byPlan.trial, business.byPlan.personal, business.byPlan.business, 1);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <h1 className="text-xl font-bold text-gray-900">WhatsLater Admin</h1>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>Agg: {lastUpdate}</span>
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {/* SECTION 1 — SISTEMA */}
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-3">Sistema</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {system.map((c) => (
              <div key={c.name} className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[c.status] || 'bg-gray-400'}`} />
                  <span className="text-xs font-semibold text-gray-900">{c.name}</span>
                </div>
                <p className="text-[11px] text-gray-500 leading-tight">{c.message}</p>
              </div>
            ))}
          </div>

          {/* Chatbot */}
          <div className="mt-4 bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <p className="text-sm font-semibold text-gray-700 mb-2">Chiedi all&apos;assistente</p>
            {chatMessages.length > 0 && (
              <div className="mb-3 space-y-2 max-h-60 overflow-y-auto">
                {chatMessages.map((m, i) => (
                  <div key={i} className={`text-sm px-3 py-2 rounded-lg ${m.role === 'user' ? 'bg-blue-50 text-blue-900 ml-8' : 'bg-gray-50 text-gray-800 mr-8'}`}>
                    {m.text}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !chatLoading && askChat()}
                placeholder="Es: Quanti messaggi sono stati inviati oggi?"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                disabled={chatLoading}
              />
              <button
                onClick={askChat}
                disabled={chatLoading || !chatInput.trim()}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {chatLoading ? '...' : 'Chiedi'}
              </button>
            </div>
          </div>
        </section>

        {/* SECTION 2 — BUSINESS */}
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-3">Business & Clienti</h2>
          {/* KPI cards */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm text-center">
              <p className="text-3xl font-bold text-gray-900">{business.totalUsers}</p>
              <p className="text-xs text-gray-500 mt-1">Utenti totali</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm text-center">
              <p className="text-3xl font-bold text-green-600">&euro;{business.mrr.toFixed(2)}</p>
              <p className="text-xs text-gray-500 mt-1">MRR</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm text-center">
              <p className={`text-3xl font-bold ${business.trialExpiring.length > 0 ? 'text-yellow-600' : 'text-gray-900'}`}>{business.trialExpiring.length}</p>
              <p className="text-xs text-gray-500 mt-1">Trial in scadenza</p>
            </div>
          </div>

          {/* Plan distribution */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm mb-4">
            <p className="text-sm font-semibold text-gray-700 mb-3">Distribuzione piani</p>
            {(['free', 'trial', 'personal', 'business'] as const).map((plan) => (
              <div key={plan} className="flex items-center gap-3 mb-2">
                <span className="text-xs text-gray-600 w-16 capitalize">{plan}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${PLAN_COLORS[plan]}`}
                    style={{ width: `${(business.byPlan[plan] / maxPlan) * 100}%`, minWidth: business.byPlan[plan] > 0 ? '8px' : '0' }}
                  />
                </div>
                <span className="text-xs font-semibold text-gray-700 w-6 text-right">{business.byPlan[plan]}</span>
              </div>
            ))}
          </div>

          {/* Trial expiring */}
          {business.trialExpiring.length > 0 && (
            <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-4 shadow-sm mb-4">
              <p className="text-sm font-semibold text-yellow-800 mb-2">Trial in scadenza (7gg)</p>
              {business.trialExpiring.map((u, i) => (
                <p key={i} className="text-xs text-yellow-700">{u.phone_number} — scade {fmtDateShort(u.trial_ends_at)}</p>
              ))}
            </div>
          )}

          {/* Trial churned */}
          {business.trialChurned.length > 0 && (
            <div className="bg-red-50 rounded-lg border border-red-200 p-4 shadow-sm mb-4">
              <p className="text-sm font-semibold text-red-800 mb-2">Trial scaduti (non convertiti)</p>
              {business.trialChurned.map((u, i) => (
                <p key={i} className="text-xs text-red-700">{u.phone_number} — scaduto {fmtDateShort(u.trial_ends_at)}</p>
              ))}
            </div>
          )}

          {/* Recent users */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <p className="text-sm font-semibold text-gray-700 px-4 py-3 border-b border-gray-100">Ultimi 10 registrati</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500">
                    <th className="px-4 py-2">Telefono</th>
                    <th className="px-4 py-2">Piano</th>
                    <th className="px-4 py-2 hidden sm:table-cell">Stato</th>
                    <th className="px-4 py-2">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {business.recentUsers.map((u, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-4 py-2 text-xs font-mono">{u.phone_number}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs text-white ${PLAN_COLORS[u.subscription_plan] || 'bg-gray-400'}`}>{u.subscription_plan}</span>
                      </td>
                      <td className="px-4 py-2 hidden sm:table-cell">
                        <span className={`inline-block w-2 h-2 rounded-full mr-1 ${u.connection_status === 'open' ? 'bg-green-500' : 'bg-gray-300'}`} />
                        <span className="text-xs text-gray-600">{u.connection_status}</span>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">{u.created_at ? fmtDateShort(u.created_at) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SECTION 3 — STRIPE */}
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-3">Stripe</h2>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm text-center">
              <p className="text-3xl font-bold text-gray-900">{stripe.activeSubscriptions}</p>
              <p className="text-xs text-gray-500 mt-1">Abbonamenti attivi</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm text-center">
              <p className="text-3xl font-bold text-green-600">&euro;{stripe.monthlyRevenue.toFixed(2)}</p>
              <p className="text-xs text-gray-500 mt-1">Revenue mese</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm text-center">
              <p className={`text-3xl font-bold ${stripe.failedPayments.length > 0 ? 'text-red-600' : 'text-gray-900'}`}>{stripe.failedPayments.length}</p>
              <p className="text-xs text-gray-500 mt-1">Falliti</p>
            </div>
          </div>

          {/* Failed payments alert */}
          {stripe.failedPayments.length > 0 && (
            <div className="bg-red-50 rounded-lg border border-red-200 p-4 shadow-sm mb-4">
              <p className="text-sm font-semibold text-red-800 mb-2">Pagamenti falliti</p>
              {stripe.failedPayments.map((p, i) => (
                <p key={i} className="text-xs text-red-700">&euro;{p.amount.toFixed(2)} — {fmtDate(p.date)} — {p.error}</p>
              ))}
            </div>
          )}

          {/* Recent payments */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <p className="text-sm font-semibold text-gray-700 px-4 py-3 border-b border-gray-100">Ultimi 10 pagamenti</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500">
                    <th className="px-4 py-2">Data</th>
                    <th className="px-4 py-2">Importo</th>
                    <th className="px-4 py-2">Piano</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stripe.recentPayments.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-4 text-center text-gray-400 text-xs">Nessun pagamento</td></tr>
                  ) : stripe.recentPayments.map((p, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-4 py-2 text-xs text-gray-600">{fmtDate(p.date)}</td>
                      <td className="px-4 py-2 text-xs font-semibold">&euro;{p.amount.toFixed(2)}</td>
                      <td className="px-4 py-2 text-xs text-gray-600">{p.plan}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs text-white ${p.status === 'succeeded' ? 'bg-green-500' : 'bg-red-500'}`}>{p.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SECTION 4 — ALERT RECENTI */}
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-3">Alert Recenti</h2>
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500">
                    <th className="px-4 py-2">Ora</th>
                    <th className="px-4 py-2">Check</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Canale</th>
                    <th className="px-4 py-2 hidden sm:table-cell">Messaggio</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-4 text-center text-gray-400 text-xs">Nessun alert</td></tr>
                  ) : alerts.map((a) => (
                    <tr key={a.id} className="border-t border-gray-100">
                      <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">{fmtDate(a.created_at)}</td>
                      <td className="px-4 py-2 font-mono text-xs">{a.check_name}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs text-white ${STATUS_DOT[a.status]?.replace('bg-', 'bg-') || 'bg-gray-400'}`}>{a.status}</span>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600">{a.channel}</td>
                      <td className="px-4 py-2 text-xs text-gray-500 hidden sm:table-cell truncate max-w-[200px]">{a.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
