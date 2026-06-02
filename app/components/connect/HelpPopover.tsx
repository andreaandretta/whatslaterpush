'use client';

import { useEffect, useRef, useState } from 'react';

// "?" button + popover used by StepNumero / StepCodice.
// Dark popover on light page — keeps contrast strong and stays out of the
// way until tapped. Closes on click-outside, Escape, or explicit ×.
export default function HelpPopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Come collego WhatsApp?"
        aria-expanded={open}
        className="w-8 h-8 rounded-full bg-[#C8F2DE] text-[#075E54] flex items-center justify-center"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Come collegare WhatsApp"
          className="absolute right-0 top-10 z-30 w-72 rounded-2xl bg-[#1A1F2C] text-white shadow-2xl border border-white/10 p-4"
        >
          <div className="flex items-start justify-between gap-2 mb-3">
            <h3 className="text-sm font-extrabold leading-snug">
              Come collego WhatsApp?
            </h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Chiudi"
              className="-m-1 p-1 text-white/60 hover:text-white shrink-0"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <ol className="space-y-2 text-[13px] leading-relaxed">
            {[
              <>Apri <b>WhatsApp</b> → <b>Impostazioni</b></>,
              <><b>Dispositivi collegati</b> → <b>Collega dispositivo</b></>,
              <><b>Collega con numero</b> → incolla il codice</>,
            ].map((line, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="shrink-0 w-5 h-5 rounded-full bg-[#25D366]/20 text-[#A8E6CF] text-[11px] font-extrabold flex items-center justify-center">
                  {i + 1}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
