'use client';
import { useState } from 'react';
import { CheckCircle2, Zap } from 'lucide-react';

interface PricingSectionProps {
  currentPlan?: string;
  userPhone?: string;
}

export default function PricingSection({ currentPlan, userPhone }: PricingSectionProps) {
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = async (plan: 'personal' | 'professional' | 'business') => {
    setError(null);
    if (!userPhone) {
      window.location.href = '/dashboard';
      return;
    }
    try {
      const res = await fetch('/api/payment/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: userPhone, plan }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setError('Qualcosa non ha funzionato. Riprova tra un momento — se il problema continua scrivi a supporto@whatslaterpush.vercel.app');
    } catch {
      setError('Qualcosa non ha funzionato. Riprova tra un momento — se il problema continua scrivi a supporto@whatslaterpush.vercel.app');
    }
  };

  const handlePortal = async () => {
    setError(null);
    if (!userPhone) return;
    try {
      const res = await fetch('/api/payment/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: userPhone }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setError('Qualcosa non ha funzionato. Riprova tra un momento — se il problema continua scrivi a supporto@whatslaterpush.vercel.app');
    } catch {
      setError('Qualcosa non ha funzionato. Riprova tra un momento — se il problema continua scrivi a supporto@whatslaterpush.vercel.app');
    }
  };

  const isPaying = currentPlan === 'personal' || currentPlan === 'professional' || currentPlan === 'business';

  return (
    <section id="prezzi" className="py-24 bg-white">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <h2 className="font-heading text-3xl sm:text-4xl font-bold text-text-primary mb-2">Scegli il tuo piano</h2>
        <p className="text-text-secondary mb-10">Inizia gratis, passa a pagamento quando sei pronto.</p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
          {/* Free */}
          <div className="bg-white rounded-2xl p-6 border border-[#E9EDEF] shadow-sm">
            <h3 className="text-lg font-bold mb-1">Free</h3>
            <div className="flex items-baseline justify-center gap-1 mb-4">
              <span className="text-3xl font-bold">&euro;0</span>
              <span className="text-text-secondary text-sm">/mese</span>
            </div>
            <ul className="space-y-2 text-sm text-left mb-3">
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-[#667781] mt-0.5 shrink-0" /> 3 messaggi/giorno</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-[#667781] mt-0.5 shrink-0" /> 5 contatti</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-[#667781] mt-0.5 shrink-0" /> 7 giorni di storico</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-[#667781] mt-0.5 shrink-0" /> 1 tentativo di invio</li>
            </ul>
            <p className="text-sm text-text-secondary italic mt-2 mb-6">Per provare</p>
            {currentPlan === 'free' ? (
              <span className="block w-full py-2.5 rounded-xl text-sm font-medium text-gray-500 border border-gray-200 text-center">Piano attuale</span>
            ) : (
              <span className="block w-full py-2.5 rounded-xl text-sm text-gray-400 text-center">Gratuito</span>
            )}
          </div>

          {/* Personal — recommended */}
          <div className="bg-white rounded-2xl p-6 border-2 border-primary shadow-lg relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-white text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
              <Zap className="w-3 h-3" /> Consigliato
            </div>
            <h3 className="text-lg font-bold mb-1 mt-2">Personal</h3>
            <div className="flex items-baseline justify-center gap-1 mb-4">
              <span className="text-3xl font-bold">&euro;4,99</span>
              <span className="text-text-secondary text-sm">/mese</span>
            </div>
            <ul className="space-y-2 text-sm text-left mb-3">
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 20 messaggi/giorno</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 50 contatti</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 30 giorni di storico</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 3 tentativi di invio</li>
            </ul>
            <p className="text-sm text-text-secondary italic mt-2 mb-6">Per chi schedula fino a 20 messaggi al giorno</p>
            {currentPlan === 'personal' ? (
              <button onClick={() => window.open('/#prezzi', '_blank')} className="w-full py-2.5 rounded-xl text-sm font-medium text-primary border border-primary hover:bg-primary/5 transition-colors">
                Cambia piano
              </button>
            ) : (
              <button onClick={() => handleCheckout('personal')} className="w-full bg-primary text-white py-2.5 rounded-xl font-semibold hover:scale-[1.02] transition-transform shadow-md shadow-primary/30">
                {currentPlan === 'business' ? 'Passa a Personal' : 'Passa a Personal'}
              </button>
            )}
          </div>

          {/* Professional */}
          <div className="bg-white rounded-2xl p-6 border border-[#E9EDEF] shadow-sm">
            <h3 className="text-lg font-bold mb-1">Professional</h3>
            <div className="flex items-baseline justify-center gap-1 mb-4">
              <span className="text-3xl font-bold">&euro;9,99</span>
              <span className="text-text-secondary text-sm">/mese</span>
            </div>
            <ul className="space-y-2 text-sm text-left mb-3">
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 35 messaggi/giorno</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 200 contatti</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 60 giorni di storico</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 3 tentativi di invio</li>
            </ul>
            <p className="text-sm text-text-secondary italic mt-2 mb-6">Per chi coordina squadre o cantieri</p>
            {currentPlan === 'professional' ? (
              <button onClick={() => window.open('/#prezzi', '_blank')} className="w-full py-2.5 rounded-xl text-sm font-medium text-primary border border-primary hover:bg-primary/5 transition-colors">
                Cambia piano
              </button>
            ) : (
              <button onClick={() => handleCheckout('professional')} className="w-full bg-primary text-white py-2.5 rounded-xl font-semibold hover:scale-[1.02] transition-transform shadow-md shadow-primary/30">
                Passa a Professional
              </button>
            )}
          </div>

          {/* Business */}
          <div className="bg-white rounded-2xl p-6 border border-[#E9EDEF] shadow-sm">
            <h3 className="text-lg font-bold mb-1">Business</h3>
            <div className="flex items-baseline justify-center gap-1 mb-4">
              <span className="text-3xl font-bold">&euro;19,99</span>
              <span className="text-text-secondary text-sm">/mese</span>
            </div>
            <ul className="space-y-2 text-sm text-left mb-3">
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 50 messaggi/giorno</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Contatti illimitati</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 90 giorni di storico</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 3 tentativi di invio</li>
            </ul>
            <p className="text-sm text-text-secondary italic mt-2 mb-6">Per chi gestisce pipeline di 30+ contatti attivi</p>
            {currentPlan === 'business' ? (
              <button onClick={() => window.open('/#prezzi', '_blank')} className="w-full py-2.5 rounded-xl text-sm font-medium text-primary border border-primary hover:bg-primary/5 transition-colors">
                Cambia piano
              </button>
            ) : (
              <button onClick={() => handleCheckout('business')} className="w-full bg-[#075E54] text-white py-2.5 rounded-xl font-semibold hover:scale-[1.02] transition-transform shadow-md">
                Passa a Business
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 max-w-xl mx-auto">
            {error}
          </div>
        )}

        {isPaying && (
          <p className="mt-6 text-sm text-text-secondary">
            Gestisci fatturazione, cambia piano o cancella dal{' '}
            <button onClick={handlePortal} className="text-primary font-medium hover:underline">portale Stripe</button>.
          </p>
        )}
      </div>
    </section>
  );
}
