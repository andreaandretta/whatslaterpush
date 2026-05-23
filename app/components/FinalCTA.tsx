'use client';
import Link from 'next/link';

// Final-mile CTA — sits between FAQ and Footer.
// Same dark-green WA-pattern background as the hero so the page bookends
// symmetrically (hero ↔ this section ↔ footer). Single bright-green button is
// the only "Level 1" element in the section, matching the dashboard green
// hierarchy.
export default function FinalCTA() {
  return (
    <section className="relative bg-gradient-to-b from-[#075E54] to-[#064842] wa-pattern overflow-hidden py-20 sm:py-24">
      <div className="relative max-w-3xl mx-auto px-6 text-center">
        <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-white leading-tight tracking-tight">
          Pronto a non dimenticartene più?
        </h2>
        <p className="mt-4 text-lg text-white/75">
          Inizia gratis. Senza carta. In 2 minuti.
        </p>

        <div className="mt-8">
          <Link
            href="/connect"
            className="inline-flex items-center justify-center bg-primary text-white px-8 h-14 rounded-full text-base font-bold shadow-2xl shadow-primary/40 hover:bg-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#075E54]"
          >
            Programma il primo messaggio &rarr;
          </Link>
        </div>

        <p className="mt-4 text-sm text-white/55">
          3 messaggi/giorno gratis, sempre.
        </p>
      </div>
    </section>
  );
}
