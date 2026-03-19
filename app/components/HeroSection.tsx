'use client';
import Link from 'next/link';

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center bg-gradient-to-b from-accent to-text-primary overflow-hidden pt-16">
      <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        {/* Text */}
        <div className="text-center md:text-left">
          <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-white leading-tight">
            I tuoi clienti non dimenticano piu l&apos;appuntamento.
          </h1>
          <p className="mt-4 text-lg text-primary font-medium leading-relaxed">
            Il promemoria parte da WhatsApp, dal tuo numero, in automatico.
          </p>
          <p className="mt-3 text-sm text-white/50">
            Setup in 2 minuti &middot; Nessuna app da installare
          </p>
          <div className="mt-8">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center bg-primary text-white px-8 h-14 rounded-full text-base font-bold shadow-lg shadow-primary/30 hover:bg-primary/90 transition-colors"
            >
              Attiva i promemoria gratis
            </Link>
          </div>
          <p className="mt-3 text-xs text-white/40">Nessuna carta richiesta</p>
        </div>

        {/* Phone mockup */}
        <div className="flex justify-center">
          <div className="w-[220px] h-[440px] bg-[#1a1a1a] rounded-[2rem] border-2 border-white/10 overflow-hidden relative p-3">
            {/* Frame 1: Chat screen */}
            <div className="phone-frame flex flex-col h-full bg-[#0b141a] rounded-2xl p-3">
              <div className="text-xs text-white/50 mb-2">WhatsApp</div>
              <div className="mt-auto">
                <div className="bg-[#005c4b] rounded-lg p-2 text-xs text-white/90 max-w-[80%] ml-auto">
                  Ricorda appuntamento domani alle 15
                </div>
              </div>
            </div>
            {/* Frame 2: Message visible */}
            <div className="phone-frame flex flex-col h-full bg-[#0b141a] rounded-2xl p-3">
              <div className="text-xs text-white/50 mb-2">Marco Rossi</div>
              <div className="mt-auto space-y-2">
                <div className="bg-[#005c4b] rounded-lg p-2 text-xs text-white/90 max-w-[80%] ml-auto">
                  Ciao Marco! Ti ricordo l&apos;appuntamento di domani alle 15:00
                </div>
                <div className="text-[10px] text-white/30 text-right">14:59</div>
              </div>
            </div>
            {/* Frame 3: Sent check */}
            <div className="phone-frame flex flex-col items-center justify-center h-full bg-[#0b141a] rounded-2xl">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mb-3">
                <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm text-white font-medium">Inviato</p>
              <p className="text-xs text-white/40 mt-1">Promemoria consegnato</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
