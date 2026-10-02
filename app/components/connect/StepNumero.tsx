'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import Logo from '@/components/Logo';
import HelpPopover from './HelpPopover';
import type { InitUiError } from '@/app/lib/connect-errors';
import { readPairingNumber, phoneInputErrorMessage, flagEmoji, countryNameIt } from '@/app/lib/phone';

interface Props {
  onSubmit: (number: string) => void;
  submitting?: boolean;
  // Task 58: freno anti-martellamento — errore classificato + istante fino al
  // quale il CTA resta bloccato (ogni retry compulsivo su /api/auth/init
  // consuma il rate-limit Meta del numero del CLIENTE, non del server).
  error?: InitUiError | null;
  cooldownUntil?: number | null;
}

// Step 1 — Italian phone input, clean editorial style.
// • Fixed +39 prefix (single-country app; can be made selectable later).
// • Auto-formats as "333 123 4567" while typing.
// • CTA disabled until the number is valid (readPairingNumber: Italian by
//   default, "+39…"/"0039…" pasted or autofilled read in full, foreign only
//   with its "+"), with the reason under the field once it is long enough.
export default function StepNumero({ onSubmit, error = null, cooldownUntil = null, submitting = false }: Props) {
  const [raw, setRaw] = useState('');

  // Countdown del freno: tick a 1s solo mentre il cooldown è attivo.
  const [nowTs, setNowTs] = useState(() => Date.now());
  const cooldownActive = !!cooldownUntil && cooldownUntil > nowTs;
  useEffect(() => {
    if (!cooldownUntil || cooldownUntil <= Date.now()) return;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [cooldownUntil]);
  const remainingSec = cooldownActive ? Math.max(0, Math.ceil((cooldownUntil - nowTs) / 1000)) : 0;
  const mmss = `${Math.floor(remainingSec / 60)}:${String(remainingSec % 60).padStart(2, '0')}`;

  const ERROR_STYLES: Record<string, string> = {
    rate_limited: 'bg-[#FFF7E8] border-[#F5B84A] text-[#7A5200]',
    ours: 'bg-[#FDECEC] border-[#E5989E] text-[#7F1D1D]',
    generic: 'bg-gray-100 border-gray-300 text-[#1A1F2C]',
  };
  const ERROR_ICONS: Record<string, string> = { rate_limited: '⏳', ours: '🛠', generic: 'ℹ️' };

  // Il numero si legge TUTTO prima di formattare. Prima il campo teneva solo
  // le prime 10 cifre: "+39 347 123 4567" (autofill/incolla) diventava
  // "393 471 2345", e ritoccando una cifra si chiedeva il codice di pairing
  // per il numero di uno sconosciuto (hunt fase 1).
  const reading = useMemo(() => readPairingNumber(raw), [raw]);
  const international = /^\s*(\+|00)/.test(raw);

  // Format: groups of 3-3-4 for an Italian number typed by hand; anything
  // else (with "+", or more than 10 digits) stays as typed, never cut.
  const formatted = useMemo(() => {
    const d = raw.replace(/\D/g, '');
    if (international || d.length > 10) return raw;
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)} ${d.slice(3)}`;
    return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  }, [raw, international]);

  const handleChange = (value: string) => {
    const cleaned = value.replace(/[^\d+\s().\-]/g, '').slice(0, 24);
    const r = readPairingNumber(cleaned);
    // "+39 …" / "0039 …" / "39…" completo: nel campo resta la parte nazionale,
    // il +39 è già nel riquadro accanto.
    if (r.ok && r.national && cleaned.replace(/\D/g, '') !== r.national) setRaw(r.national);
    else setRaw(cleaned);
  };

  const digitsOnly = raw.replace(/\D/g, '');
  const isValid = reading.ok;
  // Il motivo compare solo quando il numero "dovrebbe" essere finito: mentre
  // si scrive le prime cifre non si sgrida nessuno.
  const inlineError = !reading.ok && (digitsOnly.length >= 10 || reading.error === 'extra_digit')
    ? phoneInputErrorMessage(reading.error)
    : null;
  const submit = () => reading.ok && !cooldownActive && !submitting && onSubmit(reading.digits);

  // Tastiera aperta (la parte visibile si accorcia): se "Continua" resta sotto,
  // lo si porta in vista. Solo col campo numero attivo e senza zoom: anche lo
  // zoom a due dita fa scattare 'resize', e la pagina saltava sul pulsante.
  // Da riprovare su iPhone vero.
  const ctaRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const keepVisible = () => {
      if (document.activeElement !== inputRef.current) return;
      if (typeof vv.scale === 'number' && Math.abs(vv.scale - 1) > 0.05) return;
      const btn = ctaRef.current?.querySelector('button');
      if (!btn || typeof btn.scrollIntoView !== 'function') return;
      if (btn.getBoundingClientRect().bottom > vv.offsetTop + vv.height) btn.scrollIntoView({ block: 'nearest' });
    };
    vv.addEventListener('resize', keepVisible);
    return () => vv.removeEventListener('resize', keepVisible);
  }, []);

  return (
    <div className="relative min-h-[100svh] bg-white text-[#1A1F2C] overflow-hidden">
      {/* soft mint blob top-right — single accent, not full pattern */}
      <div className="absolute -top-32 -right-28 w-96 h-96 rounded-full bg-[#E8F8F0] blur-3xl opacity-80 pointer-events-none" />

      {/* Su iPhone la tastiera dei numeri non ha Invio: "Continua" sta subito
          sotto il campo, così resta visibile con la tastiera aperta (prima era
          spinto in fondo con mt-auto e finiva sotto la tastiera). */}
      <div className="relative z-10 max-w-md mx-auto px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-8 min-h-[100svh] flex flex-col">
        {/* Nav */}
        <div className="flex items-center justify-between mb-4">
          <Link href="/" className="flex items-center gap-1.5 text-sm font-semibold text-[#5A6573]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Indietro
          </Link>
          <Logo size={20} variant="onLight" ringColor="#FFFFFF" />
          <HelpPopover />
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
        <div className="mt-6">
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#5A6573] mb-3">
            Numero
          </div>
          <div
            className={`flex items-center gap-2.5 pb-3 border-b-2 transition-colors ${
              isValid ? 'border-[#4FBE7C]' : 'border-gray-200'
            }`}
          >
            {!international && (
              <div className="flex items-center gap-1 px-2 py-1.5 bg-[#C8F2DE] rounded-lg font-mono text-base font-bold shrink-0">
                <span className="text-base leading-none">🇮🇹</span>
                +39
              </div>
            )}
            <input
              ref={inputRef}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              autoFocus
              value={formatted}
              onChange={(e) => handleChange(e.target.value)}
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
          {inlineError && (
            <p role="alert" className="mt-2 text-[13px] text-[#7F1D1D] leading-snug">{inlineError}</p>
          )}
          {reading.ok && !reading.italian && (
            <p className="mt-2 text-[13px] text-[#5A6573] leading-snug">
              Numero estero: {flagEmoji(reading.country)} {countryNameIt(reading.country)}{' '}
              <span className="font-mono font-bold text-[#1A1F2C]">{reading.international}</span>
            </p>
          )}
        </div>

        {/* CTA subito sotto il campo (niente mt-auto) */}
        <div ref={ctaRef} className="mt-5" data-testid="numero-cta">
          {error && (
            <div className={`mb-4 rounded-2xl border px-4 py-3 ${ERROR_STYLES[error.kind] || ERROR_STYLES.generic}`}>
              <div className="font-bold text-sm">{ERROR_ICONS[error.kind] || 'ℹ️'} {error.title}</div>
              <div className="text-[13px] mt-0.5 leading-snug">{error.message}</div>
              {cooldownActive && error.kind === 'rate_limited' && (
                <div className="text-[11px] mt-1.5 opacity-80">Il pulsante si riattiva da solo allo scadere del timer.</div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!isValid || cooldownActive || submitting}
            className={`w-full inline-flex items-center justify-center gap-2 py-4 rounded-full text-base font-extrabold transition-all ${
              isValid && !cooldownActive && !submitting
                ? 'bg-primary text-[#0B141A] shadow-xl shadow-primary/40'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {cooldownActive ? (
              <span className="tabular-nums">Riprova tra {mmss}</span>
            ) : (
              <>
                Continua
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </>
            )}
          </button>

          <p className="mt-3 text-center text-[11px] text-gray-400 leading-relaxed">
            Continuando accetti i{' '}
            <Link href="/terms" className="underline text-[#5A6573]">Termini</Link> e la{' '}
            <Link href="/privacy" className="underline text-[#5A6573]">Privacy</Link>.
          </p>
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

      </div>
    </div>
  );
}
