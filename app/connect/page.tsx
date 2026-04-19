'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Smartphone } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';

type Phase = 'input' | 'pairing' | 'connecting' | 'error';

export default function ConnectPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('input');
  const [phone, setPhone] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
          setError('QR scaduto. Riprova.');
          setPhase('error');
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (data.authenticated) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setPhase('connecting');
          router.push(data.redirect || '/dashboard');
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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary flex items-center justify-center">
            <Smartphone className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary">Connetti WhatsApp</h1>
          <p className="text-text-secondary mt-2">Inserisci il numero, scansiona il QR e accedi alla dashboard</p>
        </div>

        <div className="bg-surface rounded-3xl shadow-soft p-8">
          {phase === 'input' && (
            <form onSubmit={startInit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Numero WhatsApp (con prefisso, es. 393331234567)
                </label>
                <Input
                  type="tel"
                  inputMode="numeric"
                  placeholder="393331234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" isLoading={submitting}>Procedi</Button>
            </form>
          )}

          {phase === 'pairing' && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-text-secondary">
                Apri WhatsApp → Impostazioni → Dispositivi collegati → Collega un dispositivo
              </p>
              {qrCode && (
                <img src={qrCode} alt="QR code" className="mx-auto w-64 h-64" />
              )}
              {pairingCode && (
                <div>
                  <p className="text-xs text-text-secondary mb-1">oppure usa questo codice:</p>
                  <p className="text-2xl font-mono tracking-widest">{pairingCode}</p>
                </div>
              )}
              <p className="text-xs text-text-secondary flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> In attesa del pairing...
              </p>
              <button onClick={reset} className="text-sm text-primary underline">Annulla</button>
            </div>
          )}

          {phase === 'connecting' && (
            <div className="text-center space-y-3">
              <Loader2 className="w-10 h-10 animate-spin mx-auto text-primary" />
              <p>Accesso in corso...</p>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-4 text-center">
              <p className="text-error-dark">{error || 'Errore'}</p>
              <Button variant="outline" onClick={reset}>Riprova</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
