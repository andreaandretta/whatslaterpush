'use client';
import Link from 'next/link';
import Image from 'next/image';

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center bg-gradient-to-b from-[#075E54] to-[#128C7E] overflow-hidden pt-16 wa-pattern">
      <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        {/* Text */}
        <div className="text-center md:text-left">
          <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-white leading-tight tracking-tight">
            Programma messaggi WhatsApp dal tuo numero. Anche quando non ci sei.
          </h1>
          <p className="mt-5 text-lg text-white/90 font-medium leading-relaxed">
            Per <span className="font-bold text-white">coach, tutor e capi cantiere</span> che mandano gli stessi promemoria ogni settimana.
          </p>
          <div className="mt-8">
            <Link
              href="/connect"
              className="inline-flex items-center justify-center bg-primary text-white px-8 h-14 rounded-full text-base font-bold shadow-lg shadow-primary/30 hover:bg-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#075E54]"
            >
              Inizia gratis &mdash; niente carta &rarr;
            </Link>
          </div>
        </div>

        {/* Dashboard hero — phone with story callout */}
        <div className="flex flex-col items-center gap-3 md:gap-4">
          {/* Story callout — replaces the unreadable italic caption.
              backdrop-blur + soft border = floats on the WA pattern, reads at a glance. */}
          <div className="relative max-w-[300px] bg-white/10 backdrop-blur-md border border-white/15 rounded-2xl px-4 py-3 text-white text-sm leading-snug shadow-lg">
            Lo <span className="font-bold text-primary">scheduli giovedì sera</span>, parte dal tuo numero{' '}
            <span className="font-bold text-primary">sabato alle 9:00</span>. Tu nel frattempo dormi.
            {/* Arrow pointing to phone below */}
            <span className="absolute -bottom-1.5 right-10 w-3 h-3 bg-white/10 backdrop-blur-md border-r border-b border-white/15 rotate-45"></span>
          </div>

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
