'use client';

// Pricing — case-study refresh. Outline buttons for non-featured plans;
// "Più scelto" Personal keeps the solid primary green so the visual hierarchy
// stays "one bright element per section".
//
// Stripe checkout is wired internally (same shape as the previous
// PricingSection). When userPhone is missing (landing page), we redirect to
// /dashboard so the user connects WhatsApp first.

import { CheckCircle2, Zap } from 'lucide-react';

interface PricingProps {
  theme?: 'light' | 'dark';
  currentPlan?: string;
  userPhone?: string;
}

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    desc: 'Per testare il prodotto',
    price: '€0',
    period: '/sempre',
    features: ['3 messaggi/giorno', '10 contatti'],
    featured: false,
  },
  {
    id: 'personal',
    name: 'Personal',
    desc: 'Per uso personale',
    price: '€4,99',
    period: '/mese',
    features: ['20 msg/giorno', '50 contatti', 'Storico 30 giorni'],
    featured: true,
  },
  {
    id: 'professional',
    name: 'Professional',
    desc: 'Per professionisti',
    price: '€9,99',
    period: '/mese',
    features: ['35 msg/giorno', '200 contatti', 'Storico 60 giorni'],
    featured: false,
  },
  {
    id: 'business',
    name: 'Business',
    desc: 'Per team',
    price: '€19,99',
    period: '/mese',
    features: ['50 msg/giorno', 'Contatti illimitati', 'Storico 90 giorni'],
    featured: false,
  },
];

export default function PricingSection({ theme = 'light', currentPlan, userPhone }: PricingProps) {
  const handleCheckout = async (plan: string) => {
    if (plan === 'free' || !userPhone) {
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
    } catch {
      // Silent: button stays usable; user can retry.
    }
  };

  const isDark = theme === 'dark';
  const sectionBg = isDark ? 'bg-[#0B141A]' : 'bg-white';
  const heading = isDark ? 'text-white' : 'text-[#1A1F2C]';
  const subHeading = isDark ? 'text-gray-400' : 'text-[#5A6573]';
  const cardBg = isDark ? 'bg-[#202C33]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2A3942]' : 'border-gray-100';
  const cardText = isDark ? 'text-white' : 'text-[#1A1F2C]';
  const mutedText = isDark ? 'text-gray-400' : 'text-[#5A6573]';

  return (
    <section id="prezzi" className={`py-24 ${sectionBg}`}>
      <div className="max-w-6xl mx-auto px-6 text-center">
        <span className="inline-block bg-[#A8E6CF] text-[#075E54] px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider mb-3">
          Prezzi
        </span>
        <h2 className={`font-heading text-3xl sm:text-4xl md:text-5xl font-black mb-2 tracking-tight ${heading}`}>
          Scegli il tuo <span className="text-[#4FBE7C]">piano</span>
        </h2>
        <p className={`mb-3 ${subHeading}`}>Inizia gratis, passa a pagamento quando sei pronto.</p>
        <p className={`mb-10 text-sm ${subHeading}`}>Cancelli quando vuoi. Niente carta richiesta per iniziare.</p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto items-stretch">
          {PLANS.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            const isFeatured = plan.featured;
            return (
              <div
                key={plan.id}
                className={`${cardBg} rounded-2xl p-7 border ${
                  isFeatured
                    ? 'border-2 border-[#4FBE7C] shadow-2xl shadow-[#4FBE7C]/15 lg:scale-[1.06] lg:-my-2 relative z-10'
                    : cardBorder
                } flex flex-col`}
              >
                {isFeatured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#4FBE7C] text-white text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1 shadow-md">
                    <Zap className="w-3 h-3" /> Più scelto
                  </div>
                )}
                <h3 className={`text-lg font-bold mb-1 mt-2 ${cardText}`}>{plan.name}</h3>
                <p className={`text-sm italic mt-2 mb-6 ${mutedText}`}>{plan.desc}</p>
                <div className="mb-6">
                  <span className={`text-3xl font-black ${cardText}`}>{plan.price}</span>
                  <span className={`text-sm ${mutedText}`}>{plan.period}</span>
                </div>
                <ul className="space-y-2 mb-8 text-left text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className={`flex items-start gap-2 ${cardText}`}>
                      <CheckCircle2 className="w-4 h-4 text-[#4FBE7C] mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => !isCurrent && handleCheckout(plan.id)}
                  className={`mt-auto w-full py-2.5 rounded-full font-semibold text-sm transition-colors ${
                    isCurrent
                      ? 'bg-gray-100 text-gray-500 cursor-default'
                      : isFeatured
                      ? 'bg-primary text-white hover:bg-primary-hover shadow-lg shadow-primary/30'
                      : 'border-2 border-[#1A1F2C] text-[#1A1F2C] hover:bg-[#1A1F2C] hover:text-white'
                  }`}
                  disabled={isCurrent}
                >
                  {isCurrent ? 'Piano attuale' : `Inizia ${plan.name}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
