'use client';

import React, { useState, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import { Button } from './Button';
import { Input } from './Input';
import { formatDatePhrase } from '../app/lib/quick-capture-utils';

interface QuickCaptureModalProps {
  open: boolean;
  onClose: () => void;
  userPhone: string;  // Marco's own phone (from /api/auth/me)
}

function normalizeClientPhone(raw: string): string | null {
  if (!raw) return null;
  let cleaned = raw.replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1);
    if (!/^\d{7,}$/.test(digits)) return null;
    return digits;
  }
  if (!/^\d{7,}$/.test(cleaned)) return null;
  // Italian default: if starts with 3 (mobile), prepend 39
  if (cleaned.startsWith('3') && !cleaned.startsWith('39')) {
    cleaned = '39' + cleaned;
  }
  return cleaned;
}

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function QuickCaptureModal({ open, onClose, userPhone }: QuickCaptureModalProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [datetime, setDatetime] = useState(() => toDatetimeLocal(new Date(Date.now() + 60 * 60 * 1000)));
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  if (!open) return null;

  function setPreset(kind: 'in1h' | 'tomorrow9' | 'tonight18') {
    const now = new Date();
    if (kind === 'in1h') {
      now.setHours(now.getHours() + 1);
      now.setMinutes(0);
    } else if (kind === 'tomorrow9') {
      now.setDate(now.getDate() + 1);
      now.setHours(9, 0, 0, 0);
    } else if (kind === 'tonight18') {
      if (now.getHours() >= 18) now.setDate(now.getDate() + 1);
      now.setHours(18, 0, 0, 0);
    }
    setDatetime(toDatetimeLocal(now));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const cleanPhone = normalizeClientPhone(phone);
    if (!cleanPhone) {
      setError('Numero non valido (es: 393331234567 o +447700900123)');
      return;
    }
    if (!message.trim()) {
      setError('Il messaggio non può essere vuoto');
      return;
    }
    if (message.length > 3500) {
      setError('Messaggio troppo lungo (max 3500 caratteri)');
      return;
    }

    const dt = new Date(datetime);
    if (isNaN(dt.getTime())) {
      setError('Data non valida');
      return;
    }
    if (dt.getTime() < Date.now() + 60 * 1000) {
      setError('Data deve essere almeno 1 minuto nel futuro');
      return;
    }

    const datePhrase = formatDatePhrase(dt);
    const namePart = name.trim() ? `${name.trim()} ` : '';
    const phrase = `Invia a ${namePart}${cleanPhone} ${datePhrase}: ${message.trim()}`;
    const url = `https://wa.me/${userPhone}?text=${encodeURIComponent(phrase)}`;

    window.location.href = url;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-surface rounded-3xl shadow-soft w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-text-primary">Nuovo follow-up</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Nome (opzionale)</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mario Cementi" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Numero (con prefisso)</label>
            <Input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="393331234567"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Quando</label>
            <Input
              type="datetime-local"
              value={datetime}
              onChange={(e) => setDatetime(e.target.value)}
              required
            />
            <div className="flex gap-2 mt-2 flex-wrap">
              <button type="button" onClick={() => setPreset('in1h')}
                className="text-xs px-3 py-1 rounded-full border border-border hover:bg-background">
                Tra 1h
              </button>
              <button type="button" onClick={() => setPreset('tomorrow9')}
                className="text-xs px-3 py-1 rounded-full border border-border hover:bg-background">
                Domani 9:00
              </button>
              <button type="button" onClick={() => setPreset('tonight18')}
                className="text-xs px-3 py-1 rounded-full border border-border hover:bg-background">
                Stasera 18:00
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Messaggio</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Mi mandi il preventivo per i sacchi?"
              rows={4}
              className="w-full px-4 py-2 border border-border rounded-xl text-text-primary focus:outline-none focus:border-primary"
              required
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-error-light text-error-dark text-sm">{error}</div>
          )}

          <Button type="submit" className="w-full">
            <Plus className="w-4 h-4 mr-2" /> Apri WhatsApp e invia
          </Button>
        </form>
      </div>
    </div>
  );
}
