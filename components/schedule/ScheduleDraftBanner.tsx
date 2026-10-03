'use client';

/**
 * "Riprendi bozza" per ScheduleModal. Tutta la logica sta qui, così nella
 * modale bastano tre righe: il hook, il banner e il clear dopo l'invio.
 * La persistenza vera è in app/lib/schedule-draft.ts (sessionStorage).
 */
import React, { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import type { MediaAttachment } from './MediaPicker';
import type { RecurrenceValue } from './RecurrenceBottomSheet';
import {
  clearScheduleDraft, draftDateTime, loadScheduleDraft, saveScheduleDraft, type ScheduleDraft,
} from '../../app/lib/schedule-draft';

interface DraftValues {
  message: string;
  date: Date;
  time: string;
  recurrence: RecurrenceValue;
  /** Giorni scelti per "ogni settimana" (Date.getDay()). */
  weekDays?: number[];
  media: MediaAttachment | null;
}

export interface DraftApply {
  message: string;
  media: MediaAttachment | null;
  recurrence: RecurrenceValue;
  weekDays: number[];
  /** null = l'orario della bozza è già passato: resta quello di default. */
  when: { date: Date; time: string } | null;
}

interface Options {
  /** Modale aperta su un messaggio NUOVO (in modifica il messaggio è già salvato). */
  enabled: boolean;
  contact: { number: string; name?: string } | null;
  initialMessage: string;
  initialMedia: MediaAttachment | null;
  values: DraftValues;
  apply: (d: DraftApply) => void;
}

export interface ScheduleDraftControl {
  pending: ScheduleDraft | null;
  resume: () => void;
  discard: () => void;
  /** Dopo un invio riuscito: la bozza non serve più. */
  clear: () => void;
}

function scheduledIso(date: Date, time: string): string {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h || 0, m || 0, 0, 0);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

export function useScheduleDraft(o: Options): ScheduleDraftControl {
  const [pending, setPending] = useState<ScheduleDraft | null>(null);
  const wasEnabled = useRef(false);
  const savedThisOpen = useRef(false);
  const applyRef = useRef(o.apply);
  applyRef.current = o.apply;

  const { message, date, time, recurrence, media } = o.values;
  const weekDays = o.values.weekDays ?? [];
  const number = o.contact?.number ?? null;
  const name = o.contact?.name;
  const sig = JSON.stringify([message, date.getTime(), time, recurrence, weekDays, media?.media_url ?? null]);

  useEffect(() => {
    if (!o.enabled || !number) {
      wasEnabled.current = false;
      setPending(null);
      return;
    }
    if (!wasEnabled.current) {
      // Primo render dopo l'apertura: lo stato della modale è ancora quello della
      // volta prima (lo azzera il suo effect, nello stesso giro). Qui si LEGGE
      // soltanto: salvare ora metterebbe il testo di Mario nella bozza di Luigi.
      wasEnabled.current = true;
      savedThisOpen.current = false;
      const blankOpen = !o.initialMessage && !o.initialMedia;
      setPending(blankOpen ? loadScheduleDraft(number) : null);
      return;
    }
    const hasContent = message.trim().length > 0 || media !== null;
    // Duplica/precompilato non toccato non è una bozza: lo è solo ciò che l'utente cambia.
    const changed = message !== o.initialMessage
      || (media?.media_url ?? null) !== (o.initialMedia?.media_url ?? null);
    if (hasContent && changed) {
      saveScheduleDraft({
        contactNumber: number,
        contactName: name,
        message,
        scheduledAt: scheduledIso(date, time),
        recurrence,
        weekDays,
        media,
      });
      savedThisOpen.current = true;
    } else if (!hasContent && savedThisOpen.current) {
      // L'utente ha svuotato tutto a mano: niente bozza da riproporre.
      clearScheduleDraft();
      savedThisOpen.current = false;
    }
  }, [o.enabled, number, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    pending,
    resume: () => {
      const d = pending;
      if (!d) return;
      applyRef.current({ message: d.message, media: d.media, recurrence: d.recurrence, weekDays: d.weekDays ?? [], when: draftDateTime(d) });
      setPending(null);
    },
    discard: () => {
      // Se nel frattempo l'utente ha scritto altro, quella è la bozza nuova: resta.
      if (!savedThisOpen.current) clearScheduleDraft();
      setPending(null);
    },
    clear: () => {
      clearScheduleDraft();
      savedThisOpen.current = false;
      setPending(null);
    },
  };
}

export function ScheduleDraftBanner({ draft }: { draft: ScheduleDraftControl }) {
  const d = draft.pending;
  if (!d) return null;
  const preview = d.message.trim() || d.media?.media_filename || '';
  return (
    <div role="status" data-testid="schedule-draft" className="mx-4 mt-3 p-3 rounded-xl bg-[#1F2C33] flex items-center gap-3">
      <FileText className="w-5 h-5 text-primary shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white font-medium">Hai una bozza non inviata</div>
        <div className="text-xs text-gray-400 truncate">{preview}</div>
      </div>
      <button
        type="button"
        onClick={draft.discard}
        className="text-xs text-gray-400 hover:text-gray-200 px-2 py-2 min-h-[44px]"
      >
        Scarta
      </button>
      <button
        type="button"
        onClick={draft.resume}
        className="text-xs font-semibold text-primary px-2 py-2 min-h-[44px] whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary/30 rounded"
      >
        Riprendi bozza
      </button>
    </div>
  );
}
