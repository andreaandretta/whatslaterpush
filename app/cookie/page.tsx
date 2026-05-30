import type { Metadata } from 'next';
import Link from 'next/link';
import { Calendar, ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Cookie Policy — WhatsLater',
  description: 'Informativa sui cookie utilizzati da WhatsLater.',
};

export default function CookiePage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 font-bold text-xl text-text-primary hover:text-primary transition-colors"
          >
            <Calendar className="w-6 h-6 text-primary" />
            <span>WhatsLater</span>
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Torna al sito
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-bold text-text-primary mb-4">Cookie Policy</h1>
        <p className="text-sm text-gray-500 mb-10">Ultimo aggiornamento: 31 maggio 2026</p>

        <section className="prose prose-gray max-w-none">
          <p>
            WhatsLater utilizza esclusivamente cookie tecnici strettamente necessari al
            funzionamento del servizio. Non vengono installati cookie di profilazione o di
            terze parti per finalità di marketing.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-3">Cookie tecnici</h2>
          <ul>
            <li>
              <strong>sw_session</strong> — cookie HTTP-only firmato (HMAC-SHA256) usato
              per mantenere la sessione autenticata phone-first. Durata: 90 giorni
              (sliding).
            </li>
          </ul>

          <h2 className="text-2xl font-semibold mt-8 mb-3">Come gestirli</h2>
          <p>
            Puoi disabilitare i cookie dalle impostazioni del tuo browser. Senza il
            cookie di sessione, l&apos;accesso all&apos;area autenticata non sarà
            possibile.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-3">Contatti</h2>
          <p>
            Per qualsiasi domanda relativa a questa policy, scrivi a{' '}
            <a
              href="mailto:supporto@whatslater.it"
              className="text-primary hover:underline"
            >
              supporto@whatslater.it
            </a>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
