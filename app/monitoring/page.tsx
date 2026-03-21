import { createClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const STATUS_COLORS: Record<string, string> = {
  ok: 'bg-green-500',
  warning: 'bg-yellow-500',
  critical: 'bg-red-500',
};

const STATUS_TEXT: Record<string, string> = {
  ok: 'OK',
  warning: 'Attenzione',
  critical: 'Critico',
};

export default async function MonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ secret?: string }>;
}) {
  const params = await searchParams;
  const secret = params.secret;
  if (!secret || secret !== process.env.MONITORING_SECRET) {
    redirect('/');
  }

  const supabase = getSupabase();

  const { data: checks } = await supabase
    .from('monitoring_checks')
    .select('*')
    .order('check_name');

  const { data: alerts } = await supabase
    .from('monitoring_alerts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">WhatsLater Monitoring</h1>
        <p className="text-sm text-gray-500 mb-6">
          Ultimo aggiornamento: {checks?.[0]?.checked_at ? new Date(checks[0].checked_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) : 'Mai'}
        </p>

        {/* Status Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {(checks || []).map((check: any) => (
            <div key={check.check_name} className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[check.status] || 'bg-gray-400'}`} />
                <span className="text-sm font-semibold text-gray-900">{check.check_name}</span>
              </div>
              <p className="text-xs text-gray-600">{check.message}</p>
              <p className="text-xs text-gray-400 mt-1">
                {STATUS_TEXT[check.status] || check.status} — {new Date(check.checked_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}
              </p>
            </div>
          ))}
          {(!checks || checks.length === 0) && (
            <p className="text-gray-500 col-span-3">Nessun check eseguito ancora. Attendi il primo ciclo di monitoraggio.</p>
          )}
        </div>

        {/* Alert History */}
        <h2 className="text-lg font-bold text-gray-900 mb-3">Ultimi Alert</h2>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
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
              {(alerts || []).map((alert: any) => (
                <tr key={alert.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">
                    {new Date(alert.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{alert.check_name}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs text-white ${STATUS_COLORS[alert.status] || 'bg-gray-400'}`}>
                      {alert.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">{alert.channel}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 hidden sm:table-cell truncate max-w-[200px]">{alert.message}</td>
                </tr>
              ))}
              {(!alerts || alerts.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-center text-gray-400">Nessun alert inviato</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
