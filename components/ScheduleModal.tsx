'use client';

import React, { useState, useEffect } from 'react';
import { X, ArrowLeft, Calendar as CalendarIcon, UserCheck, Bell, ChevronRight, ChevronDown, Settings, Repeat, FileText, Paperclip } from 'lucide-react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { DarkCalendarDialog } from './schedule/DarkCalendarDialog';
import { AnalogClockDialog } from './schedule/AnalogClockDialog';
import { ReminderBottomSheet, ReminderValue } from './schedule/ReminderBottomSheet';
import { RecurrenceBottomSheet, RecurrenceValue, buildRRule, recurrenceLabel } from './schedule/RecurrenceBottomSheet';
import { TemplateBottomSheet, TemplatePick } from './schedule/TemplateBottomSheet';
import { MediaPicker, MediaAttachmentChip, MediaAttachment } from './schedule/MediaPicker';
import { SendFab } from './schedule/SendFab';
import { applyTemplateVariables, hasTemplateVariables, firstNameOf } from '../app/lib/template-variables';
import { formatSendCta, quickDateChips, isSameDay, courtesyHint, proposedSendTime, sendBlockReason, recurrenceTagLabel } from '../app/lib/schedule-quick';
import { apiErrorText } from '../app/lib/api-error-text';
import { romeWallClock, instantFromRomeWallClock, browserIsOutsideRome } from '../app/lib/rome-time';
import { unfilledPlaceholders } from '../app/lib/placeholders';
import { useModalHistory } from '../app/lib/use-modal-history';
import { useScheduleDraft, ScheduleDraftBanner } from './schedule/ScheduleDraftBanner';
import { isGroupJid, realPersonName, formatPhoneForDisplay } from '../app/lib/jid';
import { getGroupsSnapshot } from '../app/lib/contacts-client-cache';
import type { PickedContact } from './ContactPickerModal';

// Feature flag: "Richiedi approvazione" e "Promemoria" sono raccolti dalla UI
// ma NON ancora consegnati end-to-end (handleSubmit non li invia, non c'è cron
// promemoria). Nascosti finché non implementati per non promettere qualcosa che
// non accade. Riattivazione futura = mettere true QUI e fare il wiring backend
// (invio dei campi nel POST + colonna DB + flusso conferma/promemoria).
const ADVANCED_APPROVAL_REMINDER_ENABLED = false;

interface ScheduleModalProps {
  open: boolean;
  onClose: () => void;
  onBack: () => void;
  contact: PickedContact | null;
  onScheduled: () => void;
  /** Pre-fill the message body — used by Duplica/Modifica from the dashboard. */
  initialMessage?: string;
  // Allegato già presente sul messaggio che si sta modificando (edit mode) o
  // duplicando (Duplica): in entrambi i casi la modale lo mostra e lo invia.
  initialMedia?: MediaAttachment | null;
  /** When set, the modal is in edit mode: handleSubmit calls PATCH instead of POST. */
  editMsgId?: string | null;
  /** Edit mode: orario e ripetizione attuali del messaggio, da cui ripartire. */
  initialScheduledAt?: string | null;
  initialRecurrenceRule?: string | null;
  /** Duplica di un messaggio il cui allegato è già stato rimosso dalla pulizia. */
  mediaUnavailable?: boolean;
  /** Stato del collegamento WhatsApp (false = scollegato). */
  connected?: boolean;
  /** Edit mode aperto da "Riattiva" su un orario passato: al salvataggio il
   *  messaggio torna anche in coda (status pending), non resta in pausa. */
  resumeOnSave?: boolean;
}

const REMINDER_LABELS: Record<ReminderValue, string> = {
  '15min': '15 min prima',
  '30min': '30 min prima',
  '1h': '1 ora prima',
  '1day': '1 giorno prima',
  'never': 'Mai',
};

// "Gruppo · 19 persone", "Gruppo · 1 persona", "Gruppo" (numero sconosciuto), più l'eventuale
// distintivo degli omonimi. Mai le cifre del JID.
function groupSubtitle(size: number | null, hint: string | null): string {
  const parts = ['Gruppo'];
  if (typeof size === 'number' && size > 0) parts.push(size === 1 ? '1 persona' : `${size} persone`);
  if (hint) parts.push(hint);
  return parts.join(' · ');
}

