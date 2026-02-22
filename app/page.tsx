'use client';

import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  Calendar,
  MessageCircle,
  BarChart3,
  CheckCircle2,
  ArrowRight,
  Clock,
  Play,
} from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

export default function HomePage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Hero Animations
    const ctx = gsap.context(() => {
      // Stagger testo Hero
      gsap.fromTo(
        '.hero-text',
        { y: 50, opacity: 0 },
        { y: 0, opacity: 1, duration: 1, stagger: 0.15, ease: 'power3.out' }
      );

      // Floating animazione per i telefoni
      gsap.to('.hero-phone-1', {
        y: -15,
        duration: 3,
        yoyo: true,
        repeat: -1,
        ease: 'sine.inOut',
      });
      gsap.to('.hero-phone-2', {
        y: 15,
        duration: 3.5,
        yoyo: true,
        repeat: -1,
        ease: 'sine.inOut',
        delay: 0.5,
      });

      // Animazione fade-up sezioni Features
      gsap.fromTo(
        '.feature-card',
        { y: 50, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          stagger: 0.1,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: featuresRef.current,
            start: 'top 80%',
          },
        }
      );

      // Stacking Cards (How it works) scale effect
      const steps = gsap.utils.toArray('.step-card') as HTMLElement[];
      steps.forEach((step, i) => {
        ScrollTrigger.create({
          trigger: step,
          start: 'top 15%',
          endTrigger: stepsRef.current,
          end: 'bottom bottom',
          pinSpacing: false,
          onUpdate: (self) => {
            if (i < steps.length - 1) {
              const progress = self.progress;
              gsap.to(step, {
                scale: 1 - progress * 0.05,
                filter: `blur(${progress * 4}px)`,
                opacity: 1 - progress * 0.3,
                duration: 0.1,
              });
            }
          },
        });
      });
    });

    return () => ctx.revert();
  }, []);

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#111B21] font-sans selection:bg-[#DCF8C6] selection:text-[#111B21] overflow-hidden">
      
      {/* BACKGROUND PATTERN: Subtle Chat Bubbles */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-[0.03] z-0"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M20 20h20v20H20z' fill='%23111B21' fill-rule='evenodd'/%3E%3C/svg%3E")`,
          backgroundSize: '40px 40px'
        }}
      />

      {/* A. NAVBAR (Floating Pill) */}
      <nav className="fixed top-6 left-1/2 -translate-x-1/2 w-[90%] max-w-5xl bg-white/80 backdrop-blur-xl border border-gray-100 shadow-sm rounded-full px-6 py-3 flex items-center justify-between z-50">
        <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
          <MessageCircle className="text-[#25D366]" fill="#25D366" size={24} />
          <span>whatslater</span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
          <a href="#features" className="hover:text-[#128C7E] transition-colors">Funzionalità</a>
          <a href="#how" className="hover:text-[#128C7E] transition-colors">Come Funziona</a>
          <a href="#pricing" className="hover:text-[#128C7E] transition-colors">Prezzi</a>
        </div>
        <button className="bg-[#25D366] hover:bg-[#128C7E] text-white px-6 py-2.5 rounded-full text-sm font-semibold transition-all hover:scale-105 active:scale-95 shadow-lg shadow-[#25D366]/20">
          Inizia Gratis
        </button>
      </nav>

      {/* B. HERO SECTION */}
      <section ref={heroRef} className="relative pt-40 pb-20 md:pt-48 md:pb-32 px-6 max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-16 z-10">
        <div className="flex-1 max-w-2xl">
          <h1 className="text-5xl md:text-7xl leading-[1.1] tracking-tight mb-6">
            <span className="hero-text block font-bold">I tuoi messaggi</span>
            <span className="hero-text block font-serif italic text-[#25D366]">programmati.</span>
          </h1>
          <p className="hero-text text-lg md:text-xl text-gray-500 mb-10 leading-relaxed max-w-lg">
            Pianifica messaggi WhatsApp, reminder automatici e follow-up — mentre tu ti occupi del resto.
          </p>
          <div className="hero-text flex flex-col sm:flex-row items-center gap-4">
            <button className="w-full sm:w-auto bg-[#25D366] hover:bg-[#128C7E] text-white px-8 py-4 rounded-full text-lg font-semibold transition-all hover:scale-105 shadow-xl shadow-[#25D366]/20 flex items-center justify-center gap-2">
              Prova Gratis <ArrowRight size={20} />
            </button>
            <button className="w-full sm:w-auto border-2 border-[#25D366] text-[#25D366] hover:bg-[#DCF8C6] px-8 py-4 rounded-full text-lg font-semibold transition-all flex items-center justify-center gap-2">
              <Play size={20} className="fill-current" /> Vedi come funziona
            </button>
          </div>
        </div>

        {/* Hero Mockups */}
        <div className="flex-1 relative w-full h-[500px] md:h-[600px] perspective-1000">
          {/* Mockup 1 (Dietro) */}
          <div className="hero-phone-2 absolute right-0 top-10 w-[260px] h-[540px] bg-white rounded-[3rem] shadow-2xl border-[8px] border-gray-100 overflow-hidden transform rotate-6 scale-95 opacity-80">
            <div className="bg-[#128C7E] h-16 w-full flex items-center px-4 text-white font-medium">WhatsApp</div>
            <div className="p-4 space-y-4 bg-[#e5ddd5] h-full">
              <div className="bg-white p-3 rounded-2xl rounded-tl-none text-sm max-w-[85%] shadow-sm">Ciao! Ti ricordo l&apos;appuntamento di domani alle 10:00.</div>
            </div>
          </div>
          {/* Mockup 2 (Davanti) */}
          <div className="hero-phone-1 absolute left-10 md:left-20 top-0 w-[280px] h-[580px] bg-white rounded-[3rem] shadow-2xl border-[8px] border-white overflow-hidden transform -rotate-2">
            <div className="bg-[#25D366] text-white p-6 pb-8 text-center rounded-b-[2rem]">
              <h3 className="font-semibold text-xl mb-1">Pianifica Invio</h3>
              <p className="opacity-80 text-sm">Domani, 09:00</p>
            </div>
            <div className="p-6 space-y-4 mt-4">
              <div className="h-4 bg-gray-100 rounded-full w-3/4"></div>
              <div className="h-4 bg-gray-100 rounded-full w-1/2"></div>
              <div className="h-32 bg-[#DCF8C6] rounded-2xl mt-6 p-4 border border-[#25D366]/20 relative">
                <span className="text-sm font-medium text-[#128C7E]">Messaggio pronto</span>
                <div className="absolute -bottom-3 -right-3 bg-[#25D366] p-3 rounded-full text-white shadow-lg">
                  <CheckCircle2 size={24} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* C. FEATURES */}
      <section id="features" ref={featuresRef} className="py-24 bg-[#F0F2F5] px-6 relative z-10">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Meno stress, <span className="font-serif italic text-[#128C7E]">più efficienza.</span></h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Card 1 */}
            <div className="feature-card bg-white p-8 rounded-[2rem] shadow-sm hover:-translate-y-2 transition-transform duration-300">
              <div className="bg-[#DCF8C6] w-14 h-14 rounded-2xl flex items-center justify-center mb-6 text-[#128C7E]">
                <Calendar size={28} />
              </div>
              <h3 className="text-xl font-bold mb-3">Pianificazione Intelligente</h3>
              <p className="text-gray-500 mb-6 leading-relaxed">Seleziona data e ora, noi ci occupiamo del resto. Il tuo telefono può anche essere spento.</p>
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 flex items-center gap-3">
                <div className="bg-[#25D366] p-2 rounded-full text-white"><Clock size={16} /></div>
                <div>
                  <p className="text-sm font-bold">Domani 09:00</p>
                  <p className="text-xs text-gray-500">Promemoria Dott. Rossi</p>
                </div>
              </div>
            </div>

            {/* Card 2 */}
            <div className="feature-card bg-white p-8 rounded-[2rem] shadow-sm hover:-translate-y-2 transition-transform duration-300">
              <div className="bg-[#DCF8C6] w-14 h-14 rounded-2xl flex items-center justify-center mb-6 text-[#128C7E]">
                <MessageCircle size={28} />
              </div>
              <h3 className="text-xl font-bold mb-3">Template Variabili</h3>
              <p className="text-gray-500 mb-6 leading-relaxed">Personalizza i messaggi in massa usando variabili come nome, orario o servizio.</p>
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 font-mono text-sm text-gray-600">
                Ciao <span className="text-[#25D366] bg-[#DCF8C6] px-1 rounded">{'{nome}'}</span>, ti ricordo l&apos;appuntamento alle <span className="text-[#25D366] bg-[#DCF8C6] px-1 rounded">{'{ora}'}</span>.
              </div>
            </div>

            {/* Card 3 */}
            <div className="feature-card bg-white p-8 rounded-[2rem] shadow-sm hover:-translate-y-2 transition-transform duration-300">
              <div className="bg-[#DCF8C6] w-14 h-14 rounded-2xl flex items-center justify-center mb-6 text-[#128C7E]">
                <BarChart3 size={28} />
              </div>
              <h3 className="text-xl font-bold mb-3">Analytics in Tempo Reale</h3>
              <p className="text-gray-500 mb-6 leading-relaxed">Scopri chi ha ricevuto e letto i tuoi messaggi con un tasso di apertura del 95%.</p>
              <div className="flex items-end gap-2 h-16 mt-4">
                <div className="w-1/4 bg-gray-200 rounded-t-md h-1/3"></div>
                <div className="w-1/4 bg-[#DCF8C6] rounded-t-md h-2/3"></div>
                <div className="w-1/4 bg-[#25D366] rounded-t-md h-full relative">
                  <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold text-[#128C7E]">95%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* D. PHILOSOPHY SECTION */}
      <section className="py-32 bg-[#DCF8C6] px-6 z-10 relative">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8 md:gap-16">
          <h2 className="text-4xl md:text-6xl font-bold text-[#111B21] flex-1">
            Scrivere costa tempo.
          </h2>
          <h2 className="text-4xl md:text-6xl font-serif italic text-[#128C7E] flex-1 md:text-right">
            Dimenticare costa di più.
          </h2>
        </div>
      </section>

      {/* E. HOW IT WORKS (Stacking Cards) */}
      <section id="how" ref={stepsRef} className="py-24 px-6 max-w-4xl mx-auto relative z-10">
        <div className="text-center mb-20">
          <h2 className="text-3xl md:text-5xl font-bold">Come funziona</h2>
        </div>
        
        <div className="relative space-y-8">
          {/* Step 1 */}
          <div className="step-card sticky top-24 bg-white border border-gray-100 rounded-[2.5rem] p-10 md:p-16 shadow-xl flex flex-col md:flex-row items-center gap-10 z-10">
            <div className="flex-1">
              <span className="text-[#25D366] font-bold tracking-widest text-sm uppercase mb-4 block">Passo 1</span>
              <h3 className="text-3xl font-bold mb-4">Scrivi</h3>
              <p className="text-gray-500 text-lg">Componi il tuo messaggio o usa un template. Aggiungi le variabili necessarie per personalizzarlo per ogni cliente.</p>
            </div>
            <div className="flex-1 w-full bg-[#F0F2F5] rounded-3xl p-6 border border-gray-200">
              <div className="w-full h-8 bg-white rounded-md mb-3"></div>
              <div className="w-3/4 h-8 bg-white rounded-md"></div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="step-card sticky top-32 bg-[#F0F2F5] border border-gray-200 rounded-[2.5rem] p-10 md:p-16 shadow-xl flex flex-col md:flex-row items-center gap-10 z-20">
            <div className="flex-1">
              <span className="text-[#128C7E] font-bold tracking-widest text-sm uppercase mb-4 block">Passo 2</span>
              <h3 className="text-3xl font-bold mb-4">Programma</h3>
              <p className="text-gray-500 text-lg">Scegli la data e l&apos;ora esatta in cui vuoi che il messaggio venga consegnato. Imposta invii ricorrenti se necessario.</p>
            </div>
            <div className="flex-1 w-full bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
              <div className="grid grid-cols-7 gap-2 text-center text-xs text-gray-400 mb-2">
                <span>L</span><span>M</span><span>M</span><span>G</span><span>V</span><span>S</span><span>D</span>
              </div>
              <div className="grid grid-cols-7 gap-2">
                {[...Array(14)].map((_, i) => (
                  <div key={i} className={`h-8 rounded-lg flex items-center justify-center text-sm ${i === 10 ? 'bg-[#25D366] text-white font-bold' : 'bg-gray-50'}`}>
                    {i + 1}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="step-card sticky top-40 bg-[#111B21] text-white rounded-[2.5rem] p-10 md:p-16 shadow-2xl flex flex-col md:flex-row items-center gap-10 z-30">
            <div className="flex-1">
              <span className="text-[#25D366] font-bold tracking-widest text-sm uppercase mb-4 block">Passo 3</span>
              <h3 className="text-3xl font-bold mb-4">Rilassati</h3>
              <p className="text-gray-400 text-lg">Il sistema invierà il messaggio in background. Riceverai una notifica a consegna avvenuta.</p>
            </div>
            <div className="flex-1 w-full flex justify-center">
              <div className="bg-[#25D366]/20 p-8 rounded-full relative">
                <div className="bg-[#25D366] p-6 rounded-full shadow-[0_0_40px_rgba(37,211,102,0.5)]">
                  <CheckCircle2 size={64} className="text-white" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* F. SOCIAL PROOF (Marquee) */}
      <section className="bg-[#25D366] py-6 overflow-hidden relative z-10">
        <div className="flex whitespace-nowrap">
          {/* Usiamo un'animazione inline CSS semplice per il marquee */}
          <style>{`
            @keyframes marquee {
              0% { transform: translateX(0%); }
              100% { transform: translateX(-50%); }
            }
            .animate-marquee {
              animation: marquee 20s linear infinite;
            }
          `}</style>
          <div className="animate-marquee flex items-center gap-12 text-white font-medium text-xl md:text-2xl tracking-wide w-[200%]">
            <span>Studio Rossi: 300% più conferme</span>
            <span className="text-[#128C7E]">◆</span>
            <span>Freelancer Marco: 10 ore risparmiate</span>
            <span className="text-[#128C7E]">◆</span>
            <span>95% tasso apertura</span>
            <span className="text-[#128C7E]">◆</span>
            <span>2,500 reminder automatici inviati ieri</span>
            <span className="text-[#128C7E]">◆</span>
            {/* Duplicato per scroll continuo */}
            <span>Studio Rossi: 300% più conferme</span>
            <span className="text-[#128C7E]">◆</span>
            <span>Freelancer Marco: 10 ore risparmiate</span>
            <span className="text-[#128C7E]">◆</span>
            <span>95% tasso apertura</span>
            <span className="text-[#128C7E]">◆</span>
            <span>2,500 reminder automatici inviati ieri</span>
          </div>
        </div>
      </section>

      {/* G. PRICING */}
      <section id="pricing" className="py-32 px-6 bg-white z-10 relative">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">Piani semplici e <span className="font-serif italic text-[#25D366]">trasparenti</span>.</h2>
            <p className="text-gray-500 text-lg">Inizia gratis, passa a pro quando cresci.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto items-center">
            {/* Starter */}
            <div className="bg-white border-2 border-gray-100 rounded-[2rem] p-8 hover:border-[#25D366] transition-colors">
              <h3 className="text-2xl font-bold mb-2">Starter</h3>
              <div className="flex items-baseline gap-1 mb-6">
                <span className="text-4xl font-bold">€9</span>
                <span className="text-gray-500">/mese</span>
              </div>
              <ul className="space-y-4 mb-8 text-gray-600">
                <li className="flex items-center gap-2"><CheckCircle2 size={18} className="text-[#25D366]" /> 100 messaggi/mese</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={18} className="text-[#25D366]" /> 3 Template</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={18} className="text-[#25D366]" /> Supporto base</li>
              </ul>
              <button className="w-full py-3 rounded-full border-2 border-[#25D366] text-[#25D366] font-bold hover:bg-[#DCF8C6] transition-colors">
                Inizia ora
              </button>
            </div>

            {/* Professional */}
            <div className="bg-[#128C7E] text-white rounded-[2rem] p-8 shadow-2xl relative transform md:-translate-y-4">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#25D366] text-white px-4 py-1 rounded-full text-xs font-bold tracking-widest uppercase">
                Popolare
              </div>
              <h3 className="text-2xl font-bold mb-2">Professional</h3>
              <div className="flex items-baseline gap-1 mb-6">
                <span className="text-5xl font-bold">€19</span>
                <span className="text-[#DCF8C6]">/mese</span>
              </div>
              <ul className="space-y-4 mb-8 text-gray-100">
                <li className="flex items-center gap-2"><CheckCircle2 size={18} className="text-[#25D366]" /> 500 messaggi/mese</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={18} className="text-[#25D366]" /> Template illimitati</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={18} className="text-[#25D366]" /> Analytics avanzate</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={18} className="text-[#25D366]" /> Supporto prioritario</li>
              </ul>
              <button className="w-full py-3 rounded-full bg-[#25D366] text-white font-bold hover:bg-white hover:text-[#128C7E] transition-colors shadow-lg">
                Inizia ora
              </button>
            </div>

            {/* Business */}
            <div className="bg-white border-2 border-gray-100 rounded-[2rem] p-8 hover:border-[#25D366] transition-colors">
              <h3 className="text-2xl font-bold mb-2">Business</h3>
              <div className="flex items-baseline gap-1 mb-6">
                <span className="text-4xl font-bold">€49</span>
                <span className="text-gray-500">/mese</span>
              </div>
              <ul className="space-y-4 mb-8 text-gray-600">
                <li className="flex items-center gap-2"><CheckCircle2 size={18} className="text-[#25D366]" /> Messaggi illimitati</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={18} className="text-[#25D366]" /> Multi-agente</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={18} className="text-[#25D366]" /> API Access</li>
              </ul>
              <button className="w-full py-3 rounded-full border-2 border-[#25D366] text-[#25D366] font-bold hover:bg-[#DCF8C6] transition-colors">
                Contatta Sales
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* H. FOOTER */}
      <footer className="bg-[#111B21] text-gray-400 py-12 px-6 border-t border-gray-800">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex flex-col gap-2 items-center md:items-start">
            <div className="flex items-center gap-2 font-bold text-xl text-white">
              <MessageCircle className="text-[#25D366]" fill="#25D366" size={24} />
              <span>whatslater</span>
            </div>
            <p className="text-sm">Italia · Servizio mondiale</p>
          </div>

          <div className="flex gap-6 text-sm">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Termini</a>
            <a href="#" className="hover:text-white transition-colors">Contatti</a>
          </div>

          <div className="flex items-center gap-2 bg-gray-900/50 px-4 py-2 rounded-full border border-gray-800">
            <div className="w-2 h-2 rounded-full bg-[#25D366] animate-pulse"></div>
            <span className="text-sm">Sistema Operativo</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
