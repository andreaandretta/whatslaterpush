'use client';

import { useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import HelpPopover from './HelpPopover';

interface Props {
  code: string;
  expiresAt: number | null;
  phoneNumber: string;
  onBack: () => void;
  onRegenerate: () => void;
}

// Step 2 — pairing code with one-click copy + countdown + deep-link to WhatsApp.
// Polling for pairing status happens in the parent (app/connect/page.tsx) so
// this component stays pure presentation + clipboard.
export default function StepCodice({ code, expiresAt, onBack, onRegenerate }: Props) {
  const [copied, setCopied] = useState(false);
  const [remaining, setRemaining] = useState<string>('');

  // Live countdown — ticks every second. When 0 the user is invited to
  // regenerate. Don't auto-regenerate (would mask backend issues).
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const ms = expiresAt - Date.now();
      if (ms <= 0) {
        setRemaining('00:00');
        return;
      }
      const total = Math.floor(ms / 1000);
      const m = Math.floor(total / 60).toString().padStart(2, '0');
      const s = (total % 60).toString().padStart(2, '0');
      setRemaining(`${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const expired = expiresAt !== null && Date.now() > expiresAt;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers (rare on mobile).
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative min-h-screen bg-white text-[#1A1F2C] overflow-hidden">
      <div className="absolute -top-32 -right-28 w-96 h-96 rounded-full bg-[#E8F8F0] blur-3xl opacity-80 pointer-events-none" />

      <div className="relative z-10 max-w-md mx-auto px-6 pt-6 pb-8 min-h-screen flex flex-col">
        {/* Nav */}
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm font-semibold text-[#5A6573]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Indietro
          </button>
          <Logo size={20} variant="onLight" />
          <HelpPopover />
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-1.5 mb-6">
          <span className="h-1.5 w-1.5 rounded-full bg-[#4FBE7C]" />
          <span className="h-1.5 w-8 rounded-full bg-[#075E54]" />
          <span className="h-1.5 w-1.5 rounded-full bg-gray-200" />
        </div>

        <div className="text-[11px] uppercase tracking-widest font-extrabold text-[#4FBE7C] mb-2.5">
          Passo 2 di 3
        </div>
        <h1 className="text-3xl sm:text-4xl font-black leading-tight tracking-tight">
          Collega <span className="text-[#4FBE7C]">WhatsApp</span>
        </h1>
        <p className="text-[#5A6573] mt-2.5 leading-relaxed text-sm">
          Tocca &ldquo;Apri WhatsApp&rdquo; o copia il codice e incollalo manualmente.
        </p>

        {/* Code card */}
        <div className="mt-6 bg-white border border-[#075E54]/10 rounded-2xl p-4 shadow-md shadow-black/5">
          <div className="text-[11px] uppercase tracking-widest font-extrabold text-[#5A6573] text-center mb-3">
            Il tuo codice
          </div>
          <div className="flex gap-2 mb-2.5">
            <div className="flex-1 bg-[#C8F2DE] rounded-xl py-4 text-center font-mono text-2xl font-bold tracking-widest text-[#1A1F2C] select-all">
              {code || '--------'}
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="bg-primary text-white rounded-xl px-4 text-[11px] font-extrabold uppercase tracking-wider flex flex-col items-center justify-center gap-1 shadow-lg shadow-primary/40 min-w-[72px]"
            >
              {copied ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Fatto
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copia
                </>
              )}
            </button>
          </div>
          <div className="text-center text-xs text-[#5A6573]">
            {expired ? (
              <button
                type="button"
                onClick={onRegenerate}
                className="text-[#075E54] underline font-semibold"
              >
                Codice scaduto · Rigenera
              </button>
            ) : (
              <>
                Scade in{' '}
                <strong className="text-amber-600 font-mono tabular-nums">{remaining || '--:--'}</strong>
              </>
            )}
          </div>
        </div>

        {/* Deep-link */}
        <a
          href="whatsapp://settings/linked-devices"
          className="mt-3 w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-xl border-2 border-[#075E54] text-[#075E54] font-extrabold text-sm bg-white"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487" />
          </svg>
          Apri WhatsApp e collega
        </a>

        {/* Manual instructions accordion */}
        <details className="mt-3 bg-white border border-gray-100 rounded-xl">
          <summary className="px-4 py-3 cursor-pointer text-[13px] font-extrabold flex items-center justify-between">
            Se preferisci a mano
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5A6573" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </summary>
          <div className="px-4 pb-3 space-y-2 text-[12px] text-[#1A1F2C] leading-relaxed">
            {[
              <>Apri <b>WhatsApp</b> e vai su <b>Impostazioni</b></>,
              <>Tocca <b>Dispositivi collegati</b> &rarr; <b>Collega dispositivo</b></>,
              <>Tocca <b>Collega con numero di telefono</b> e incolla il codice qui sopra</>,
            ].map((line, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-[#A8E6CF] text-[#075E54] text-[10px] font-extrabold flex items-center justify-center">
                  {i + 1}
                </span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </details>

        {/* Listening status */}
        <div className="mt-auto pt-6">
          <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-3 text-sm">
            <div className="flex gap-1 shrink-0">
              <span className="w-1.5 h-1.5 bg-[#4FBE7C] rounded-full animate-pulse" />
              <span className="w-1.5 h-1.5 bg-[#4FBE7C] rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
              <span className="w-1.5 h-1.5 bg-[#4FBE7C] rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
            </div>
            <div className="flex-1">
              <div className="font-bold text-[#1A1F2C]">In ascolto…</div>
              <div className="text-[12px] text-[#5A6573]">La pagina si aggiorna sola al collegamento.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
