'use client';

import React, { useState, useEffect } from 'react';
import { X, ArrowLeft, Calendar as CalendarIcon, UserCheck, Bell, ChevronRight, ChevronDown, Settings } from 'lucide-react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { DarkCalendarDialog } from './schedule/DarkCalendarDialog';
import { AnalogClockDialog } from './schedule/AnalogClockDialog';
import { ReminderBottomSheet, ReminderValue } from './schedule/ReminderBottomSheet';
import { SendFab } from './schedule/SendFab';

interface ScheduleModalProps {
  open: boolean;
  onClose: () => void;
  onBack: () => void;
  contact: { number: string; name?: string } | null;
  onScheduled: () => void;
}

const REMINDER_LABELS: Record<ReminderValue, string> = {
  '15min': '15 min prima',
  '30min': '30 min prima',
  '1h': '1 ora prima',
  '1day': '1 giorno prima',
  'never': 'Mai',
};

function defaultDateTime(): { date: Date; time: string } {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return {
    date: d,
    time: `${String(d.getHours()).padStart(2, '0')}:00`,
  };
}

function combineDateTime(date: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
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

export default function ScheduleModal({ open, onClose, onBack, contact, onScheduled }: ScheduleModalProps) {
  const init = defaultDateTime();
  const [selectedDate, setSelectedDate] = useState<Date>(init.date);
  const [selectedTime, setSelectedTime] = useState<string>(init.time);
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState('');
  const [reminder, setReminder] = useState<ReminderValue>('never');
  const [approval, setApproval] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [clockOpen, setClockOpen] = useState(false);
  const [reminderSheetOpen, setReminderSheetOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (open) {
      const d = defaultDateTime();
      setSelectedDate(d.date);
      setSelectedTime(d.time);
      setDescription('');
      setMessage('');
      setReminder('never');
      setApproval(false);
      setError(null);
      setSubmitting(false);
      setCalendarOpen(false);
      setClockOpen(false);
      setReminderSheetOpen(false);
      setAdvancedOpen(false);
    }
  }, [open]);

  if (!open || !contact) return null;

  const scheduledDate = combineDateTime(selectedDate, selectedTime);
  const isValidDate = scheduledDate.getTime() >= Date.now() + 60_000;
  const isValidMessage = message.trim().length > 0 && message.length <= 3500;
  const canSubmit = isValidDate && isValidMessage && !submitting;

  const contactLabel = contact.name || `+${contact.number}`;
  const dateLabel = format(scheduledDate, 'EEE d MMM', { locale: it });

  const hasReminder = reminder !== 'never';
  const advancedSummary = !approval && !hasReminder
    ? 'Nessuna notifica · invio automatico'
    : [
        approval ? 'Approvazione richiesta' : null,
        hasReminder ? `Promemoria: ${REMINDER_LABELS[reminder]}` : null,
      ].filter(Boolean).join(' · ');

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
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative bg-text-primary w-full h-full sm:w-[400px] sm:h-[700px] sm:max-h-[90vh] sm:rounded-3xl sm:shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-3 h-14 bg-[#202C33] shrink-0">
          <button
            onClick={onBack}
            aria-label="Indietro"
            className="p-2 rounded-full hover:bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="text-white font-medium text-base">Programma un messaggio</div>
        </div>

        <div className="flex-1 overflow-y-auto pb-24">
          <div className="flex items-start justify-between px-4 pt-5 pb-3">
            <div className="text-white font-bold text-xl">
              Messaggio per {contactLabel}
            </div>
            <button
              onClick={onClose}
              aria-label="Chiudi"
              className="p-1 rounded-full hover:bg-white/10 text-white -mr-1 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-4 pb-3">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrizione (facoltativa)"
              className="w-full bg-transparent text-white placeholder-gray-500 outline-none text-base py-1"
            />
          </div>

          <div className="border-t border-[#2A3942] mx-4" />

          <div className="flex items-center gap-4 px-4 py-2">
            <CalendarIcon className="w-5 h-5 text-gray-400 shrink-0" />
            <div className="flex items-center gap-1 text-white text-base">
              <button
                type="button"
                onClick={() => setCalendarOpen(true)}
                aria-label="Modifica data"
                className="capitalize hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 rounded p-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center"
              >
                {dateLabel}
              </button>
              <span className="text-gray-500">·</span>
              <button
                type="button"
                onClick={() => setClockOpen(true)}
                aria-label="Modifica orario"
                className="hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 rounded p-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center"
              >
                {selectedTime}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
            aria-controls="advanced-options"
            className="w-full flex items-center gap-4 px-4 py-3 hover:bg-white/5 text-left focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <Settings className="w-5 h-5 text-gray-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-white text-base">Opzioni avanzate</div>
              <div className="text-gray-400 text-sm mt-0.5 truncate">{advancedSummary}</div>
            </div>
            <ChevronDown
              className={`w-5 h-5 text-gray-500 shrink-0 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {advancedOpen && (
            <div id="advanced-options" className="border-t border-[#2A3942] mx-4 mt-1">
              <div className="flex items-start gap-4 py-4">
                <UserCheck className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="text-white text-base">Richiedi approvazione per l&apos;invio</div>
                  <div className="text-gray-400 text-sm mt-0.5">
                    Prima dell&apos;invio riceverai una notifica di conferma
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={approval}
                  aria-label="Richiedi approvazione"
                  onClick={() => setApproval((v) => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                    approval ? 'bg-primary' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                      approval ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setReminderSheetOpen(true)}
                className="w-full flex items-center gap-4 py-3 hover:bg-white/5 text-left focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <Bell className="w-5 h-5 text-gray-400 shrink-0" />
                <div className="flex-1 text-white text-base">Promemoria</div>
                <div className="text-primary text-base">{REMINDER_LABELS[reminder]}</div>
                <ChevronRight className="w-5 h-5 text-gray-500" />
              </button>
            </div>
          )}

          <div className="px-4 pt-4">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Scrivi il messaggio…"
              rows={5}
              maxLength={3500}
              className="w-full bg-[#1F2C33] text-white placeholder-gray-500 rounded-xl px-3 py-2 outline-none resize-none focus:ring-2 focus:ring-primary/30"
            />
            <div className="text-xs text-gray-500 text-right mt-1">{message.length}/3500</div>
          </div>

          {error && (
            <div className="mx-4 mt-3 p-3 rounded-xl bg-red-900/40 text-red-200 text-sm">
              {error}
              {error.includes('limite') && (
                <a href="#prezzi" className="underline ml-2">Aggiorna piano</a>
              )}
            </div>
          )}
        </div>

        <SendFab disabled={!canSubmit} loading={submitting} onClick={handleSubmit} />

        <DarkCalendarDialog
          open={calendarOpen}
          onClose={() => setCalendarOpen(false)}
          value={selectedDate}
          onConfirm={(d) => setSelectedDate(d)}
        />
        <AnalogClockDialog
          open={clockOpen}
          onClose={() => setClockOpen(false)}
          value={selectedTime}
          onConfirm={(s) => setSelectedTime(s)}
        />
        <ReminderBottomSheet
          open={reminderSheetOpen}
          onClose={() => setReminderSheetOpen(false)}
          value={reminder}
          onChange={(v) => setReminder(v)}
        />
      </div>
    </div>
  );
}
