'use client';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { TextPlugin } from 'gsap/TextPlugin';
import {
  Calendar, CheckCircle2, Clock, Paperclip, User, Zap, RefreshCw
} from 'lucide-react';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(TextPlugin);
}

export default function FeaturesSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl1 = gsap.timeline({ repeat: -1, repeatDelay: 2 });
      tl1.to('.nl-input', { text: "Manda a Marco tra 2 ore", duration: 1.5, ease: 'none' })
         .to('.nl-dots', { opacity: 1, duration: 0.2 })
         .to('.nl-dots', { opacity: 0, duration: 0.2, delay: 1 })
         .fromTo('.nl-output', { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 })
         .to({}, { duration: 2 })
         .to('.nl-input', { text: "", duration: 0.1 })
         .to('.nl-output', { opacity: 0, duration: 0.1 })
         .to('.nl-input', { text: "Domani mattina alle 8", duration: 1.5, ease: 'none' })
         .to('.nl-dots', { opacity: 1, duration: 0.2 })
         .to('.nl-dots', { opacity: 0, duration: 0.2, delay: 1 })
         .to('.nl-output-2', { y: 0, opacity: 1, duration: 0.4 })
         .to({}, { duration: 2 })
         .to('.nl-input', { text: "", duration: 0.1 })
         .to('.nl-output-2', { opacity: 0, duration: 0.1 });

      const tl2 = gsap.timeline({ repeat: -1, repeatDelay: 2 });
      tl2.fromTo('.ac-contact', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'spring' })
         .to('.ac-caption', { text: "Buon compleanno! \u{1F382}", duration: 1.5, ease: 'none', delay: 0.5 })
         .fromTo('.ac-badge', { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(1.5)', delay: 0.5 })
         .to({}, { duration: 2 })
         .to(['.ac-contact', '.ac-caption', '.ac-badge'], { opacity: 0, duration: 0.3 });

      const tl3 = gsap.timeline({ repeat: -1, repeatDelay: 2 });
      tl3.to('.sq-timer', { text: "00:00", duration: 2, ease: 'none' })
         .to('.sq-status-1', { rotationX: 90, duration: 0.2 })
         .to('.sq-status-1-done', { rotationX: 0, duration: 0.2 })
         .to('.sq-row-1', { y: -50, opacity: 0, duration: 0.4, delay: 0.5 })
         .to('.sq-row-2', { y: -60, duration: 0.4 }, '<')
         .to('.sq-row-3', { y: -60, duration: 0.4 }, '<')
         .fromTo('.sq-row-new', { y: 20, opacity: 0 }, { y: -60, opacity: 1, duration: 0.5, ease: 'back.out(1.5)' })
         .to('.sq-cancel-input', { text: "Cancella Marco", duration: 1, ease: 'none', delay: 1 })
         .to('.sq-row-2', { x: 50, opacity: 0, backgroundColor: '#fee2e2', duration: 0.4 })
         .to({}, { duration: 2 })
         .to(['.sq-row-1', '.sq-row-2', '.sq-row-3', '.sq-row-new', '.sq-cancel-input'], { clearProps: 'all' })
         .to('.sq-status-1', { rotationX: 0, duration: 0 })
         .to('.sq-status-1-done', { rotationX: -90, duration: 0 });

    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="py-32 px-6 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-20">
          <h2 className="text-4xl md:text-5xl font-bold text-text-primary mb-4 tracking-tight">
            La Magia di Programmare e Dimenticare
          </h2>
          <p className="text-xl text-text-secondary font-serif italic">
            Tre superpoteri per chi tiene davvero alle persone.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Card 1 */}
          <div className="bg-background rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 flex flex-col h-[400px]">
            <h3 className="text-xl font-bold mb-2 flex items-center gap-2"><Zap className="w-5 h-5 text-primary" /> Linguaggio Naturale</h3>
            <p className="text-sm text-text-secondary mb-8">Scrivi come parleresti. L&apos;AI capisce date, ore e intenzioni.</p>
            <div className="flex-1 flex flex-col justify-center items-center relative">
              <div className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-50 mb-4">
                <span className="nl-input text-sm font-medium text-gray-800"></span>
                <span className="w-0.5 h-4 bg-primary inline-block ml-1 animate-pulse"></span>
              </div>
              <div className="nl-dots opacity-0 flex gap-1 mb-4">
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
              <div className="nl-output absolute bottom-10 opacity-0 bg-primary/10 text-accent px-4 py-2 rounded-xl text-sm font-mono font-medium flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Oggi, 14:30 &rarr; Marco Rossi
              </div>
              <div className="nl-output-2 absolute bottom-10 opacity-0 bg-primary/10 text-accent px-4 py-2 rounded-xl text-sm font-mono font-medium flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Dom 24 Feb, 08:00 &rarr; Luca B.
              </div>
            </div>
          </div>

          {/* Card 2 */}
          <div className="bg-background rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 flex flex-col h-[400px]">
            <h3 className="text-xl font-bold mb-2 flex items-center gap-2"><Paperclip className="w-5 h-5 text-primary" /> Allega il Contatto</h3>
            <p className="text-sm text-text-secondary mb-8">Invia la rubrica a te stesso. Aggiungi il messaggio. Fatto.</p>
            <div className="flex-1 flex flex-col justify-center items-center relative w-full">
              <div className="w-full max-w-[240px] bg-[#EFEAE2] rounded-2xl p-4 shadow-inner relative overflow-hidden h-[200px] flex flex-col justify-end">
                <div className="ac-contact bg-white p-3 rounded-xl shadow-sm mb-2 flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center"><User className="w-5 h-5 text-gray-500" /></div>
                  <span className="font-semibold text-sm">Andrea</span>
                </div>
                <div className="bg-[#dcf8c6] p-2 rounded-xl rounded-tr-none self-end shadow-sm mb-2 min-h-[36px] min-w-[100px]">
                  <span className="ac-caption text-sm"></span>
                </div>
                <div className="ac-badge absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm text-[10px] font-medium text-primary flex items-center gap-1 whitespace-nowrap">
                  <CheckCircle2 className="w-3 h-3" /> Programmato &rarr; 15 Mar, 09:00
                </div>
              </div>
            </div>
          </div>

          {/* Card 3 */}
          <div className="bg-background rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 flex flex-col h-[400px]">
            <h3 className="text-xl font-bold mb-2 flex items-center gap-2"><RefreshCw className="w-5 h-5 text-primary" /> Coda Intelligente</h3>
            <p className="text-sm text-text-secondary mb-8">Gestisci tutto dalla chat. Annulla con un messaggio.</p>
            <div className="flex-1 flex flex-col relative w-full overflow-hidden">
              <div className="space-y-2 relative h-[150px]">
                <div className="sq-row-1 bg-white p-3 rounded-xl shadow-sm border border-gray-50 flex justify-between items-center relative z-30">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold">Marco R.</span>
                    <span className="text-[10px] text-gray-500 truncate w-24">&quot;Ciao, ci vediamo?&quot;</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="sq-timer text-xs font-mono text-orange-500">00:03</span>
                    <div className="relative w-4 h-4">
                      <Clock className="sq-status-1 absolute inset-0 w-4 h-4 text-orange-500" />
                      <CheckCircle2 className="sq-status-1-done absolute inset-0 w-4 h-4 text-primary" style={{ transform: 'rotateX(-90deg)' }} />
                    </div>
                  </div>
                </div>
                <div className="sq-row-2 bg-white p-3 rounded-xl shadow-sm border border-gray-50 flex justify-between items-center relative z-20">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold">Sara M.</span>
                    <span className="text-[10px] text-gray-500 truncate w-24">&quot;Buon compleanno!&quot;</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-400">15 Mar</span>
                    <Clock className="w-4 h-4 text-gray-400" />
                  </div>
                </div>
                <div className="sq-row-3 bg-white p-3 rounded-xl shadow-sm border border-gray-50 flex justify-between items-center relative z-10 opacity-50">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold">Luca B.</span>
                    <span className="text-[10px] text-gray-500 truncate w-24">&quot;Reminder app...&quot;</span>
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                </div>
                <div className="sq-row-new absolute top-full left-0 right-0 bg-white p-3 rounded-xl shadow-sm border border-gray-50 flex justify-between items-center opacity-0">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold">Anna</span>
                    <span className="text-[10px] text-gray-500 truncate w-24">&quot;Riunione spostata&quot;</span>
                  </div>
                  <Clock className="w-4 h-4 text-orange-500" />
                </div>
              </div>
              <div className="mt-auto bg-white rounded-full px-3 py-2 shadow-sm border border-gray-100 flex items-center">
                <span className="sq-cancel-input text-xs font-medium text-red-500"></span>
                <span className="w-0.5 h-3 bg-red-500 inline-block ml-1 animate-pulse"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
