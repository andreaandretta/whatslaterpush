'use client';
import Link from 'next/link';

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center bg-gradient-to-b from-[#075E54] to-[#128C7E] overflow-hidden pt-16 wa-pattern">
      <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        {/* Text */}
        <div className="text-center md:text-left">
          <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-white leading-tight">
            Programma i messaggi WhatsApp che ti dimentichi sempre di mandare.
          </h1>
          <p className="mt-4 text-lg text-[#25D366] font-medium leading-relaxed">
            Dal tuo numero personale. Per chi coordina squadre, fornitori e clienti ogni giorno.
          </p>
          <p className="mt-3 text-sm text-white/50">
            Setup in 2 minuti &middot; Nessuna app da installare
          </p>
          <div className="mt-8">
            <Link
              href="/connect"
              className="inline-flex items-center justify-center bg-primary text-white px-8 h-14 rounded-full text-base font-bold shadow-lg shadow-primary/30 hover:bg-primary-hover transition-colors"
            >
              Provalo gratis &mdash; niente carta
            </Link>
          </div>
        </div>

        {/* Phone mockup — static WhatsApp chat */}
        <div className="flex justify-center">
          <div className="w-[220px] sm:w-[260px] bg-[#0b141a] rounded-[2rem] border-2 border-white/10 overflow-hidden p-2 sm:p-3">
            <div className="rounded-2xl overflow-hidden">
              {/* Chat header */}
              <div className="bg-[#075E54] px-3 py-2.5 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-[#25D366] flex items-center justify-center">
                  <span className="text-white text-xs font-bold">W</span>
                </div>
                <div className="flex-1">
                  <div className="text-white text-xs font-semibold">WhatsLater</div>
                  <div className="text-[#93cfc4] text-[9px]">online</div>
                </div>
              </div>

              {/* Chat area */}
              <div className="bg-[#ECE5DD] p-3 space-y-2.5" style={{ minHeight: '320px' }}>
                {/* User bubble (right) */}
                <div className="flex justify-end">
                  <div className="bg-[#DCF8C6] rounded-lg rounded-tr-none px-2.5 py-1.5 max-w-[85%]">
                    <p className="text-[11px] text-[#111B21] leading-relaxed">
                      Invia a Marco domani alle 15: Ricorda l&apos;appuntamento! 📅
                    </p>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      <span className="text-[8px] text-[#667781]">10:23</span>
                      <span className="text-[8px] text-[#53BDEB]">✓✓</span>
                    </div>
                  </div>
                </div>

                {/* Bot reply (left) */}
                <div className="flex justify-start">
                  <div className="bg-white rounded-lg rounded-tl-none px-2.5 py-1.5 max-w-[85%]">
                    <p className="text-[11px] text-[#111B21] leading-relaxed whitespace-pre-line">{`✅ Perfetto! Invierò a Marco\ndomani alle 15:00:\n"Ricorda l'appuntamento!"`}</p>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      <span className="text-[8px] text-[#667781]">10:23</span>
                      <span className="text-[8px] text-[#53BDEB]">✓✓</span>
                    </div>
                  </div>
                </div>

                {/* Separator — Marco receives */}
                <div className="flex justify-center">
                  <div className="bg-[#E2F7CB] rounded-md px-3 py-0.5">
                    <span className="text-[9px] text-[#667781]">📨 Messaggio per Marco Rossi</span>
                  </div>
                </div>

                {/* Marco's received message (left) */}
                <div className="flex justify-start">
                  <div className="bg-white rounded-lg rounded-tl-none px-2.5 py-1.5 max-w-[85%]">
                    <p className="text-[11px] text-[#111B21] leading-relaxed">
                      Ciao! Ricorda l&apos;appuntamento di domani alle 15 🗓️
                    </p>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      <span className="text-[8px] text-[#667781]">15:00</span>
                      <span className="text-[8px] text-[#53BDEB]">✓✓</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Input bar */}
              <div className="bg-[#f0f0f0] px-2.5 py-1.5 flex items-center gap-2">
                <div className="flex-1 bg-white rounded-full px-3 py-1.5">
                  <span className="text-[10px] text-[#999]">Scrivi un messaggio</span>
                </div>
                <div className="w-7 h-7 rounded-full bg-[#25D366] flex items-center justify-center">
                  <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
