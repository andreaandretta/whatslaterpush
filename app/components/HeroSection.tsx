'use client';
import Link from 'next/link';
import Image from 'next/image';

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center bg-gradient-to-b from-[#075E54] to-[#128C7E] overflow-hidden pt-16 wa-pattern">
      <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        {/* Text */}
        <div className="text-center md:text-left">
          <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-white leading-tight">
            Programma i messaggi WhatsApp che ti dimentichi sempre di mandare.
          </h1>
          <p className="mt-4 text-lg text-white font-medium leading-relaxed">
            Dal tuo <span className="font-bold">numero personale</span>. Per chi coordina squadre, fornitori e clienti ogni giorno.
          </p>
          <p className="mt-3 text-sm text-white/50">
            Setup in 2 minuti &middot; Nessuna app da installare
          </p>
          <div className="mt-8">
            <Link
              href="/connect"
              className="inline-flex items-center justify-center bg-primary text-white px-8 h-14 rounded-full text-base font-bold shadow-lg shadow-primary/30 hover:bg-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#075E54]"
            >
              Provalo gratis &mdash; niente carta
            </Link>
          </div>
        </div>

        {/* Dashboard hero — L0 real screenshot (Cesare-style simple, clean) */}
        <div className="flex flex-col items-center gap-4">
          <p className="text-xs sm:text-sm text-white/90 italic text-center max-w-[280px] leading-snug">
            Schedulato giovedì sera dalla dashboard, inviato dal tuo numero sabato mattina alle 9
          </p>
          <div className="rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
            <Image
              src="/hero-dashboard.jpg"
              alt="Dashboard WhatsLater con tre messaggi schedulati per allenatore, capitano U12 e squadra"
              width={768}
              height={1376}
              className="w-[240px] sm:w-[280px] h-auto block"
              priority
            />
          </div>
        </div>
      </div>
    </section>
  );
}
