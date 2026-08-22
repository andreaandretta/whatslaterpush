'use client';
/**
 * CalendarSyncCard — dashboard card for the Google Calendar reminders feature.
 *
 * Self-contained: fetches GET /api/calendar on mount and decides what to show.
 * - Flag off ({enabled:false}) OR fetch failure → renders NOTHING (the feature
 *   stays invisible until the operator activates it, runbook
 *   docs/RUNBOOK-calendar-sync-attivazione.md).
 * - Not connected → compact explainer + "Collega Google Calendar" CTA.
 * - Connected → collapsed <details> with settings (offset, template, toggle,
 *   disconnect). PATCH on change, optimistic with rollback; feedback goes
 *   through the dashboard toast when provided (onShowToast), else console.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Calendar, ChevronDown } from 'lucide-react';

interface Props {
  // Dashboard toast surface. Optional — the card degrades to console logs so
  // it can be mounted anywhere without wiring.
  onShowToast?: (text: string) => void;
}

interface CardData {
  connected: boolean;
  email: string | null;
  reminderOffset: number;
  template: string; // '' = use the server-side default
  syncEnabled: boolean;
  reauthRequired: boolean;
}

// Mirror of DEFAULT_REMINDER_TEMPLATE in app/lib/calendar-sync.ts — inlined so
// the client bundle doesn't pull the sync lib (date-fns + locale) just for a
// placeholder string. Keep in sync if the default ever changes.
const DEFAULT_TEMPLATE_PLACEHOLDER =
  'Ciao {nome}, ti ricordo l\'appuntamento "{evento}" di {data} alle {ora}. A presto!';

const OFFSET_OPTIONS: { value: number; label: string }[] = [
  { value: 30, label: '30 minuti prima' },
  { value: 60, label: '1 ora prima' },
  { value: 120, label: '2 ore prima' },
  { value: 1440, label: '1 giorno prima' },
];

export default function CalendarSyncCard({ onShowToast }: Props) {
  // undefined = loading (render null), null = hidden for good (flag off/error)
  const [data, setData] = useState<CardData | null | undefined>(undefined);
  // Last template value acked by the server — blur only PATCHes real changes.
  const savedTemplate = useRef('');

  const toast = useCallback((text: string) => {
    if (onShowToast) onShowToast(text);
    else console.log('[calendar-sync]', text); // eslint-disable-line no-console
  }, [onShowToast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/calendar');
        if (cancelled) return;
        if (!res.ok) { setData(null); return; }
        const d = await res.json();
        if (d.enabled === false) { setData(null); return; }
        const template = d.message_template || '';
        savedTemplate.current = template;
        setData({
          connected: !!d.connected,
          email: d.email ?? null,
          reminderOffset: typeof d.reminder_offset_minutes === 'number' ? d.reminder_offset_minutes : 60,
          template,
          syncEnabled: d.sync_enabled !== false,
          reauthRequired: d.last_sync_error === 'reauth_required',
        });
      } catch {
        if (!cancelled) setData(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // PATCH a settings subset; caller passes the rollback state for failures.
  const patchSettings = useCallback(async (
    fields: Record<string, unknown>,
    okText: string,
    rollback: CardData,
  ) => {
    try {
      const res = await fetch('/api/calendar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        setData(rollback);
        toast('Non sono riuscito a salvare — riprova.');
        return false;
      }
      toast(okText);
      return true;
    } catch {
      setData(rollback);
      toast('Errore di rete — riprova.');
      return false;
    }
  }, [toast]);

  if (!data) return null;

  const goToAuth = () => { window.location.href = '/api/calendar/auth'; };

  // ── Not connected: explainer + CTA ──
  if (!data.connected) {
    return (
      <div className="bg-[#202C33] rounded-2xl border border-[#2A3942] p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <Calendar className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Promemoria da Google Calendar</p>
          <p className="text-xs text-gray-400 mt-0.5 leading-snug">
            Metti il numero del cliente nel titolo dell&apos;evento: il promemoria WhatsApp parte da solo.
          </p>
          <button
            onClick={goToAuth}
            className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-semibold bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 transition-colors"
          >
            Collega Google Calendar
          </button>
        </div>
      </div>
    );
  }

  // ── Connected: reauth banner + collapsed settings ──
  const handleOffsetChange = (value: number) => {
    const rollback = data;
    setData({ ...data, reminderOffset: value });
    patchSettings({ reminder_offset_minutes: value }, 'Anticipo promemoria salvato', rollback);
  };

  const handleToggle = () => {
    const rollback = data;
    const next = !data.syncEnabled;
    setData({ ...data, syncEnabled: next });
    patchSettings(
      { enabled: next },
      next ? 'Promemoria riattivati' : 'Promemoria in pausa',
      rollback,
    );
  };

  const handleTemplateBlur = async () => {
    const next = data.template.trim() ? data.template : '';
    if (next === savedTemplate.current) return;
    const rollback = { ...data, template: savedTemplate.current };
    const ok = await patchSettings(
      { message_template: next || null },
      'Testo del promemoria salvato',
      rollback,
    );
    if (ok) savedTemplate.current = next;
  };

  const handleDisconnect = async () => {
    const confirmed = window.confirm(
      'Scollegare Google Calendar? I promemoria automatici ancora in coda verranno annullati.'
    );
    if (!confirmed) return;
    try {
      const res = await fetch('/api/calendar', { method: 'DELETE' });
      if (!res.ok) {
        toast('Non sono riuscito a scollegare — riprova.');
        return;
      }
      savedTemplate.current = '';
      setData({
        connected: false,
        email: null,
        reminderOffset: 60,
        template: '',
        syncEnabled: true,
        reauthRequired: false,
      });
      toast('Google Calendar scollegato');
    } catch {
      toast('Errore di rete — riprova.');
    }
  };

  const offsetInList = OFFSET_OPTIONS.some((o) => o.value === data.reminderOffset);

  return (
    <div className="bg-[#202C33] rounded-2xl border border-[#2A3942] overflow-hidden">
      {data.reauthRequired && (
        <div className="px-4 py-3 bg-amber-500/10 border-b border-amber-500/30 flex items-center justify-between gap-3">
          <p className="text-xs text-amber-400 flex items-center gap-1.5 min-w-0">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="min-w-0">Accesso a Google scaduto — i promemoria sono fermi.</span>
          </p>
          <button
            onClick={goToAuth}
            className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
          >
            Ricollega
          </button>
        </div>
      )}

      <details>
        <summary className="flex items-center gap-3 p-4 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:bg-[#2A3942]/40 transition-colors">
          <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <Calendar className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">Promemoria da Google Calendar</p>
            <p className="text-xs text-gray-400 truncate">
              {data.email || 'Collegato'}
              {!data.syncEnabled && <span className="text-amber-400"> · in pausa</span>}
            </p>
          </div>
          <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" aria-hidden />
        </summary>

        <div className="px-4 pb-4 pt-3 space-y-4 border-t border-[#2A3942]">
          {/* Reminder offset */}
          <div>
            <label htmlFor="calendar-offset" className="block text-xs font-medium text-gray-400 mb-1.5">
              Quando inviare il promemoria
            </label>
            <select
              id="calendar-offset"
              value={data.reminderOffset}
              onChange={(e) => handleOffsetChange(parseInt(e.target.value, 10))}
              className="w-full bg-[#111B21] border border-[#2A3942] focus:border-primary rounded-xl px-3 py-2.5 text-sm text-white outline-none transition-colors"
            >
              {!offsetInList && (
                <option value={data.reminderOffset}>{data.reminderOffset} minuti prima</option>
              )}
              {OFFSET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Message template */}
          <div>
            <label htmlFor="calendar-template" className="block text-xs font-medium text-gray-400 mb-1.5">
              Testo del promemoria
            </label>
            <textarea
              id="calendar-template"
              rows={3}
              value={data.template}
              onChange={(e) => setData({ ...data, template: e.target.value })}
              onBlur={handleTemplateBlur}
              placeholder={DEFAULT_TEMPLATE_PLACEHOLDER}
              maxLength={3500}
              className="w-full bg-[#111B21] border border-[#2A3942] focus:border-primary rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition-colors resize-none leading-snug"
            />
            <p className="text-[11px] text-gray-500 mt-1 leading-snug">
              Variabili: <code className="text-gray-400">{'{nome}'}</code>{' '}
              <code className="text-gray-400">{'{evento}'}</code>{' '}
              <code className="text-gray-400">{'{data}'}</code>{' '}
              <code className="text-gray-400">{'{ora}'}</code>. Lascia vuoto per usare il testo standard.
            </p>
          </div>

          {/* Enabled toggle + disconnect */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              role="switch"
              aria-checked={data.syncEnabled}
              aria-label="Promemoria attivi"
              onClick={handleToggle}
              className="flex items-center gap-2.5 group"
            >
              <span
                className={`relative inline-flex w-10 h-6 rounded-full transition-colors ${
                  data.syncEnabled ? 'bg-primary' : 'bg-[#3B4A54]'
                }`}
                aria-hidden
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    data.syncEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                  }`}
                />
              </span>
              <span className="text-sm text-gray-300 group-hover:text-white transition-colors">Attivo</span>
            </button>

            <button
              type="button"
              onClick={handleDisconnect}
              className="text-[13px] font-medium text-red-400/80 hover:text-red-400 transition-colors px-2 py-1.5"
            >
              Scollega
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
