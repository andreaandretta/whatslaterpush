'use client';
import Link from 'next/link';

// 2026-09-07: le tre testimonianze segnaposto con 5 stelle sono state rimosse.
// Con pochi utenti reali una recensione inventata è una passività, non un
// segnaposto: chi la scopre (un utente, un concorrente, un giornalista) non
// crede più a nulla del sito. Finché non ci sono citazioni VERE (nome, ruolo,
// città, con consenso scritto) questa sezione dice la verità sulla beta.
// Quando arrivano: una griglia di citazioni, una per persona, senza stelle.
export default function TestimonialsSection({ billingEnabled = true }: { billingEnabled?: boolean }) {
  return (
    <section id="testimonial" className="py-20 sm:py-24 bg-[#ECE5DD] wa-pattern">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <h2 className="font-heading text-3xl sm:text-4xl font-bold text-text-primary tracking-tight">
          In beta, senza recensioni inventate
        </h2>
        <p className="mt-4 text-[15px] sm:text-base leading-relaxed text-text-primary">
          WhatsLater è in beta. Niente stelle finte e niente citazioni inventate: le prime
          recensioni arriveranno da chi lo usa davvero, con nome e città. Se qui non ne vedi,
          è perché non ce ne sono ancora.
        </p>
        <p className="mt-6 text-sm text-text-secondary">
          {billingEnabled ? 'Vuoi provarlo? Il piano gratuito non scade.' : 'Vuoi far parte dei primi? Durante la beta è tutto gratis.'}{' '}
          <Link href="/connect" className="font-semibold text-[#075E54] underline underline-offset-2">
            Inizia in 2 minuti
          </Link>
        </p>
      </div>
    </section>
  );
}
