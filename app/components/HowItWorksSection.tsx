'use client';
import { useEffect, useRef } from 'react';
import { LogIn, MessageSquare, Check } from 'lucide-react';

const steps = [
  {
    icon: LogIn,
    number: 1,
    title: 'Collega il tuo WhatsApp',
    description: 'Inserisci il codice a 8 cifre su WhatsApp — ci vogliono 30 secondi',
  },
  {
    icon: MessageSquare,
    number: 2,
    title: 'Scrivi il Comando',
    description: "Manda un messaggio a te stesso: 'Invia a Marco domani alle 15...'",
  },
  {
    icon: Check,
    number: 3,
    title: 'Consegnato',
    description: 'Il messaggio parte all\'ora giusta, dal tuo numero, in automatico',
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
    <section id="come-funziona" ref={sectionRef} className="py-24 bg-[#ECE5DD] wa-pattern">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="font-heading text-3xl sm:text-4xl font-bold text-text-primary">
            Come Funziona
          </h2>
          <p className="text-text-secondary mt-2">3 passi e sei operativo</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          {steps.map((step, i) => (
            <div key={i} className="step-card bg-white rounded-2xl p-6 text-center shadow-soft opacity-0" style={{ animationDelay: `${i * 150}ms` }}>
              <div className="w-14 h-14 mx-auto rounded-full bg-[#25D366]/12 flex items-center justify-center mb-3">
                <step.icon className="w-7 h-7 text-[#25D366]" />
              </div>
              <div className="w-6 h-6 mx-auto rounded-full bg-[#25D366] text-white text-xs font-bold flex items-center justify-center mb-3">
                {step.number}
              </div>
              <h3 className="text-base font-bold text-text-primary mb-1">{step.title}</h3>
              <p className="text-sm text-text-secondary">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
