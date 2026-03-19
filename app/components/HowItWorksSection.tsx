'use client';
import { useEffect, useRef } from 'react';
import { Link2, MessageSquare, Bell } from 'lucide-react';

const steps = [
  {
    icon: Link2,
    title: 'Connetti WhatsApp',
    time: '30 secondi',
    description: 'Collega il tuo numero in 30 secondi',
  },
  {
    icon: MessageSquare,
    title: 'Scrivi il messaggio e l\'orario',
    time: '',
    description: 'Manda un messaggio a te stesso con il testo e l\'ora',
  },
  {
    icon: Bell,
    title: 'Il tuo cliente riceve il promemoria',
    time: '',
    description: 'Il messaggio parte in automatico, dal tuo numero',
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
    <section id="come-funziona" ref={sectionRef} className="py-24 bg-background">
      <div className="max-w-5xl mx-auto px-6">
        <h2 className="font-heading text-3xl sm:text-4xl font-bold text-text-primary text-center mb-16">
          Come Funziona
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          {steps.map((step, i) => (
            <div key={i} className="step-card text-center opacity-0" style={{ animationDelay: `${i * 150}ms` }}>
              <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <step.icon className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-bold text-text-primary mb-1">{step.title}</h3>
              {step.time && (
                <span className="text-xs text-primary font-medium">{step.time}</span>
              )}
              <p className="text-sm text-text-secondary mt-2">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
