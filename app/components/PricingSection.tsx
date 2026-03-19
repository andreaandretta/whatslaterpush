'use client';
import { CheckCircle2, Zap } from 'lucide-react';

interface PricingSectionProps {
  currentPlan?: string;
  userPhone?: string;
}

export default function PricingSection({ currentPlan, userPhone }: PricingSectionProps) {
  const handleCheckout = async (plan: 'personal' | 'business') => {
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
      else alert(data.error || 'Errore durante il checkout');
    } catch {
      alert('Errore di connessione. Riprova.');
    }
  };

  const handlePortal = async () => {
    if (!userPhone) return;
    try {
      const res = await fetch('/api/payment/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: userPhone }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert(data.error || 'Errore apertura portale');
    } catch {
      alert('Errore di connessione. Riprova.');
    }
  };

  const isPaying = currentPlan === 'personal' || currentPlan === 'business';

  return (
    <section id="prezzi" className="py-16">
      <div className="max-w-4xl mx-auto px-4 text-center">
        <h2 className="text-3xl font-bold text-text-primary mb-2">Scegli il tuo piano</h2>
        <p className="text-text-secondary mb-10">Inizia gratis, passa a pagamento quando sei pronto.</p>

        <div className="grid md:grid-cols-3 gap-6 max-w-3xl mx-auto">
          {/* Free */}
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
            <h3 className="text-lg font-bold mb-1">Free</h3>
            <div className="flex items-baseline justify-center gap-1 mb-4">
              <span className="text-3xl font-bold">&euro;0</span>
              <span className="text-text-secondary text-sm">/mese</span>
            </div>
            <ul className="space-y-2 text-sm text-left mb-6">
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" /> 3 messaggi/giorno</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" /> 5 contatti</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" /> 7 giorni di storico</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" /> 1 tentativo di invio</li>
            </ul>
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
            <ul className="space-y-2 text-sm text-left mb-6">
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 20 messaggi/giorno</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 50 contatti</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 30 giorni di storico</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 3 tentativi di invio</li>
            </ul>
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

          {/* Business */}
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
            <h3 className="text-lg font-bold mb-1">Business</h3>
            <div className="flex items-baseline justify-center gap-1 mb-4">
              <span className="text-3xl font-bold">&euro;19,99</span>
              <span className="text-text-secondary text-sm">/mese</span>
            </div>
            <ul className="space-y-2 text-sm text-left mb-6">
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 50 messaggi/giorno</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Contatti illimitati</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 90 giorni di storico</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 3 tentativi di invio</li>
            </ul>
            {currentPlan === 'business' ? (
              <button onClick={() => window.open('/#prezzi', '_blank')} className="w-full py-2.5 rounded-xl text-sm font-medium text-primary border border-primary hover:bg-primary/5 transition-colors">
                Cambia piano
              </button>
            ) : (
              <button onClick={() => handleCheckout('business')} className="w-full bg-gray-900 text-white py-2.5 rounded-xl font-semibold hover:scale-[1.02] transition-transform shadow-md">
                Passa a Business
              </button>
            )}
          </div>
        </div>

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
