'use client';

import React, { useState, useEffect } from 'react';
import { X, ArrowLeft, Calendar as CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { Button } from './Button';
import { ContactAvatar } from './ContactAvatar';
import { MiniCalendar } from './MiniCalendar';

interface ScheduleModalProps {
  open: boolean;
  onClose: () => void;
  onBack: () => void;
  contact: { number: string; name?: string } | null;
  onScheduled: () => void;
}

function defaultTime(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function ScheduleModal({ open, onClose, onBack, contact, onScheduled }: ScheduleModalProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<string>(defaultTime());
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedDate(new Date());
      setSelectedTime(defaultTime());
      setMessage('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open || !contact) return null;

  function combineDateTime(): Date {
    const [h, m] = selectedTime.split(':').map(Number);
    const d = new Date(selectedDate);
    d.setHours(h, m, 0, 0);
    return d;
  }

  function setPreset(kind: 'in1h' | 'tonight18' | 'tomorrow9') {
    const d = new Date();
    if (kind === 'in1h') {
      d.setHours(d.getHours() + 1);
    } else if (kind === 'tonight18') {
      if (d.getHours() >= 18) d.setDate(d.getDate() + 1);
      d.setHours(18, 0, 0, 0);
    } else if (kind === 'tomorrow9') {
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
    }
    setSelectedDate(d);
    setSelectedTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
  }

  const scheduledDate = combineDateTime();
  const isValidDate = scheduledDate.getTime() >= Date.now() + 60_000;
  const isValidMessage = message.trim().length > 0 && message.length <= 3500;
  const canSubmit = isValidDate && isValidMessage && !submitting;

  async function handleSubmit() {
    if (!canSubmit || !contact) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_number: contact.number,
          recipient_name: contact.name || undefined,
          message: message.trim(),
          scheduled_at: scheduledDate.toISOString(),
        }),
      });

      if (res.status === 200) {
        onScheduled();
        onClose();
        return;
      }

      const body = await res.json().catch(() => ({}));
      if (res.status === 403 && body.error === 'plan_contacts_limit_exceeded') {
        setError(`Hai raggiunto il limite di ${body.limit} contatti del piano ${body.plan}.`);
      } else if (body.error) {
        setError(translateError(body.error));
      } else {
        setError('Errore inatteso. Riprova.');
      }
    } catch {
      setError('Errore di rete. Riprova.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center sm:px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-white w-full h-full sm:h-auto sm:max-w-md sm:rounded-3xl sm:shadow-soft overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <button onClick={onBack} aria-label="Indietro" className="p-1 rounded-full hover:bg-gray-100">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <ContactAvatar name={contact.name} number={contact.number} size="sm" />
            <div>
              <div className="font-semibold text-text-primary text-sm">{contact.name || `+${contact.number}`}</div>
              <div className="text-xs text-text-secondary">+{contact.number}</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Chiudi" className="p-1 rounded-full hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <MiniCalendar selectedDate={selectedDate} onChange={setSelectedDate} />

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Orario</label>
            <input
              type="time"
              value={selectedTime}
              onChange={(e) => setSelectedTime(e.target.value)}
              className="w-full px-4 py-2 border border-border rounded-xl text-text-primary focus:outline-none focus:border-primary"
            />
            <div className="flex gap-2 mt-2 flex-wrap">
              <button type="button" onClick={() => setPreset('in1h')}
                className="text-xs px-3 py-1 rounded-full border border-border hover:bg-background">
                Tra 1h
              </button>
              <button type="button" onClick={() => setPreset('tonight18')}
                className="text-xs px-3 py-1 rounded-full border border-border hover:bg-background">
                Stasera 18:00
              </button>
              <button type="button" onClick={() => setPreset('tomorrow9')}
                className="text-xs px-3 py-1 rounded-full border border-border hover:bg-background">
                Domani 9:00
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm text-primary font-medium">
            <CalendarIcon className="w-4 h-4" />
            {format(scheduledDate, "EEEE d MMMM '·' HH:mm", { locale: it })}
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Messaggio</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Scrivi il messaggio…"
              rows={4}
              maxLength={3500}
              className="w-full px-4 py-2 border border-border rounded-xl text-text-primary focus:outline-none focus:border-primary"
            />
            <div className="text-xs text-text-secondary text-right mt-1">{message.length}/3500</div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-error-light text-error-dark text-sm">
              {error}
              {error.includes('limite') && (
                <a href="#prezzi" className="underline ml-2">Aggiorna piano</a>
              )}
            </div>
          )}

          <Button
            type="button"
            className="w-full"
            isLoading={submitting}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Schedula
          </Button>
        </div>
      </div>
    </div>
  );
}

function translateError(code: string): string {
  switch (code) {
    case 'invalid_phone': return 'Numero non valido.';
    case 'invalid_message': return 'Messaggio non valido (vuoto o oltre 3500 caratteri).';
    case 'invalid_datetime': return 'Data/ora non valida (deve essere almeno 1 minuto nel futuro).';
    case 'self_target': return 'Non puoi schedulare a te stesso.';
    default: return 'Errore: ' + code;
  }
}
