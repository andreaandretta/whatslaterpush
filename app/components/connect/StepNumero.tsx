'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';

interface Props {
  onSubmit: (number: string) => void;
}

// Step 1 — Italian phone input, clean editorial style.
// • Fixed +39 prefix (single-country app; can be made selectable later).
// • Auto-formats as "333 123 4567" while typing.
// • CTA disabled until 10 digits.
export default function StepNumero({ onSubmit }: Props) {
  const [raw, setRaw] = useState('');

  // Format: groups of 3-3-4 for Italian mobile.
  const formatted = useMemo(() => {
    const d = raw.replace(/\D/g, '').slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)} ${d.slice(3)}`;
    return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  }, [raw]);

  const digitsOnly = raw.replace(/\D/g, '');
  const isValid = digitsOnly.length === 10;
  const submit = () => isValid && onSubmit(`39${digitsOnly}`);

  return (
    <div className="relative min-h-screen bg-white text-[#1A1F2C] overflow-hidden">
      {/* soft mint blob top-right — single accent, not full pattern */}
      <div className="absolute -top-32 -right-28 w-96 h-96 rounded-full bg-[#E8F8F0] blur-3xl opacity-80 pointer-events-none" />

      <div className="relative z-10 max-w-md mx-auto px-6 pt-6 pb-8 min-h-screen flex flex-col">
        {/* Nav */}
        <div className="flex items-center justify-between mb-4">
          <Link href="/" className="flex items-center gap-1.5 text-sm font-semibold text-[#5A6573]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Indietro
          </Link>
          <button
            type="button"
            aria-label="Aiuto"
            className="w-8 h-8 rounded-full bg-[#C8F2DE] text-[#075E54] flex items-center justify-center"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </button>
        </div>

        {/* Stepper pills */}
        <div className="flex items-center justify-center gap-1.5 mb-6">
          <span className="h-1.5 w-8 rounded-full bg-[#075E54]" />
          <span className="h-1.5 w-1.5 rounded-full bg-gray-200" />
          <span className="h-1.5 w-1.5 rounded-full bg-gray-200" />
        </div>

        <div className="text-[11px] uppercase tracking-widest font-extrabold text-[#4FBE7C] mb-2.5">
          Passo 1 di 3
        </div>
        <h1 className="text-3xl sm:text-4xl font-black leading-tight tracking-tight">
          Il tuo <span className="text-[#4FBE7C]">numero WhatsApp</span>
        </h1>
        <p className="text-[#5A6573] mt-2.5 leading-relaxed text-sm">
          Quello che usi ogni giorno. I messaggi programmati partiranno da qui.
        </p>

        {/* Input */}
        <div className="mt-8">
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#5A6573] mb-3">
            Numero
          </div>
          <div
            className={`flex items-center gap-2.5 pb-3 border-b-2 transition-colors ${
              isValid ? 'border-[#4FBE7C]' : 'border-gray-200'
            }`}
          >
            <div className="flex items-center gap-1 px-2 py-1.5 bg-[#C8F2DE] rounded-lg font-mono text-base font-bold shrink-0">
              <span className="text-base leading-none">🇮🇹</span>
              +39
            </div>
            <input
              type="tel"
              inputMode="numeric"
              autoFocus
              value={formatted}
              onChange={(e) => setRaw(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="333 123 4567"
              className="flex-1 min-w-0 bg-transparent border-none outline-none font-mono text-lg font-bold tracking-wide placeholder:text-gray-300"
            />
            <div
              className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                isValid ? 'bg-[#4FBE7C] text-white' : 'bg-gray-200 text-gray-400'
              }`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>
        </div>

        {/* Trust */}
        <div className="mt-5 flex items-center gap-2 text-[13px] text-[#5A6573] leading-snug">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4FBE7C" strokeWidth="2.2" className="shrink-0">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>
            Solo per generare il codice WhatsApp. <strong className="text-[#1A1F2C]">Niente SMS.</strong>
          </span>
        </div>

        {/* Push CTA to bottom */}
        <div className="mt-auto pt-10">
          <button
            type="button"
            onClick={submit}
            disabled={!isValid}
            className={`w-full inline-flex items-center justify-center gap-2 py-4 rounded-full text-base font-extrabold transition-all ${
              isValid
                ? 'bg-primary text-white shadow-xl shadow-primary/40'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            Continua
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>

          <p className="mt-3 text-center text-[11px] text-gray-400 leading-relaxed">
            Continuando accetti i{' '}
            <Link href="/terms" className="underline text-[#5A6573]">Termini</Link> e la{' '}
            <Link href="/privacy" className="underline text-[#5A6573]">Privacy</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
