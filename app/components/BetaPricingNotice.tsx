import Link from 'next/link';

// Replaces <PricingSection/> on the landing while BILLING_ENABLED='false'
// (free beta). Keeps id="prezzi" so every existing anchor (Navbar, Footer,
// ScheduleModal error link, in-app copy) keeps scrolling somewhere that
// actually answers the pricing question. Server-safe: no hooks, no checkout.
// The numbers mirror the 'beta' entry in app/lib/plans.ts.
export default function BetaPricingNotice() {
  return (
    <section id="prezzi" className="py-24 bg-white">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <span className="inline-block bg-[#A8E6CF] text-[#075E54] px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider mb-3">
          Beta gratuita
        </span>
        <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-black mb-2 tracking-tight text-[#1A1F2C]">
          Durante la beta è <span className="text-[#4FBE7C]">tutto gratis</span>
        </h2>
        <p className="mb-10 text-[#5A6573]">
          Niente carta, niente piani da scegliere: tutto incluso.
        </p>

        <ul className="inline-flex flex-col items-start gap-3 text-left text-[#1A1F2C] mb-10">
          {[
            '50 messaggi programmati al giorno',
            '300 contatti attivi',
            'Storico di 90 giorni',
            'Etichette personalizzate incluse',
          ].map((f) => (
            <li key={f} className="flex items-center gap-2.5">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4FBE7C" strokeWidth="3" aria-hidden>
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="font-semibold">{f}</span>
            </li>
          ))}
        </ul>

        <p className="mb-8 text-sm text-[#5A6573]">
          I piani a pagamento arriveranno alla fine della beta: chi partecipa verrà avvisato in anticipo, direttamente nell&apos;app.
        </p>

        <Link
          href="/connect"
          className="inline-flex items-center justify-center bg-primary text-white px-8 h-14 rounded-full text-base font-bold shadow-2xl shadow-primary/40 hover:bg-primary-hover transition-colors"
        >
          Inizia gratis
        </Link>
      </div>
    </section>
  );
}
