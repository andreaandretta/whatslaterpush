'use client';
import Link from 'next/link';

// Final CTA — case-study mint band. Replaces the previous dark-green section.
// Mint background with subtle WA doodle, primary CTA, "echo" of the
// introduction mint band so the landing bookends symmetrically.
export default function FinalCTA({ billingEnabled = true }: { billingEnabled?: boolean }) {
  return (
    <section className="relative bg-[#A8E6CF] wa-doodle overflow-hidden py-20 sm:py-24">
      <div className="relative max-w-3xl mx-auto px-6 text-center">
        <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-black text-[#1A1F2C] leading-tight tracking-tight">
          Pronto a non <span className="text-[#075E54]">dimenticartene</span> più?
        </h2>
        <p className="mt-4 text-base sm:text-lg text-[#075E54]/80 font-semibold">
          Inizia gratis. Senza carta. In 2 minuti.
        </p>

        <div className="mt-8">
          <Link
            href="/connect"
            className="inline-flex items-center justify-center gap-2 bg-primary text-white px-8 h-14 rounded-full text-base font-bold shadow-2xl shadow-primary/40 hover:bg-primary-hover transition-colors"
          >
            Programma il primo messaggio
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>

        <p className="mt-4 text-sm text-[#075E54]/70 font-semibold">
          {/* The free-tier claim is wrong during the beta (everything is free). */}
          {billingEnabled ? '3 messaggi/giorno gratis, sempre.' : 'Tutto gratis durante la beta.'}
        </p>
      </div>
    </section>
  );
}
