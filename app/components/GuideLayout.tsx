import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import Logo from './Logo';
import Footer from './Footer';
import { faqJsonLd, type FaqItem } from '../lib/site';

// Shared frame for the public guide pages (server component, no hooks).
// Same header as /privacy, prose body, FAQ block with FAQPage JSON-LD so
// answer engines can lift the Q&A, then the site footer.
interface GuideLayoutProps {
  title: string;
  lead: string;
  updated: string; // ISO date
  faqs?: FaqItem[];
  children: React.ReactNode;
}

function formatItDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });
}

export default function GuideLayout({ title, lead, updated, faqs, children }: GuideLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl text-text-primary hover:text-primary transition-colors">
            <Logo size={24} />
            <span>WhatsLater</span>
          </Link>
          <Link href="/" className="flex items-center gap-1 text-sm text-gray-500 hover:text-text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Torna al sito
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-14 sm:py-16">
        <article>
          <h1 className="font-heading text-3xl sm:text-4xl lg:text-[44px] font-black leading-tight tracking-tight text-text-primary mb-4">
            {title}
          </h1>
          <p className="text-lg text-[#5A6573] leading-relaxed mb-3">{lead}</p>
          <p className="text-sm text-gray-500 mb-12">Aggiornato il {formatItDate(updated)}</p>

          <div className="guide-prose space-y-10 text-[15px] sm:text-base leading-relaxed text-text-primary">
            {children}
          </div>

          {faqs && faqs.length > 0 && (
            <section className="mt-16" aria-labelledby="faq-title">
              <h2 id="faq-title" className="text-2xl font-bold text-text-primary mb-6">Domande frequenti</h2>
              <dl className="space-y-6">
                {faqs.map((f) => (
                  <div key={f.q} className="bg-white rounded-2xl border border-[#E9EDEF] p-5 sm:p-6">
                    <dt className="font-semibold text-text-primary mb-2">{f.q}</dt>
                    <dd className="text-text-secondary leading-relaxed">{f.a}</dd>
                  </div>
                ))}
              </dl>
              <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(faqs)) }}
              />
            </section>
          )}
        </article>
      </main>

      <Footer />
    </div>
  );
}

/** Green CTA used at the end of each guide. */
export function GuideCta({ label = 'Inizia gratis', note }: { label?: string; note?: string }) {
  return (
    <div className="mt-6 rounded-3xl bg-[#ECE5DD] wa-pattern p-6 sm:p-8 text-center">
      <Link
        href="/connect"
        className="inline-flex items-center justify-center bg-primary text-white px-8 h-12 rounded-full text-base font-bold shadow-lg shadow-primary/30 hover:bg-primary-hover transition-colors"
      >
        {label}
      </Link>
      {note && <p className="text-sm text-[#5A6573] mt-3">{note}</p>}
    </div>
  );
}
