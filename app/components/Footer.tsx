'use client';

import Logo from '@/components/Logo';

interface FooterProps {
  theme?: 'light' | 'dark';
}

const SUPPORT_EMAIL = 'supporto@whatslater.it';

export default function Footer({ theme = 'light' }: FooterProps) {
  const dark = theme === 'dark';
  const topRadius = dark ? '' : 'rounded-t-[4rem]';

  return (
    <footer
      className={`bg-gradient-to-b from-[#075E54] to-[#053b35] ${topRadius} text-white pt-20 pb-10 px-6 mt-20`}
    >
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-12">
          {/* Brand */}
          <div className="col-span-2 sm:col-span-1">
            <div className="mb-3">
              <Logo withWordmark variant="onDark" size={22} ringColor="#075E54" />
            </div>
            <p className="text-white/70 text-sm mb-4 leading-snug">
              Promemoria WhatsApp automatici, dal tuo numero.
            </p>
            <span className="inline-block bg-white/10 text-white/80 text-xs px-3 py-1 rounded-full">
              Made in Italy 🇮🇹
            </span>
          </div>

          {/* Prodotto */}
          <div>
            <h3 className="text-white font-semibold text-sm uppercase tracking-wide mb-4">
              Prodotto
            </h3>
            <ul className="space-y-3 text-sm">
              <li>
                <a
                  href="#come-funziona"
                  className="text-white/70 hover:text-white transition-colors inline-flex items-center min-h-[40px]"
                >
                  Come funziona
                </a>
              </li>
              <li>
                <a
                  href="#prezzi"
                  className="text-white/70 hover:text-white transition-colors inline-flex items-center min-h-[40px]"
                >
                  Prezzi
                </a>
              </li>
              <li>
                <a
                  href="#faq"
                  className="text-white/70 hover:text-white transition-colors inline-flex items-center min-h-[40px]"
                >
                  Domande frequenti
                </a>
              </li>
              <li>
                <a
                  href="/connect"
                  className="text-white/70 hover:text-white transition-colors inline-flex items-center min-h-[40px]"
                >
                  Inizia gratis
                </a>
              </li>
            </ul>
          </div>

          {/* Legale */}
          <div>
            <h3 className="text-white font-semibold text-sm uppercase tracking-wide mb-4">
              Legale
            </h3>
            <ul className="space-y-3 text-sm">
              <li>
                <a
                  href="/privacy"
                  className="text-white/70 hover:text-white transition-colors inline-flex items-center min-h-[40px]"
                >
                  Privacy
                </a>
              </li>
              <li>
                <a
                  href="/terms"
                  className="text-white/70 hover:text-white transition-colors inline-flex items-center min-h-[40px]"
                >
                  Termini
                </a>
              </li>
              <li>
                <a
                  href="/cookie"
                  className="text-white/70 hover:text-white transition-colors inline-flex items-center min-h-[40px]"
                >
                  Cookie
                </a>
              </li>
            </ul>
          </div>

          {/* Contatti */}
          <div className="col-span-2 sm:col-span-1">
            <h3 className="text-white font-semibold text-sm uppercase tracking-wide mb-4">
              Contatti
            </h3>
            <ul className="space-y-3 text-sm">
              <li>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="text-white/70 hover:text-white transition-colors inline-flex items-center min-h-[40px]"
                >
                  {SUPPORT_EMAIL}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/50">
          <p>© 2026 WhatsLater</p>
          <p>I tuoi messaggi sono cifrati. Non li leggiamo mai.</p>
        </div>
      </div>
    </footer>
  );
}
