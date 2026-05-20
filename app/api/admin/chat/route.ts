import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runAllChecks, CheckResult } from '../../../lib/monitoring';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function buildContext(): Promise<string> {
  const supabase = getSupabase();

  const [checks, totalRes, planRes, expiringRes, churnedRes, alertsRes] = await Promise.all([
    runAllChecks(),
    supabase.from('user_instances').select('id', { count: 'exact', head: true }),
    supabase.from('user_instances').select('subscription_plan'),
    supabase.from('user_instances')
      .select('phone_number, trial_ends_at')
      .eq('subscription_plan', 'trial')
      .gte('trial_ends_at', new Date().toISOString())
      .lte('trial_ends_at', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()),
    supabase.from('user_instances')
      .select('phone_number, trial_ends_at')
      .eq('subscription_plan', 'free')
      .not('trial_ends_at', 'is', null)
      .lt('trial_ends_at', new Date().toISOString()),
    supabase.from('monitoring_alerts').select('*').order('created_at', { ascending: false }).limit(5),
  ]);

  const byPlan = { free: 0, trial: 0, personal: 0, professional: 0, business: 0 };
  for (const row of (planRes.data || [])) {
    const p = row.subscription_plan as keyof typeof byPlan;
    if (p in byPlan) byPlan[p]++;
  }
  const mrr = byPlan.personal * 4.99 + byPlan.professional * 9.99 + byPlan.business * 19.99;

  const checksText = checks.map((c: CheckResult) =>
    `- ${c.name}: ${c.status} — ${c.message}`
  ).join('\n');

  const expiringText = (expiringRes.data || []).map((u: any) =>
    `  ${u.phone_number} (scade ${new Date(u.trial_ends_at).toLocaleDateString('it-IT')})`
  ).join('\n') || '  Nessuno';

  const churnedText = (churnedRes.data || []).map((u: any) =>
    `  ${u.phone_number} (scaduto ${new Date(u.trial_ends_at).toLocaleDateString('it-IT')})`
  ).join('\n') || '  Nessuno';

  const alertsText = (alertsRes.data || []).map((a: any) =>
    `- ${new Date(a.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}: ${a.check_name} ${a.status} (${a.channel})`
  ).join('\n') || '  Nessun alert';

  return `Sei l'assistente tecnico di WhatsLater. Rispondi SEMPRE in italiano semplice, mai tecnico.
Se non hai abbastanza dati per rispondere, di' "Non ho abbastanza dati per rispondere".

STATO SISTEMA ATTUALE:
${checksText}

DATI BUSINESS:
- Utenti totali: ${totalRes.count || 0}
- Per piano: Free=${byPlan.free}, Trial=${byPlan.trial}, Personal=${byPlan.personal}, Business=${byPlan.business}
- MRR: €${mrr.toFixed(2)}
- Trial in scadenza (7gg):
${expiringText}
- Trial scaduti non convertiti:
${churnedText}

ULTIMI ALERT:
${alertsText}

Rispondi alla domanda dell'operatore in modo conciso e utile.
Se chiede cosa fare per risolvere un problema, dai istruzioni pratiche passo-passo.`;
}

async function callAI(systemPrompt: string, question: string): Promise<string> {
  // Groq primary
  if (process.env.GROQ_API_KEY) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question },
          ],
          temperature: 0.3,
          max_tokens: 500,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const answer = data.choices?.[0]?.message?.content;
        if (answer) return answer;
      }
    } catch {
      // fall through to OpenAI
    }
  }

  // OpenAI fallback
  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question },
          ],
          temperature: 0.3,
          max_tokens: 500,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const answer = data.choices?.[0]?.message?.content;
        if (answer) return answer;
      }
    } catch {
      // fall through
    }
  }

  return 'Non ho abbastanza dati per rispondere. Verifica che le chiavi API (GROQ_API_KEY o OPENAI_API_KEY) siano configurate.';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { secret, question } = body;

    if (!secret || secret !== process.env.MONITORING_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return NextResponse.json({ error: 'Question required' }, { status: 400 });
    }

    const systemPrompt = await buildContext();
    const answer = await callAI(systemPrompt, question.trim());

    return NextResponse.json({ answer });
  } catch (err: any) {
    console.error('Admin chat error:', err?.message);
    return NextResponse.json({ answer: 'Errore interno. Riprova tra qualche secondo.' }, { status: 500 });
  }
}
