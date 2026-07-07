'use client';

// Three testimonials surfaced between How-it-works and Pricing — they're the
// "social proof" beat that sells the product before the user sees the price.
// All copy is placeholder until Andrea collects real quotes from beta users.
// When replacing, keep the persona breadth: one coach, one trades-person, one
// tutor / studio owner — the three personas the landing pitches to.
const testimonials = [
  {
    quote: '"Domenica sera, in 10 minuti schedulo i 4 promemoria della settimana per la squadra. Liberato dal pensiero."',
    name: 'Luca C.',
    role: 'Coach U12 · Torino',
    initials: 'LC',
    gradient: 'from-[#6B8E96] to-[#4A6670]',
  },
  {
    quote: '"Coordino 6 fornitori al giorno. WhatsLater mi fa risparmiare un\'ora ogni mattina. Vale i 5€."',
    name: 'Marco R.',
    role: 'Capo cantiere · Milano',
    initials: 'MR',
    gradient: 'from-[#F5A653] to-[#C2780B]',
  },
  {
    quote: '"Dimentico sempre di mandare i promemoria ai miei studenti. Ora parte tutto da solo. Setup in 3 minuti."',
    name: 'Elena S.',
    role: 'Tutor scuola media · Roma',
    initials: 'ES',
    gradient: 'from-[#8B6FBF] to-[#5A3F8C]',
  },
];

export default function TestimonialsSection({ billingEnabled = true }: { billingEnabled?: boolean }) {
  return (
    <section id="testimonial" className="py-20 sm:py-24 bg-[#ECE5DD] wa-pattern">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="font-heading text-3xl sm:text-4xl font-bold text-text-primary tracking-tight">
            Funziona davvero
          </h2>
          <p className="mt-2 text-text-secondary">3 storie da chi lo usa ogni giorno</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {testimonials.map((t, i) => (
            <figure
              key={i}
              className="bg-white rounded-2xl p-6 border border-[#075E54]/10 shadow-sm flex flex-col"
            >
              {/* Stars — flat unicode avoids icon dependencies and lines up perfectly. */}
              <div className="text-[#FFB300] text-sm tracking-[2px] mb-3" aria-label="5 stelle">
                ★★★★★
              </div>

              <blockquote className="text-[15px] leading-relaxed text-text-primary flex-1">
                {/* During the beta no price is visible anywhere — a quote citing
                    "i 5€" would reference a plan the visitor cannot see. */}
                {billingEnabled ? t.quote : t.quote.replace(' Vale i 5€.', '')}
              </blockquote>

              <figcaption className="flex items-center gap-3 mt-5 pt-5 border-t border-[#075E54]/10">
                <div
                  className={`w-10 h-10 rounded-full bg-gradient-to-br ${t.gradient} text-white font-bold flex items-center justify-center text-sm shrink-0 shadow-sm`}
                  aria-hidden="true"
                >
                  {t.initials}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-text-primary truncate">{t.name}</div>
                  <div className="text-xs text-text-secondary truncate">{t.role}</div>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
