'use client';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  ArrowRight, CheckCircle2, Check, QrCode, Smartphone, Shield,
  Link as LinkIcon, User, Send
} from 'lucide-react';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

export default function HowItWorksSection() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray('.hiw-card');

      cards.forEach((card: any, i: number) => {
        if (i === cards.length - 1) return;

        ScrollTrigger.create({
          trigger: card,
          start: 'top 10%',
          endTrigger: cards[i + 1] as Element,
          end: 'top 20%',
          pin: true,
          pinSpacing: false,
          animation: gsap.to(card, {
            scale: 0.9,
            opacity: 0.5,
            filter: 'blur(10px)',
            ease: 'none'
          }),
          scrub: true
        });
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} id="come-funziona" className="py-20 bg-background relative">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-20">
          <h2 className="text-4xl font-bold text-text-primary">Come Funziona</h2>
        </div>

        <div className="space-y-24">
          {/* Card 1 */}
          <div className="hiw-card bg-white rounded-[3rem] p-10 md:p-16 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 min-h-[60vh] flex flex-col justify-center relative z-10">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div>
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                  <span className="text-primary font-bold text-xl">1</span>
                </div>
                <h3 className="text-3xl font-bold mb-4">Connetti WhatsApp</h3>
                <p className="text-text-secondary mb-8">Scansiona il QR Code o usa un codice di abbinamento. Sicuro, veloce e direttamente dal tuo telefono.</p>
                <ul className="space-y-4 text-sm font-medium">
                  <li className="flex items-center gap-3"><Smartphone className="w-5 h-5 text-primary" /> Apri WhatsApp</li>
                  <li className="flex items-center gap-3"><Shield className="w-5 h-5 text-primary" /> Dispositivi collegati</li>
                  <li className="flex items-center gap-3"><LinkIcon className="w-5 h-5 text-primary" /> Collega un dispositivo</li>
                </ul>
              </div>
              <div className="bg-background rounded-3xl p-8 flex items-center justify-center">
                <div className="w-48 h-48 bg-white rounded-2xl shadow-sm border-2 border-primary/20 flex items-center justify-center relative overflow-hidden">
                  <QrCode className="w-32 h-32 text-text-primary" />
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/20 to-transparent h-1/2 animate-[scan_2s_ease-in-out_infinite]"></div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2 */}
          <div className="hiw-card bg-white rounded-[3rem] p-10 md:p-16 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 min-h-[60vh] flex flex-col justify-center relative z-20">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div className="order-2 md:order-1 bg-[#EFEAE2] rounded-3xl p-6 flex items-center justify-center h-[400px] overflow-hidden relative">
                <div className="w-[240px] h-[480px] bg-white rounded-[2rem] shadow-xl border-4 border-gray-800 flex flex-col translate-y-10 relative">
                  <div className="absolute -left-[6px] top-16 w-1 h-6 bg-gray-800 rounded-l-md"></div>
                  <div className="absolute -left-[6px] top-24 w-1 h-10 bg-gray-800 rounded-l-md"></div>
                  <div className="absolute -left-[6px] top-36 w-1 h-10 bg-gray-800 rounded-l-md"></div>
                  <div className="absolute -right-[6px] top-24 w-1 h-12 bg-gray-800 rounded-r-md"></div>

                  <div className="w-full h-full overflow-hidden rounded-[1.75rem] flex flex-col">
                    <div className="bg-[#075E54] text-white p-3 flex items-center gap-2 text-xs font-medium">
                      <ArrowRight className="w-4 h-4 rotate-180" /> Te Stesso (Tu)
                    </div>
                    <div className="flex-1 p-3 flex flex-col justify-end gap-2 bg-[#EFEAE2]">
                      <div className="bg-white p-2 rounded-lg shadow-sm self-end w-3/4">
                        <div className="flex items-center gap-2 border-b pb-1 mb-1"><User className="w-4 h-4" /> <span className="text-xs font-bold">Andrea</span></div>
                        <div className="text-[10px] text-gray-500">Contatto</div>
                      </div>
                      <div className="bg-[#dcf8c6] p-2 rounded-lg shadow-sm self-end text-xs">
                        Ricorda appuntamento domani
                      </div>
                    </div>
                    <div className="bg-gray-100 p-2 flex gap-2 items-center">
                      <div className="bg-white flex-1 rounded-full h-8"></div>
                      <div className="w-8 h-8 bg-[#00a884] rounded-full flex items-center justify-center text-white"><Send className="w-3 h-3 ml-0.5" /></div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="order-1 md:order-2">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                  <span className="text-primary font-bold text-xl">2</span>
                </div>
                <h3 className="text-3xl font-bold mb-4">Invia un Contatto a Te Stesso</h3>
                <p className="text-text-secondary mb-8">Apri la chat con te stesso su WhatsApp. Allega il contatto della persona a cui vuoi scrivere, aggiungi il messaggio e invia.</p>
              </div>
            </div>
          </div>

          {/* Card 3 */}
          <div className="hiw-card bg-white rounded-[3rem] p-10 md:p-16 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 min-h-[60vh] flex flex-col justify-center relative z-30">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div>
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                  <span className="text-primary font-bold text-xl">3</span>
                </div>
                <h3 className="text-3xl font-bold mb-4">Rilassati</h3>
                <p className="text-text-secondary mb-8">L&apos;AI capisce quando inviare il messaggio. Tu non devi fare altro. Ti avviseremo quando sar&agrave; consegnato.</p>
                <div className="inline-flex items-center gap-2 bg-green-50 text-green-700 px-4 py-2 rounded-full text-sm font-medium">
                  <CheckCircle2 className="w-4 h-4" /> Tutti inviati con successo
                </div>
              </div>
              <div className="bg-background rounded-3xl p-8 flex flex-col gap-4">
                {[1,2,3].map((i) => (
                  <div key={i} className="bg-white p-4 rounded-2xl shadow-sm flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center"><Check className="w-5 h-5 text-primary" /></div>
                      <div>
                        <div className="text-sm font-bold">Messaggio inviato</div>
                        <div className="text-xs text-gray-500">Oggi, 09:00</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
