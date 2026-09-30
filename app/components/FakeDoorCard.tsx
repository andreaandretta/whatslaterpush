'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { FAKE_DOOR_FEATURE, type FakeDoorAnswer } from '../lib/fake-door';

// Porta finta "foto del calendario" (D14): misura l'interesse prima di
// costruire la funzione. La X nasconde la scheda solo su questo dispositivo e
// non registra niente; una risposta si salva una volta sola (/api/feedback).

const HIDDEN_KEY = 'wl_fakedoor_calendar_hidden';

const CHOICES: { answer: FakeDoorAnswer; label: string }[] = [
  { answer: 'lt10', label: 'Meno di 10' },
  { answer: '10_30', label: '10-30' },
  { answer: 'gt30', label: 'Più di 30' },
  { answer: 'no', label: 'Non mi serve' },
];

type State = 'idle' | 'sending' | 'error' | 'done' | 'hidden';

function hiddenOnThisDevice(): boolean {
  try { return window.localStorage.getItem(HIDDEN_KEY) === '1'; } catch { return false; }
}

export default function FakeDoorCard({ onAnswered }: { onAnswered: () => void }) {
  const [state, setState] = useState<State>(() => (hiddenOnThisDevice() ? 'hidden' : 'idle'));
  const onAnsweredRef = useRef(onAnswered);
  onAnsweredRef.current = onAnswered;
  // Risposta salvata: il genitore lo deve sapere una volta, anche se la scheda
  // si smonta prima dei 2,5 s (cambio scheda, ricerca) o è stata chiusa con la X.
  const savedRef = useRef(false);
  const notifiedRef = useRef(false);
  const closedRef = useRef(false);
  const mountedRef = useRef(true);
  const notify = useCallback(() => {
    if (notifiedRef.current) return;
    notifiedRef.current = true;
    onAnsweredRef.current();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (savedRef.current) notify();
    };
  }, [notify]);

  // Il ringraziamento resta 2,5 s, poi la scheda sparisce.
  useEffect(() => {
    if (state !== 'done') return;
    const t = setTimeout(() => { setState('hidden'); notify(); }, 2500);
    return () => clearTimeout(t);
  }, [state, notify]);

  if (state === 'hidden') return null;

  const close = () => {
    closedRef.current = true;
    try { window.localStorage.setItem(HIDDEN_KEY, '1'); } catch { /* modalità privata */ }
    setState('hidden');
  };

  const answer = async (a: FakeDoorAnswer) => {
    if (state === 'sending') return;
    setState('sending');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature: FAKE_DOOR_FEATURE, answer: a }),
      });
      if (res.ok) savedRef.current = true;
      // Chiusa con la X o smontata durante l'invio: niente ringraziamento né
      // errore a schermo, ma una risposta salvata si comunica lo stesso.
      if (closedRef.current || !mountedRef.current) {
        if (res.ok) notify();
        return;
      }
      // 409 = domanda chiusa nel frattempo: la scheda sparisce senza dire niente.
      if (res.status === 409) { setState('hidden'); return; }
      setState(res.ok ? 'done' : 'error');
    } catch {
      if (closedRef.current || !mountedRef.current) return;
      setState('error');
    }
  };

  return (
    <div className="mt-5 rounded-2xl border border-dashed border-[#2C5A4C] bg-[#17302A] p-4 relative" data-testid="fake-door-calendar">
      <button
        type="button"
        onClick={close}
        aria-label="Chiudi"
        className="absolute top-0 right-0 w-11 h-11 inline-flex items-center justify-center rounded-full text-gray-400 hover:text-white"
      >
        <X className="w-4 h-4" />
      </button>
      {state === 'done' ? (
        <p className="text-sm text-white pr-10" role="status">Grazie! Ci aiuta a decidere.</p>
      ) : (
        <>
          <p className="text-sm font-semibold text-white pr-10">Carica la foto del calendario della stagione</p>
          <p className="text-xs text-gray-400 mt-0.5 pr-10">In arrivo. Non c&apos;è ancora. Ci aiuti a capire se serve?</p>
          <p className="text-sm text-gray-200 mt-3">Quante date ha il tuo calendario?</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {CHOICES.map((c) => (
              <button
                key={c.answer}
                type="button"
                onClick={() => { void answer(c.answer); }}
                disabled={state === 'sending'}
                className="text-xs px-3 py-2 min-h-[44px] rounded-full bg-[#2A3942] text-gray-200 hover:bg-[#3B4A54] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {c.label}
              </button>
            ))}
          </div>
          {state === 'error' && (
            <p className="text-xs text-red-300 mt-2" role="alert">Non è arrivata: riprova.</p>
          )}
        </>
      )}
    </div>
  );
}