function mediaChanged(a: MediaAttachment | null, b: MediaAttachment | null): boolean {
  if (!a && !b) return false;
  if (!a || !b) return true;
  return a.media_url !== b.media_url;
}

// Data e ora dei selettori sono l'ora di ROMA ("orologio fluttuante", vedi
// app/lib/rome-time.ts): il server calcola ricorrenze e fascia 08-21 su Roma.
// Con il telefono in ora italiana non cambia nulla; da Lisbona prima un "ogni
// lunedì 23:30" diventava lunedì 00:30 a Roma dalla seconda volta in poi.
// Proposta: almeno 30 minuti di margine, e mai di sera tardi (proposedSendTime).
function defaultDateTime(): { date: Date; time: string } {
  const d = proposedSendTime(romeWallClock(new Date()));
  return {
    date: d,
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  };
}

// Giorno + ora dei selettori → orologio di Roma (fluttuante). L'istante vero
// si ottiene con instantFromRomeWallClock.
function combineDateTime(date: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

// Regola salvata → valore del selettore. null = nessuna ripetizione; 'unknown'
// = una regola che la modale non sa rappresentare (va lasciata com'è).
function recurrenceFromRule(rule: string | null | undefined, at: Date | null): RecurrenceValue | 'unknown' {
  if (!rule) return 'none';
  // Riconosciuta solo se la modale la ricostruirebbe IDENTICA (niente INTERVAL,
  // BYDAY multipli...): altrimenti 'unknown' e il PATCH non la tocca.
  const candidates: RecurrenceValue[] = ['daily', 'weekly', 'monthly'];
  for (const v of candidates) if (at && buildRRule(v, at) === rule) return v;
  return 'unknown';
}

// In modifica si riparte dall'orario del messaggio, non da "tra un'ora": prima
// correggere solo il testo di una convocazione di sabato la spostava a oggi.
function initialDateTime(editMsgId: string | null, initialScheduledAt: string | null | undefined): { date: Date; time: string } {
  if (editMsgId && initialScheduledAt) {
    const at = new Date(initialScheduledAt);
    if (!isNaN(at.getTime()) && at.getTime() >= Date.now() + 60_000) {
      const d = romeWallClock(at);
      return { date: d, time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
    }
  }
  return defaultDateTime();
}

// Stesso minuto dell'orario salvato? (lo scheduled_at in DB ha il jitter in
// secondi, i selettori no.)
function sameMinute(a: Date, iso: string | null | undefined): boolean {
  if (!iso) return false;
  const b = new Date(iso);
  if (isNaN(b.getTime())) return false;
  return Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000);
}

export default function ScheduleModal({ open, onClose, onBack, contact, onScheduled, initialMessage = '', editMsgId = null, initialMedia = null, initialScheduledAt = null, initialRecurrenceRule = null, mediaUnavailable = false, connected = true, resumeOnSave = false }: ScheduleModalProps) {
  const init = defaultDateTime();
  const [selectedDate, setSelectedDate] = useState<Date>(init.date);
  const [selectedTime, setSelectedTime] = useState<string>(init.time);
  const [message, setMessage] = useState(initialMessage);
  const [reminder, setReminder] = useState<ReminderValue>('never');
  const [recurrence, setRecurrence] = useState<RecurrenceValue>('none');
  const [approval, setApproval] = useState(false);

  // Template selection state. selectedSeedId is set when the user picks a seed
  // template: it drives the "Modificato" label and is sent as
  // source_template_id when the user opts in to "Salva come mio template".
  const [selectedSeedId, setSelectedSeedId] = useState<string | null>(null);

  // "Salva come mio template": opt-in esplicito PRIMA dell'invio (casella
  // spenta di default). Sostituisce il popup automatico post-invio: il
  // prodotto non interrompe l'utente, è lui a spuntare se vuole il template.
  const [saveTemplateChecked, setSaveTemplateChecked] = useState(false);
  const [templateTitle, setTemplateTitle] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [clockOpen, setClockOpen] = useState(false);
  const [reminderSheetOpen, setReminderSheetOpen] = useState(false);
  const [recurrenceSheetOpen, setRecurrenceSheetOpen] = useState(false);
  const [templateSheetOpen, setTemplateSheetOpen] = useState(false);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [media, setMedia] = useState<MediaAttachment | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // La ripetizione esistente si rimanda al PATCH solo se l'utente la tocca o se
  // cambia davvero: prima ogni modifica mandava recurrence_rule=null e un
  // promemoria settimanale smetteva di ripetersi senza che nessuno lo chiedesse.
  const [recurrenceTouched, setRecurrenceTouched] = useState(false);
  const initialRecurrence = recurrenceFromRule(
    editMsgId ? initialRecurrenceRule : null,
    initialScheduledAt ? romeWallClock(new Date(initialScheduledAt)) : null,
  );

  useEffect(() => {
    if (open) {
      const d = initialDateTime(editMsgId, initialScheduledAt);
      setSelectedDate(d.date);
      setSelectedTime(d.time);
      setMessage(initialMessage);
      setReminder('never');
      setRecurrence(initialRecurrence === 'unknown' ? 'none' : initialRecurrence);
      setRecurrenceTouched(false);
      setApproval(false);
      setSelectedSeedId(null);
      setSaveTemplateChecked(false);
      setTemplateTitle('');
      setError(null);
      setSubmitting(false);
      setCalendarOpen(false);
      setClockOpen(false);
      setReminderSheetOpen(false);
      setRecurrenceSheetOpen(false);
      setTemplateSheetOpen(false);
      setMediaPickerOpen(false);
      // Modifica E Duplica: l'allegato del messaggio d'origine resta. Prima
      // Duplica lo perdeva in silenzio (partiva solo la didascalia).
      setMedia(initialMedia);
      setAdvancedOpen(false);
    }
  }, [open]);

  // Indietro (Android/iOS) chiude il foglio in cima, poi la modale: mai l'app intera.
  useModalHistory(open && !!contact, onClose);
  useModalHistory(open && (calendarOpen || clockOpen || reminderSheetOpen || recurrenceSheetOpen || templateSheetOpen), () => { setCalendarOpen(false); setClockOpen(false); setReminderSheetOpen(false); setRecurrenceSheetOpen(false); setTemplateSheetOpen(false); });
  // Bozza in sessionStorage: sopravvive a un Indietro, a un reload o alla chiusura della scheda.
  const draft = useScheduleDraft({ enabled: open && !editMsgId && !!contact, contact, initialMessage, initialMedia, values: { message, date: selectedDate, time: selectedTime, recurrence, media }, apply: (d) => { setMessage(d.message); setMedia(d.media); setRecurrence(d.recurrence); if (d.when) { setSelectedDate(d.when.date); setSelectedTime(d.when.time); } } });

  if (!open || !contact) return null;

  // wallDate: l'orario come lo vedono i selettori (ora di Roma) — da usare per
  // etichette, regola di ripetizione e avviso 08-21. scheduledDate: l'istante
  // vero, l'unico che va al server e che si confronta con adesso.
  const wallDate = combineDateTime(selectedDate, selectedTime);
  const scheduledDate = instantFromRomeWallClock(wallDate, editMsgId && initialScheduledAt ? new Date(initialScheduledAt) : undefined);
  const romeNow = romeWallClock(new Date());
  const outsideRome = browserIsOutsideRome();
  const isValidDate = scheduledDate.getTime() >= Date.now() + 60_000;
  // With media, an empty body is OK (the media is the message). Without
  // media, the body remains mandatory like before.
  const isValidMessage = (media !== null && message.length <= 3500)
    || (message.trim().length > 0 && message.length <= 3500);
  // I template "Pronti per te" hanno {giorno}, {orario}, {luogo}... che nessuno
  // compila (all'invio si risolve solo {nome}): finché restano, niente invio.
  // Il server rifiuta lo stesso testo (unfilled_placeholder).
  const unfilled = unfilledPlaceholders(message);
  // Gruppo: dal picker (kind) o da Modifica/Duplica (solo il JID). Numero di
  // persone e distintivo degli omonimi arrivano dal picker o dallo snapshot.
  const isGroup = contact.kind === 'group' || isGroupJid(contact.number);
  const snapGroup = isGroup && (contact.size === undefined || contact.hint === undefined)
    ? getGroupsSnapshot()?.groups.find((g) => g.jid === contact.number)
    : undefined;
  const groupSize = contact.size ?? snapGroup?.size ?? null;
  const groupHint = contact.hint ?? snapGroup?.hint ?? null;
  // {nome} in un gruppo partirebbe uguale per tutti ("Ciao Under"): il server lo rifiuta.
  const groupNome = isGroup && hasTemplateVariables(message);
  const canSubmit = isValidDate && isValidMessage && unfilled.length === 0 && !groupNome && !submitting;
  // Pulsante spento: si dice perché, un motivo per volta (riga sopra il pulsante).
  // Giorno scelto prima di oggi (ora di Roma): la riga dice di cambiare il giorno.
  const pastDay = wallDate.getTime() < new Date(romeNow.getFullYear(), romeNow.getMonth(), romeNow.getDate()).getTime();
  const blockReason = submitting ? null : sendBlockReason({ validDate: isValidDate, pastDay, validMessage: isValidMessage, groupNome, unfilled });

  // Il numero stesso come "nome" vale come nessun nome: si mostra il numero leggibile.
  const personName = isGroup ? undefined : realPersonName(contact.name, contact.number);
  const contactLabel = isGroup ? (contact.name || 'Gruppo senza nome') : (personName || formatPhoneForDisplay(contact.number));
  const titleName = isGroup ? contact.name : personName;
  const defaultTemplateTitle = titleName ? `Per ${titleName}` : 'Mio modello';
  const dateLabel = format(wallDate, 'EEE d MMM', { locale: it });

  // Modifica di una riga di una serie: testo e allegato valgono anche per tutte
  // le volte dopo (il cron copia la riga appena inviata). Lo si dice prima di salvare.
  const seriesContinues = !!editMsgId && !!initialRecurrenceRule
    && (recurrence !== 'none' || (initialRecurrence === 'unknown' && !recurrenceTouched));
  const seriesLabel = recurrence !== 'none'
    ? recurrenceLabel(recurrence, wallDate).toLowerCase()
    : recurrenceTagLabel(initialRecurrenceRule);
  const seriesMediaChanged = seriesContinues && !!media && mediaChanged(initialMedia, media);

  const hasReminder = reminder !== 'never';
  const hasRecurrence = recurrence !== 'none';
  const advancedSummary = !ADVANCED_APPROVAL_REMINDER_ENABLED
    ? (hasRecurrence
        ? `Ripeti: ${recurrenceLabel(recurrence, wallDate).toLowerCase()}`
        : 'Nessuna notifica · invio automatico')
    : (!approval && !hasReminder && !hasRecurrence
        ? 'Nessuna notifica · invio automatico'
        : [
            approval ? 'Approvazione richiesta' : null,
            hasReminder ? `Promemoria: ${REMINDER_LABELS[reminder]}` : null,
            hasRecurrence ? `Ripeti: ${recurrenceLabel(recurrence, wallDate).toLowerCase()}` : null,
          ].filter(Boolean).join(' · '));

  function pickTemplate(pick: TemplatePick) {
    setMessage(pick.body);
    // Seed → remember the id (source_template_id on opt-in save).
    // Personal template → no source.
    setSelectedSeedId(pick.kind === 'seed' ? pick.id : null);
  }

  // Salvataggio silenzioso del template personale, SOLO se l'utente ha spuntato
  // la casella. Best-effort: l'invio è già riuscito, quindi errori e timeout
  // vengono ingoiati e non bloccano mai la chiusura della modale.
  async function saveAsTemplate(title: string) {
    const editedBody = message.trim();
    // Invio solo-media (testo vuoto): niente da salvare, l'API darebbe invalid_body.
    if (editedBody.length === 0) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      await fetch('/api/templates/personal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          body: editedBody,
          source_template_id: selectedSeedId,
        }),
        signal: ctrl.signal,
        keepalive: true,
      });
    } catch {
      // Save is best-effort. The schedule already succeeded — swallow errors.
    } finally {
      clearTimeout(timer);
    }
  }

  function recurrenceChanged(): boolean {
    if (recurrenceTouched) return true;
    if (initialRecurrence === 'unknown') return false;
    // Stessa scelta ma data spostata: BYDAY/BYMONTHDAY seguono la nuova data.
    return buildRRule(recurrence, wallDate) !== (initialRecurrenceRule || null);
  }

  async function handleSubmit() {
    if (!canSubmit || !contact) return;
    setSubmitting(true);
    setError(null);

    try {
      let res: Response;

      if (editMsgId) {
        // Edit-in-place: PATCH the existing message instead of creating a new one.
        // Fields accepted by PATCH: message, scheduled_at, recurrence_rule, media.
        // scheduled_at SOLO se l'utente ha cambiato giorno/ora (o la ripetizione,
        // che si ancora all'orario a schermo). Prima partiva sempre: su una riga
        // settimanale ven 18:00 spostata dal cron a sab 08:03, correggere una
        // parola rifaceva l'ancora alle 08:03 (tutte le volte dopo alle 8 del
        // mattino) e cancellava il motivo dello spostamento.
        const recurrenceDirty = recurrenceChanged();
        const timeDirty = !sameMinute(scheduledDate, initialScheduledAt);
        res = await fetch('/api/messages', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editMsgId,
            message: message.trim(),
            ...(timeDirty || recurrenceDirty ? { scheduled_at: scheduledDate.toISOString() } : {}),
            ...(recurrenceDirty ? { recurrence_rule: buildRRule(recurrence, wallDate) ?? null } : {}),
            // Aperta da "Riattiva" su un orario passato: il nuovo orario rimette
            // anche in coda (il server lo accetta perché arriva con scheduled_at).
            ...(resumeOnSave ? { status: 'pending' } : {}),
            // Allegato: solo se è cambiato rispetto a quello con cui si è aperta
            // la modale (null = tolto, oggetto = nuovo file già caricato).
            ...(mediaChanged(initialMedia, media) ? {
              media: media ? { media_type: media.media_type, media_url: media.media_url, media_filename: media.media_filename } : null,
            } : {}),
          }),
        });
      } else {
        res = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient_number: contact.number,
            recipient_name: (isGroup ? contact.name : personName) || undefined,
            // Solo un numero scritto a mano in "Nuovo contatto" diventa un
            // contatto manuale: una scelta dalla rubrica o dai recenti no. Un gruppo mai.
            ...(contact.manualEntry === true && !isGroup ? { manual_entry: true } : {}),
            message: message.trim(),
            scheduled_at: scheduledDate.toISOString(),
            recurrence_rule: buildRRule(recurrence, wallDate),
            ...(media ? {
              media_type: media.media_type,
              media_url: media.media_url,
              media_filename: media.media_filename,
              media_caption: message.trim() || undefined,
            } : {}),
          }),
        });
      }

      if (res.ok) {
        // Niente popup dopo l'invio: il template si salva solo se l'utente
        // ha spuntato "Salva come mio template" prima di inviare.
        // Fire-and-forget: i valori sono già nella closure, la modale chiude subito
        // (keepalive fa arrivare la POST anche se la pagina cambia).
        if (!editMsgId && saveTemplateChecked && message.trim().length > 0) {
          void saveAsTemplate(templateTitle.trim() || defaultTemplateTitle);
        }
        if (!editMsgId) draft.clear();
        onScheduled();
        onClose();
        return;
      }

      // body.message del server se c'è, altrimenti una frase per codice: mai il
      // codice grezzo (vedi app/lib/api-error-text.ts).
      const body = await res.json().catch(() => ({}));
      setError(apiErrorText(body, res.status));
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
          <div className="text-white font-medium text-base">{editMsgId ? 'Modifica messaggio' : 'Programma un messaggio'}</div>
        </div>

        {/* pb-6: il CTA non è più un FAB sovrapposto ma una barra in-flow */}
        <div className="flex-1 overflow-y-auto pb-6">
          <div className="flex items-start justify-between px-4 pt-5 pb-3">
            <div className="min-w-0">
              <div className="text-white font-bold text-xl">
                Messaggio per {contactLabel}
              </div>
              {isGroup && (
                <div className="text-sm text-gray-400 mt-0.5" data-testid="group-subtitle">
                  {groupSubtitle(groupSize, groupHint)}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Chiudi"
              className="p-1 rounded-full hover:bg-white/10 text-white -mr-1 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {isGroup && groupHint && (
            <div className="mx-4 mb-3 p-2.5 rounded-xl bg-amber-900/30 text-amber-200 text-xs" role="status" data-testid="group-homonym-warning">
              Hai più gruppi con questo nome: controlla che sia quello giusto.
            </div>
          )}

          <div className="border-t border-[#2A3942] mx-4" />

          {/* Chip data rapide (pattern beta nativa WhatsApp): un tap imposta la
              data mantenendo l'orario; il calendario resta per tutto il resto. */}
          <div className="flex items-center gap-2 px-4 pt-3 flex-wrap">
            {quickDateChips(romeNow).map((chip) => {
              const active = isSameDay(selectedDate, chip.date);
              return (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => setSelectedDate(chip.date)}
                  className={`text-xs px-3 py-1.5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                    active
                      ? 'bg-primary/15 text-primary border border-primary'
                      : 'bg-[#1F2C33] text-gray-400 border border-transparent hover:text-gray-200'
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setCalendarOpen(true)}
              className="text-xs px-3 py-1.5 rounded-full bg-[#1F2C33] text-gray-400 border border-transparent hover:text-gray-200 inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <CalendarIcon className="w-3.5 h-3.5" /> Altra data
            </button>
          </div>

          <div className="flex items-center gap-4 px-4 py-2">
            <CalendarIcon className="w-5 h-5 text-gray-400 shrink-0" />
            <div className="flex items-center gap-1 text-white text-base">
              <button
                type="button"
                onClick={() => setCalendarOpen(true)}
                aria-label="Modifica data"
                className="hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 rounded p-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center"
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
          {/* Telefono in un altro fuso: data e ora qui sopra sono quelle italiane
              (come il server calcola ripetizioni e fascia 08-21). Lo si dice. */}
          {outsideRome && (
            <div className="px-4 -mt-1 pb-1 text-[11px] text-gray-500" data-testid="rome-time-note">
              Orari in ora italiana
            </div>
          )}

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
              {ADVANCED_APPROVAL_REMINDER_ENABLED && (
                <>
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
                </>
              )}

              <button
                type="button"
                onClick={() => setRecurrenceSheetOpen(true)}
                className="w-full flex items-center gap-4 py-3 hover:bg-white/5 text-left focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <Repeat className="w-5 h-5 text-gray-400 shrink-0" />
                <div className="flex-1 text-white text-base">Ripeti</div>
                <div className="text-primary text-base">{recurrenceLabel(recurrence, wallDate)}</div>
                <ChevronRight className="w-5 h-5 text-gray-500" />
              </button>

              <button
                type="button"
                onClick={() => setTemplateSheetOpen(true)}
                className="w-full flex items-center gap-4 py-3 hover:bg-white/5 text-left focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <FileText className="w-5 h-5 text-gray-400 shrink-0" />
                <div className="flex-1 text-white text-base">Modello</div>
                <div className="text-primary text-base">{selectedSeedId ? 'Modificato' : 'Scegli…'}</div>
                <ChevronRight className="w-5 h-5 text-gray-500" />
              </button>
            </div>
          )}

          {media && (
            <div className="mt-3">
              <MediaAttachmentChip media={media} onClear={() => setMedia(null)} />
            </div>
          )}
          {!media && mediaUnavailable && (
            <div className="mx-4 mt-3 p-2.5 rounded-xl bg-amber-900/30 text-amber-200 text-xs" role="status" data-testid="media-unavailable">
              L&apos;allegato originale non è più disponibile: ricaricalo con la graffetta.
            </div>
          )}

          <ScheduleDraftBanner draft={draft} />

          <div className="px-4 pt-4">
            {/* Campo stile WhatsApp: la graffetta vive DENTRO il bordo del campo,
                sempre a vista (prima era una riga sepolta in "Opzioni avanzate").
                In modifica si può togliere o sostituire (PATCH con `media`). */}
            <div className="flex items-end bg-[#1F2C33] rounded-xl pl-1 focus-within:ring-2 focus-within:ring-primary/30">
              {(
                <button
                  type="button"
                  onClick={() => setMediaPickerOpen(true)}
                  aria-label="Allega"
                  aria-haspopup="dialog"
                  title="Allega foto, video, documento o audio"
                  className={`relative shrink-0 w-11 h-11 mb-0.5 rounded-full inline-flex items-center justify-center hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                    media ? 'text-primary' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Paperclip className="w-5 h-5" />
                  {media && (
                    <span aria-hidden="true" className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
                  )}
                </button>
              )}
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Scrivi il messaggio…"
                rows={5}
                maxLength={3500}
                className="flex-1 min-w-0 bg-transparent text-white placeholder-gray-500 px-2 py-2 outline-none resize-none"
              />
            </div>
            <div className="flex items-center justify-between mt-1">
              {isGroup ? <span /> : (
                // Area di tocco alta 44px, il chip a vista resta piccolo.
                <button
                  type="button"
                  onClick={() => setMessage((m) => (m.includes('{nome}') ? m : m + (m && !m.endsWith(' ') ? ' ' : '') + '{nome}'))}
                  className="min-h-[44px] min-w-[44px] -ml-1 px-1 flex items-center text-gray-400 hover:text-primary"
                  title="Inserisci il nome del contatto"
                >
                  <span className="text-[13px] px-3 py-1.5 rounded-full bg-[#1F2C33]">Inserisci il nome</span>
                </button>
              )}
              <div className="text-xs text-gray-500 text-right">{message.length}/3500</div>
            </div>
            {groupNome && (
              <div className="mt-2 text-xs text-amber-200 bg-amber-900/30 rounded-lg px-3 py-2" role="status" data-testid="group-nome-warning">
                {'{nome}'} non si usa nei gruppi: il messaggio arriva uguale a tutti. Toglilo o scrivi «Ciao a tutti».
              </div>
            )}
            {!isGroup && hasTemplateVariables(message) && (
              <div className="mt-2 text-xs text-gray-400 bg-[#1F2C33]/60 rounded-lg px-3 py-2">
                {firstNameOf(contact.name) ? (
                  <>Anteprima per {firstNameOf(contact.name)}: <span className="text-gray-300">{applyTemplateVariables(message, contact.name)}</span></>
                ) : personName ? (
                  <>Il nome di questo contatto è fatto di cifre: {'{nome}'} verrà rimosso dal messaggio.</>
                ) : (
                  <>Questo contatto non ha un nome salvato: {'{nome}'} verrà rimosso dal messaggio.</>
                )}
              </div>
            )}
            {/* Campi del template da scrivere a mano: evidenziati uno per uno,
                CTA disattivata finché ne resta uno (si sblocca scrivendo). */}
            {unfilled.length > 0 && (
              <div className="mt-2 text-xs text-amber-200 bg-amber-900/30 rounded-lg px-3 py-2" role="status" data-testid="unfilled-placeholders">
                Completa i campi tra parentesi:{' '}
                {unfilled.map((tok, i) => (
                  <React.Fragment key={tok}>
                    {i > 0 && ', '}
                    <mark className="bg-amber-400/25 text-amber-100 rounded px-1 font-medium">{tok}</mark>
                  </React.Fragment>
                ))}
              </div>
            )}
            {!editMsgId && (
              <div className="mt-2">
                <label className="flex items-center gap-3 min-h-[44px] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={saveTemplateChecked && message.trim().length > 0}
                    disabled={message.trim().length === 0}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setSaveTemplateChecked(on);
                      if (on && templateTitle.trim().length === 0) setTemplateTitle(defaultTemplateTitle);
                    }}
                    className="w-5 h-5 shrink-0 accent-primary"
                  />
                  <span className={`text-sm ${message.trim().length === 0 ? 'text-gray-500' : 'text-gray-300'}`}>
                    Salva come mio modello
                    {message.trim().length === 0 && <span className="block text-xs text-gray-500">Scrivi un testo per salvarlo come modello</span>}
                  </span>
                </label>
                {saveTemplateChecked && message.trim().length > 0 && (
                  <input
                    type="text"
                    value={templateTitle}
                    onChange={(e) => setTemplateTitle(e.target.value)}
                    maxLength={200}
                    aria-label="Titolo del modello"
                    placeholder={defaultTemplateTitle}
                    className="w-full bg-[#1F2C33] text-white placeholder-gray-500 rounded-xl px-3 py-2 text-base outline-none focus:ring-2 focus:ring-primary/30"
                  />
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="mx-4 mt-3 p-3 rounded-xl bg-red-900/40 text-red-200 text-sm">
              {error}
              {/* No upgrade CTA on the beta-limit copy: nothing to buy, and
                  the #prezzi anchor points at the unmounted pricing grid. */}
              {error.includes('limite') && !error.includes('limite beta') && (
                <a href="#prezzi" className="underline ml-2">Aggiorna piano</a>
              )}
            </div>
          )}
        </div>

        {seriesContinues && (
          <div className="mx-4 mt-2 p-2.5 rounded-xl bg-amber-900/30 text-amber-200 text-xs text-center" role="status" data-testid="series-edit-note">
            Le modifiche valgono anche per tutte le prossime volte{seriesLabel ? ` (${seriesLabel})` : ''}.
            {seriesMediaChanged && ' Anche il nuovo allegato partirà ogni volta.'}
          </div>
        )}

        {courtesyHint(wallDate) && (
          <div className="mx-4 mt-2 p-2.5 rounded-xl bg-amber-900/30 text-amber-200 text-xs text-center" role="status">
            {courtesyHint(wallDate)}
          </div>
        )}

        {isGroup && (
          <div className="px-5 pt-2 text-[11px] text-gray-400 text-center" data-testid="group-hint">
            Parte un solo messaggio nel gruppo, dal tuo numero.
          </div>
        )}
        {/* Microcopy onesta sui casi limite (pattern beta nativa): dichiara il
            comportamento a istanza disconnessa invece di lasciare il dubbio.
            Se è GIÀ scollegato lo si dice chiaro: il messaggio resta in coda
            finché l'utente non ricollega, non parte da solo. Per un gruppo il
            server controlla il gruppo dal vivo e rifiuta (409): il pulsante
            resta attivo, decide lui (accetta anche "connecting"). */}
        {isGroup && !connected ? (
          <div className="mx-4 mt-2 p-2.5 rounded-xl bg-amber-900/30 text-amber-200 text-xs text-center" role="status" data-testid="group-disconnected-warning">
            Per programmare in un gruppo WhatsApp deve essere collegato: ricollegalo e riprova.{' '}
            <a href="/connect" className="underline font-semibold">Ricollega</a>
          </div>
        ) : connected ? (
          <div className="px-5 pt-2 text-[11px] text-gray-500 text-center">
            Se WhatsApp è disconnesso all&apos;orario previsto, il messaggio parte appena si riconnette.
          </div>
        ) : (
          <div className="mx-4 mt-2 p-2.5 rounded-xl bg-amber-900/30 text-amber-200 text-xs text-center" role="status" data-testid="disconnected-warning">
            WhatsApp è scollegato: ricollegalo prima dell&apos;orario scelto, altrimenti il messaggio resta in coda e non parte.{' '}
            <a href="/connect" className="underline font-semibold">Ricollega</a>
          </div>
        )}

        <SendFab
          disabled={!canSubmit}
          loading={submitting}
          onClick={handleSubmit}
          label={formatSendCta(wallDate, romeNow)}
          hint={canSubmit ? null : blockReason}
        />

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
        <RecurrenceBottomSheet
          open={recurrenceSheetOpen}
          onClose={() => setRecurrenceSheetOpen(false)}
          value={recurrence}
          onChange={(v) => { setRecurrence(v); setRecurrenceTouched(true); }}
          referenceDate={wallDate}
        />
        <TemplateBottomSheet
          open={templateSheetOpen}
          onClose={() => setTemplateSheetOpen(false)}
          onSelect={pickTemplate}
        />
        <MediaPicker
          open={mediaPickerOpen}
          onClose={() => setMediaPickerOpen(false)}
          onAttached={(m) => setMedia(m)}
        />
      </div>
    </div>
  );
}
