'use client';
import { useEffect, useRef } from 'react';
import { LogIn, MessageSquare, Check } from 'lucide-react';

const steps = [
  {
    icon: LogIn,
    number: '01',
    title: 'Collega il tuo WhatsApp',
    description:
      'Inserisci il codice a 8 cifre dalla schermata "Dispositivi collegati" — ci vogliono 30 secondi.',
    accent: 'Una sola volta',
  },
  {
    icon: MessageSquare,
    number: '02',
    title: 'Scegli contatto e orario',
    description:
      'Dalla dashboard: contatto, testo, data e ora di invio. Poi chiudi tutto.',
    accent: 'Anche dal browser',
  },
  {
    icon: Check,
    number: '03',
    title: 'Parte da solo',
    description:
      "All'ora giusta il messaggio esce dal tuo numero. Tu non devi fare nulla, nemmeno avere il telefono acceso.",
    accent: 'Automatico',
  },
];

export default function HowItWorksSection() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('fade-in-up');
          }
        });
      },
      { threshold: 0.1 }
    );

    const cards = sectionRef.current?.querySelectorAll('.step-card');
    cards?.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="come-funziona"
      ref={sectionRef}
      className="py-24 bg-[#ECE5DD] wa-pattern"
    >
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="font-heading text-3xl sm:text-4xl font-bold text-text-primary">
            Come funziona
          </h2>
          <p className="text-text-secondary mt-2">3 passi e sei operativo.</p>
        </div>

        <div className="space-y-5">
          {steps.map((step, i) => (
            <div
              key={i}
              className="step-card bg-white rounded-2xl p-6 sm:p-7 shadow-soft opacity-0 flex items-start gap-5 sm:gap-7"
              style={{ animationDelay: `${i * 120}ms` }}
            >
              {/* Big numeral */}
              <div className="shrink-0 font-heading text-5xl sm:text-6xl font-bold text-[#25D366]/25 leading-none w-14 sm:w-20 tabular-nums">
                {step.number}
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <step.icon className="w-4 h-4 text-[#25D366]" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#075E54]">
                    {step.accent}
                  </span>
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-text-primary mb-1.5">
                  {step.title}
                </h3>
                <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
