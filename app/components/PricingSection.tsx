'use client';
import { useState } from 'react';
import { CheckCircle2, Zap } from 'lucide-react';

interface PricingSectionProps {
  currentPlan?: string;
  userPhone?: string;
  theme?: 'light' | 'dark';
}

export default function PricingSection({ currentPlan, userPhone, theme = 'light' }: PricingSectionProps) {
  const [error, setError] = useState<string | null>(null);
  const dark = theme === 'dark';

  // Theme tokens — derived once so the JSX below stays readable.
  const section = dark ? 'bg-[#111B21]' : 'bg-white';
  const heading = dark ? 'text-white' : 'text-text-primary';
  const subHeading = dark ? 'text-gray-400' : 'text-text-secondary';
  const cardBg = dark ? 'bg-[#202C33]' : 'bg-white';
  const cardBorder = dark ? 'border-[#2A3942]' : 'border-[#E9EDEF]';
  const cardText = dark ? 'text-white' : 'text-text-primary';
  const mutedText = dark ? 'text-gray-400' : 'text-text-secondary';
  const checkMuted = dark ? 'text-gray-500' : 'text-[#667781]';
  const currentBadge = dark
    ? 'text-gray-400 border-[#2A3942]'
    : 'text-gray-500 border-gray-200';
  const freeFallback = dark ? 'text-gray-500' : 'text-gray-400';
  const errorBox = dark
    ? 'bg-red-950/40 border-red-900 text-red-300'
    : 'bg-red-50 border-red-200 text-red-700';

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
    <section id="prezzi" className={`py-24 ${section}`}>
      <div className="max-w-4xl mx-auto px-6 text-center">
        <h2 className={`font-heading text-3xl sm:text-4xl font-bold mb-2 ${heading}`}>Scegli il tuo piano</h2>
        <p className={`mb-3 ${subHeading}`}>Inizia gratis, passa a pagamento quando sei pronto.</p>
        <p className={`mb-10 text-sm ${subHeading}`}>
          Cancelli quando vuoi. Niente carta richiesta per iniziare.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-5 max-w-5xl mx-auto lg:items-start">
          {/* Free */}
          <div className={`${cardBg} rounded-2xl p-6 border ${cardBorder} shadow-sm`}>
            <h3 className={`text-lg font-bold mb-1 ${cardText}`}>Free</h3>
            <div className="flex items-baseline justify-center gap-1 mb-4">
              <span className={`text-3xl font-bold ${cardText}`}>&euro;0</span>
              <span className={`text-sm ${mutedText}`}>/mese</span>
            </div>
            <ul className={`space-y-2 text-sm text-left mb-3 ${cardText}`}>
              <li className="flex items-start gap-2"><CheckCircle2 className={`w-4 h-4 mt-0.5 shrink-0 ${checkMuted}`} /> 3 messaggi/giorno</li>
              <li className="flex items-start gap-2"><CheckCircle2 className={`w-4 h-4 mt-0.5 shrink-0 ${checkMuted}`} /> 5 contatti</li>
              <li className="flex items-start gap-2"><CheckCircle2 className={`w-4 h-4 mt-0.5 shrink-0 ${checkMuted}`} /> 7 giorni di storico</li>
              <li className="flex items-start gap-2"><CheckCircle2 className={`w-4 h-4 mt-0.5 shrink-0 ${checkMuted}`} /> 1 tentativo di invio</li>
            </ul>
            <p className={`text-sm italic mt-2 mb-6 ${mutedText}`}>Per testare il prodotto</p>
            {currentPlan === 'free' ? (
              <span className={`block w-full py-2.5 rounded-xl text-sm font-medium border text-center ${currentBadge}`}>Piano attuale</span>
            ) : (
              <span className={`block w-full py-2.5 rounded-xl text-sm text-center ${freeFallback}`}>Gratuito</span>
            )}
          </div>

          {/* Personal — recommended */}
          <div className={`${cardBg} rounded-2xl p-7 border-2 border-primary ring-4 ring-primary/15 lg:scale-[1.06] lg:-my-2 relative shadow-soft-lg z-10`}>
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-white text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1 shadow-md">
              <Zap className="w-3 h-3" /> Più scelto
            </div>
            <h3 className={`text-lg font-bold mb-1 mt-2 ${cardText}`}>Personal</h3>
            <div className="flex items-baseline justify-center gap-1 mb-4">
              <span className={`text-3xl font-bold ${cardText}`}>&euro;4,99</span>
              <span className={`text-sm ${mutedText}`}>/mese</span>
            </div>
            <ul className={`space-y-2 text-sm text-left mb-3 ${cardText}`}>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 20 messaggi/giorno</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 50 contatti</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 30 giorni di storico</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 3 tentativi di invio</li>
            </ul>
            <p className={`text-sm italic mt-2 mb-6 ${mutedText}`}>Per chi schedula fino a 20 messaggi al giorno</p>
            {currentPlan === 'personal' ? (
              <button onClick={() => window.open('/#prezzi', '_blank')} className="w-full py-2.5 rounded-xl text-sm font-medium text-primary border border-primary hover:bg-primary/5 transition-colors">
                Cambia piano
              </button>
            ) : (
              <button onClick={() => handleCheckout('personal')} className="w-full bg-primary text-white py-2.5 rounded-xl font-semibold hover:scale-[1.02] transition-transform">
                {currentPlan === 'business' ? 'Passa a Personal' : 'Passa a Personal'}
              </button>
            )}
          </div>

          {/* Professional */}
          <div className={`${cardBg} rounded-2xl p-6 border ${cardBorder} shadow-sm`}>
            <h3 className={`text-lg font-bold mb-1 ${cardText}`}>Professional</h3>
            <div className="flex items-baseline justify-center gap-1 mb-4">
              <span className={`text-3xl font-bold ${cardText}`}>&euro;9,99</span>
              <span className={`text-sm ${mutedText}`}>/mese</span>
            </div>
            <ul className={`space-y-2 text-sm text-left mb-3 ${cardText}`}>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 35 messaggi/giorno</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 200 contatti</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 60 giorni di storico</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 3 tentativi di invio</li>
            </ul>
            <p className={`text-sm italic mt-2 mb-6 ${mutedText}`}>Per chi coordina squadre o cantieri</p>
            {currentPlan === 'professional' ? (
              <button onClick={() => window.open('/#prezzi', '_blank')} className="w-full py-2.5 rounded-xl text-sm font-medium text-primary border border-primary hover:bg-primary/5 transition-colors">
                Cambia piano
              </button>
            ) : (
              <button onClick={() => handleCheckout('professional')} className="w-full py-2.5 rounded-xl font-semibold text-primary border-2 border-primary hover:bg-primary/5 transition-colors">
                Passa a Professional
              </button>
            )}
          </div>

          {/* Business */}
          <div className={`${cardBg} rounded-2xl p-6 border ${cardBorder} shadow-sm`}>
            <h3 className={`text-lg font-bold mb-1 ${cardText}`}>Business</h3>
            <div className="flex items-baseline justify-center gap-1 mb-4">
              <span className={`text-3xl font-bold ${cardText}`}>&euro;19,99</span>
              <span className={`text-sm ${mutedText}`}>/mese</span>
            </div>
            <ul className={`space-y-2 text-sm text-left mb-3 ${cardText}`}>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 50 messaggi/giorno</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> Contatti illimitati</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 90 giorni di storico</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" /> 3 tentativi di invio</li>
            </ul>
            <p className={`text-sm italic mt-2 mb-6 ${mutedText}`}>Per chi gestisce pipeline di 30+ contatti attivi</p>
            {currentPlan === 'business' ? (
              <button onClick={() => window.open('/#prezzi', '_blank')} className="w-full py-2.5 rounded-xl text-sm font-medium text-primary border border-primary hover:bg-primary/5 transition-colors">
                Cambia piano
              </button>
            ) : (
              <button onClick={() => handleCheckout('business')} className="w-full py-2.5 rounded-xl font-semibold text-primary border-2 border-primary hover:bg-primary/5 transition-colors">
                Passa a Business
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className={`mt-6 rounded-xl p-4 text-sm max-w-xl mx-auto border ${errorBox}`}>
            {error}
          </div>
        )}

        {isPaying && (
          <p className={`mt-6 text-sm ${mutedText}`}>
            Gestisci fatturazione, cambia piano o cancella dal{' '}
            <button onClick={handlePortal} className="text-primary font-medium hover:underline">portale Stripe</button>.
          </p>
        )}
      </div>
    </section>
  );
}
