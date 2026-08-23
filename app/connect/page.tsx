'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import StepNumero from '../components/connect/StepNumero';
import StepCodice from '../components/connect/StepCodice';
import StepPronto from '../components/connect/StepPronto';
import { classifyInitError, type InitUiError } from '../lib/connect-errors';

// Connect flow orchestrator — 3 steps:
//   1. Numero — user types phone, we POST to /api/auth/init to start session
//   2. Codice — show pairing code with copy button + countdown + listening
//   3. Pronto — bridge screen, 1.5s celebration, redirect to /dashboard
//
// Each step is a self-contained component. This file owns the state machine
// and talks to the existing /api/auth/* endpoints that already drive the
// Evolution API + Supabase session table.
//
// useSearchParams() forces this client component to bail out of static
// prerendering, which Next 14 only allows inside a Suspense boundary — so
// the actual flow lives in <ConnectFlow/> and the default export just wraps
// it. Fallback is null because the flow renders identical UI on first paint.
export default function ConnectPage() {
  return (
    <Suspense fallback={null}>
      <ConnectFlow />
    </Suspense>
  );
}

function ConnectFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Step machine. URL ?step=2 makes deep-links shareable for debugging.
  const initialStep = (searchParams.get('step') as '1' | '2' | '3') || '1';
  const [step, setStep] = useState<'1' | '2' | '3'>(initialStep);

  // Data carried across steps.
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);

  // Task 58: freno anti-martellamento. Errore classificato + istante fino al
  // quale il CTA resta bloccato (i retry compulsivi consumano il rate-limit
  // Meta del numero del cliente — visto dal vivo nell'incidente di agosto).
  const [initError, setInitError] = useState<InitUiError | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  // Anti doppio-tap (incidente 23 ago): due init in volo generano DUE codici
  // e le risposte possono arrivare fuori ordine → la UI mostra il codice
  // vecchio già invalidato → "codice errato" sul telefono. Un solo init alla
  // volta, sempre.
  const [submitting, setSubmitting] = useState(false);
  // Stato connessione dell'istanza durante il pairing (dal webhook, via
  // /api/auth/check): 'connecting' → "collegamento in corso" nella UI.
  const [connState, setConnState] = useState<string | null>(null);
  // Ref sempre allineata al codice mostrato: il poll gira in una closure con
  // deps [step, sessionId], senza ref confronterebbe un valore stantio e
  // resetterebbe il countdown a ogni tick.
  const pairingCodeRef = useRef('');

  // After pairing success, redirect to dashboard. The 1.5s delay lives in
  // StepPronto so the user actually sees the celebration animation.
  const handlePaired = () => {
    setStep('3');
    setTimeout(() => {
      // replace (not push) so /connect leaves the history stack — pressing
      // Back from the dashboard won't return to the pairing screen.
      router.replace('/dashboard');
    }, 1500);
  };

  // Step 1 submit → /api/auth/init creates an Evolution instance + returns
  // the pairing code. Existing route already handles the heavy lifting.
  const handleNumeroSubmit = async (rawNumber: string) => {
    // Belt: il freno UI vale anche se il CTA venisse aggirato (Enter, ecc.).
    if (cooldownUntil && Date.now() < cooldownUntil) return;
    if (submitting) return; // un solo init in volo
    setSubmitting(true);
    const number = rawNumber.replace(/\s/g, '');
    setPhoneNumber(number);

    try {
      const res = await fetch('/api/auth/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: number }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.pairingCode && data.sessionId) {
        setInitError(null);
        setCooldownUntil(null);
        pairingCodeRef.current = data.pairingCode;
        setPairingCode(data.pairingCode);
        setSessionId(data.sessionId);
        setConnState(null);
        // Evolution RIGENERA il codice ~ogni 45s (QRCODE_UPDATED): il
        // countdown onesto è ~60s, non 10 minuti. Alla rotazione il poll
        // sotto riceve il codice fresco e resetta il countdown.
        setCodeExpiresAt(Date.now() + 60 * 1000);
        setStep('2');
      } else {
        // Task 58: niente più alert() generico — classifica (rate-limit /
        // problema nostro / validazione) e attiva il freno col countdown.
        const e = classifyInitError(res.status, data, res.headers.get('Retry-After'));
        setInitError(e);
        setCooldownUntil(Date.now() + e.cooldownSec * 1000);
      }
    } catch {
      const e = classifyInitError(0, null, null);
      setInitError(e);
      setCooldownUntil(Date.now() + e.cooldownSec * 1000);
    } finally {
      setSubmitting(false);
    }
  };

  // Step 2 polls /api/auth/check until authenticated === true.
  // 410 means the session expired — stop polling and let the countdown in
  // StepCodice show 0:00 so the user can tap "Rigenera codice".
  useEffect(() => {
    if (step !== '2' || !sessionId) return;
    const interval = setInterval(async () => {
      try {
        // POST with sessionId in body keeps it out of URL access logs +
        // Sentry breadcrumbs. The endpoint no longer accepts GET.
        const res = await fetch('/api/auth/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        if (res.status === 410) {
          clearInterval(interval);
          return;
        }
        const data = await res.json();
        if (data.authenticated) {
          clearInterval(interval);
          handlePaired();
          return;
        }
        // Codice ruotato da Evolution → mostra SEMPRE quello corrente
        // (incidente "terno al lotto" 23 ago) e riparti col countdown.
        if (typeof data.pairingCode === 'string' && data.pairingCode && data.pairingCode !== pairingCodeRef.current) {
          pairingCodeRef.current = data.pairingCode;
          setPairingCode(data.pairingCode);
          setCodeExpiresAt(Date.now() + 60 * 1000);
        }
        if (typeof data.connState === 'string') setConnState(data.connState);
      } catch {
        // network blip — keep polling
      }
    }, 2500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sessionId]);

  return (
    <main className="min-h-screen bg-white">
      {step === '1' && <StepNumero onSubmit={handleNumeroSubmit} error={initError} cooldownUntil={cooldownUntil} submitting={submitting} />}
      {step === '2' && (
        <StepCodice
          code={pairingCode}
          expiresAt={codeExpiresAt}
          phoneNumber={phoneNumber}
          connState={connState}
          onBack={() => setStep('1')}
          onRegenerate={() => handleNumeroSubmit(phoneNumber)}
        />
      )}
      {step === '3' && <StepPronto />}
    </main>
  );
}
