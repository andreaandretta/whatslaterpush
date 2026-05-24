'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import StepNumero from '../components/connect/StepNumero';
import StepCodice from '../components/connect/StepCodice';
import StepPronto from '../components/connect/StepPronto';

// Connect flow orchestrator — 3 steps:
//   1. Numero — user types phone, we POST to /api/auth/init to start session
//   2. Codice — show pairing code with copy button + countdown + listening
//   3. Pronto — bridge screen, 1.5s celebration, redirect to /dashboard
//
// Each step is a self-contained component. This file owns the state machine
// and talks to the existing /api/auth/* endpoints that already drive the
// Evolution API + Supabase session table.
export default function ConnectPage() {
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

  // After pairing success, redirect to dashboard. The 1.5s delay lives in
  // StepPronto so the user actually sees the celebration animation.
  const handlePaired = () => {
    setStep('3');
    setTimeout(() => {
      router.push('/dashboard');
    }, 1500);
  };

  // Step 1 submit → /api/auth/init creates an Evolution instance + returns
  // the pairing code. Existing route already handles the heavy lifting.
  const handleNumeroSubmit = async (rawNumber: string) => {
    const number = rawNumber.replace(/\s/g, '');
    setPhoneNumber(number);

    try {
      const res = await fetch('/api/auth/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: number }),
      });
      const data = await res.json();

      if (data.pairingCode && data.sessionId) {
        setPairingCode(data.pairingCode);
        setSessionId(data.sessionId);
        // Pairing codes from Evolution expire in ~10 minutes.
        setCodeExpiresAt(Date.now() + 600 * 1000);
        setStep('2');
      } else {
        alert(data.error || 'Errore di connessione. Riprova.');
      }
    } catch {
      alert('Errore di rete. Riprova.');
    }
  };

  // Step 2 polls /api/auth/check until authenticated === true.
  // 410 means the session expired — stop polling and let the countdown in
  // StepCodice show 0:00 so the user can tap "Rigenera codice".
  useEffect(() => {
    if (step !== '2' || !sessionId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/check?sessionId=${sessionId}`);
        if (res.status === 410) {
          clearInterval(interval);
          return;
        }
        const data = await res.json();
        if (data.authenticated) {
          clearInterval(interval);
          handlePaired();
        }
      } catch {
        // network blip — keep polling
      }
    }, 2500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sessionId]);

  return (
    <main className="min-h-screen bg-white">
      {step === '1' && <StepNumero onSubmit={handleNumeroSubmit} />}
      {step === '2' && (
        <StepCodice
          code={pairingCode}
          expiresAt={codeExpiresAt}
          phoneNumber={phoneNumber}
          onBack={() => setStep('1')}
          onRegenerate={() => handleNumeroSubmit(phoneNumber)}
        />
      )}
      {step === '3' && <StepPronto />}
    </main>
  );
}
