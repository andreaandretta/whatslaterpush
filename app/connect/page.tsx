'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MessageCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import ConnectStepper from '@/components/ConnectStepper';

type Phase = 'input' | 'pairing' | 'connecting' | 'error';

export default function ConnectPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('input');
  const [phone, setPhone] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorOnStep, setErrorOnStep] = useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  async function startInit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/init', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || `Errore ${res.status}`);
        setErrorOnStep(1);
        setPhase('error');
        return;
      }
      const data = await res.json();
      setSessionId(data.sessionId);
      setQrCode(data.qrCode || null);
      setPairingCode(data.pairingCode || null);
      setPhase('pairing');
      startPolling(data.sessionId);
    } catch (err: any) {
      setError(err?.message || 'Errore di rete');
      setErrorOnStep(1);
      setPhase('error');
    } finally {
      setSubmitting(false);
    }
  }

  function startPolling(sid: string) {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/check?sessionId=${sid}`);
        if (res.status === 410) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setError('Il QR è valido solo 10 minuti. Nessun problema — riprova.');
          setErrorOnStep(2);
          setPhase('error');
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (data.authenticated) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setPhase('connecting');
          setTimeout(() => router.push(data.redirect || '/dashboard'), 1200);
        }
      } catch {
        // Network blip: continue polling
      }
    }, 2000);
  }

  function reset() {
    if (pollTimer.current) clearInterval(pollTimer.current);
    setPhase('input');
    setQrCode(null);
    setPairingCode(null);
    setSessionId('');
    setError(null);
  }

  function goHome() {
    window.location.href = '/';
  }

  return (
    <div className="min-h-screen connect-bg relative">
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Slim navbar */}
        <nav className="flex items-center gap-2 px-6 py-5">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
            <MessageCircle className="w-4 h-4 text-white" fill="white" />
          </div>
          <span className="text-white font-bold font-heading">WhatsLater</span>
        </nav>

        {/* Heading (phase input and pairing only, OUTSIDE card on teal) */}
        {(phase === 'input' || phase === 'pairing') && (
          <div className="px-6 pt-4 pb-6 text-center">
            <h1 className="font-heading text-white text-2xl sm:text-3xl font-bold leading-tight">
              {phase === 'input' ? 'Collega WhatsApp' : 'Scansiona il QR'}
            </h1>
            <p className="text-white/70 mt-2 text-sm">
              {phase === 'input'
                ? 'Il tuo numero, niente app da installare.'
                : 'Tieni il telefono sul QR per 2 secondi.'}
            </p>
          </div>
        )}

        {/* Main card */}
        <div className="flex-1 flex items-start justify-center px-5 pb-10">
          <div className="w-full max-w-md bg-surface rounded-3xl p-6 shadow-2xl">

            {phase === 'input' && (
              <>
                <ConnectStepper currentStep={1} />
                <form onSubmit={startInit} className="space-y-4">
                  <div>
                    <label htmlFor="phone" className="block text-sm font-medium mb-2">
                      Numero WhatsApp
                    </label>
                    <Input
                      id="phone"
                      type="tel"
                      inputMode="tel"
                      placeholder="3331234567"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                    />
                    <p className="text-xs text-text-secondary mt-1.5">
                      Italiano senza prefisso · estero con &quot;+&quot;
                    </p>
                  </div>
                  <Button type="submit" className="w-full" isLoading={submitting}>
                    Procedi
                  </Button>
                </form>
              </>
            )}

            {phase === 'pairing' && (
              <>
                <ConnectStepper currentStep={2} />
                {qrCode && (
                  <div className="flex justify-center mb-4">
                    <div className="relative w-48 h-48 border-4 border-primary/20 rounded-xl p-2 bg-white">
                      <img src={qrCode} alt="QR code per connessione WhatsApp" className="w-full h-full" />
                    </div>
                  </div>
                )}
                {pairingCode && (
                  <div className="bg-[#ECE5DD]/40 rounded-xl px-3 py-2.5 mb-4">
                    <p className="text-[10px] uppercase text-text-secondary font-semibold tracking-wider">
                      Oppure inserisci questo codice
                    </p>
                    <p className="text-lg font-mono font-bold tracking-[0.25em] text-accent">
                      {pairingCode}
                    </p>
                  </div>
                )}
                <div className="border-t border-border pt-3 space-y-2">
                  <div className="flex items-start gap-2 text-xs">
                    <span className="w-5 h-5 bg-primary/15 text-accent rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">1</span>
                    <span>Apri <b>WhatsApp</b> sul tuo telefono</span>
                  </div>
                  <div className="flex items-start gap-2 text-xs">
                    <span className="w-5 h-5 bg-primary/15 text-accent rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">2</span>
                    <span>Tocca <b>Impostazioni → Dispositivi collegati</b></span>
                  </div>
                  <div className="flex items-start gap-2 text-xs">
                    <span className="w-5 h-5 bg-primary/15 text-accent rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">3</span>
                    <span>Scansiona il QR sopra 📱</span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-text-secondary">
                  <Loader2 className="w-3 h-3 animate-spin text-primary" />
                  <span>In attesa del pairing... (scade in 10 min)</span>
                </div>
                <div className="mt-2 text-center">
                  <button
                    type="button"
                    onClick={reset}
                    className="text-xs text-text-secondary underline hover:text-text-primary"
                  >
                    Annulla e ricomincia
                  </button>
                </div>
              </>
            )}

            {phase === 'connecting' && (
              <div className="text-center py-4">
                <ConnectStepper currentStep="done" />
                <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-primary/15 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-primary" />
                </div>
                <h2 className="font-heading text-xl font-bold">Connesso!</h2>
                <p className="text-sm text-text-secondary mt-2">
                  Ti stiamo portando alla dashboard...
                </p>
                <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-text-secondary">
                  <Loader2 className="w-3 h-3 animate-spin text-primary" />
                  <span>Un istante...</span>
                </div>
              </div>
            )}

            {phase === 'error' && (
              <div role="alert" className="text-center py-2">
                <ConnectStepper currentStep="error" errorOnStep={errorOnStep} />
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-red-50 flex items-center justify-center">
                  <AlertTriangle className="w-7 h-7 text-red-500" />
                </div>
                <h2 className="font-heading text-lg font-bold text-red-700">
                  {errorOnStep === 2 ? 'QR scaduto' : 'Si è verificato un errore'}
                </h2>
                <p className="text-sm text-text-secondary mt-2">
                  {error || 'Riprova tra qualche secondo.'}
                </p>
                <Button onClick={reset} className="w-full mt-5">Riprova</Button>
                <button
                  type="button"
                  onClick={goHome}
                  className="mt-2 text-xs text-text-secondary underline hover:text-text-primary"
                >
                  Torna al sito
                </button>
              </div>
            )}

          </div>
        </div>

        {/* Footer cues (phase 1 only) */}
        {phase === 'input' && (
          <div className="px-6 pb-8 flex justify-center gap-5 text-white/70 text-xs">
            <span>⚡ 2 min</span>
            <span>🔒 Cifrato</span>
            <span>💳 No carta</span>
          </div>
        )}
      </div>
    </div>
  );
}
