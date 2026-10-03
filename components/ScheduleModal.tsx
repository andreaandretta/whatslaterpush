'use client';

import React, { useState, useEffect } from 'react';
import { X, ArrowLeft, Calendar as CalendarIcon, UserCheck, Bell, ChevronRight, Repeat, FileText, Paperclip } from 'lucide-react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { DarkCalendarDialog } from './schedule/DarkCalendarDialog';
import { AnalogClockDialog } from './schedule/AnalogClockDialog';
import { ReminderBottomSheet, ReminderValue } from './schedule/ReminderBottomSheet';
import { RecurrenceBottomSheet, RecurrenceValue, buildRRule, recurrenceLabel, weeklyDays, firstWeeklySend } from './schedule/RecurrenceBottomSheet';
import { TemplateBottomSheet, TemplatePick } from './schedule/TemplateBottomSheet';
import { MediaPicker, MediaAttachmentChip, MediaAttachment } from './schedule/MediaPicker';
import { SendFab } from './schedule/SendFab';
import { applyTemplateVariables, hasTemplateVariables, firstNameOf } from '../app/lib/template-variables';
import { formatSendCta, quickDateChips, isSameDay, courtesyHint, proposedSendTime, sendBlockReason, recurrenceTagLabel, weekdaysPhrase, mondayFirst } from '../app/lib/schedule-quick';
import { parseRule } from '../app/lib/recurrence';
import { apiErrorText } from '../app/lib/api-error-text';
import { romeWallClock, instantFromRomeWallClock, browserIsOutsideRome } from '../app/lib/rome-time';
import { unfilledPlaceholders } from '../app/lib/placeholders';
import { useModalHistory } from '../app/lib/use-modal-history';
import { useScheduleDraft, ScheduleDraftBanner } from './schedule/ScheduleDraftBanner';
import { isGroupJid, realPersonName, formatPhoneForDisplay } from '../app/lib/jid';
import { getGroupsSnapshot } from '../app/lib/contacts-client-cache';
import { dayFullHint, bigGroupWarmupHint, type TodayLimit, type QueueRow } from '../app/lib/daily-limit';
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
  /** Limite di oggi dalla GET /api/messages (rampa dei primi giorni, piano,
   *  invii già fatti). null = sconosciuto: nessun avviso sul giorno pieno. */
  todayLimit?: TodayLimit | null;
  /** La coda dell'utente (le righe della dashboard), per contare il giorno scelto. */
  queue?: QueueRow[];
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

const BYDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// Regola salvata → valore del selettore (+ i giorni, se settimanale con più
// giorni). 'unknown' = una regola che la modale non sa rappresentare (va
// lasciata com'è).
function recurrenceFromRule(rule: string | null | undefined, at: Date | null): { value: RecurrenceValue; days: number[] } | 'unknown' {
  if (!rule) return { value: 'none', days: [] };
  // Riconosciuta solo se la modale la ricostruirebbe IDENTICA (niente INTERVAL,
  // un giorno solo diverso da quello della data...): altrimenti 'unknown' e il
  // PATCH non la tocca.
  const candidates: RecurrenceValue[] = ['daily', 'weekly', 'monthly'];
  for (const v of candidates) if (at && buildRRule(v, at) === rule) return { value: v, days: [] };
  // Più giorni insieme (rapporto 360 B2): "ogni lunedì e giovedì".
  const p = parseRule(rule);
  if (at && p?.freq === 'WEEKLY' && p.byDay && p.byDay.length >= 2) {
    const days = p.byDay.map((code) => BYDAY_CODES.indexOf(code));
    if (buildRRule('weekly', at, days) === rule) return { value: 'weekly', days };
  }
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

export default function ScheduleModal({ open, onClose, onBack, contact, onScheduled, initialMessage = '', editMsgId = null, initialMedia = null, initialScheduledAt = null, initialRecurrenceRule = null, mediaUnavailable = false, connected = true, resumeOnSave = false, todayLimit = null, queue = [] }: ScheduleModalProps) {
  const init = defaultDateTime();
  const [selectedDate, setSelectedDate] = useState<Date>(init.date);
  const [selectedTime, setSelectedTime] = useState<string>(init.time);
  const [message, setMessage] = useState(initialMessage);
  const [reminder, setReminder] = useState<ReminderValue>('never');
  const [recurrence, setRecurrence] = useState<RecurrenceValue>('none');
  // Giorni scelti per "ogni settimana" (Date.getDay()). Vuoto o uno solo = il
  // giorno della data, come prima (weeklyDays in RecurrenceBottomSheet).
  const [weekDays, setWeekDays] = useState<number[]>([]);
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
      setRecurrence(initialRecurrence === 'unknown' ? 'none' : initialRecurrence.value);
      setWeekDays(initialRecurrence === 'unknown' ? [] : initialRecurrence.days);
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
    }
  }, [open]);

  // Indietro (Android/iOS) chiude il foglio in cima, poi la modale: mai l'app intera.
  useModalHistory(open && !!contact, onClose);
  useModalHistory(open && (calendarOpen || clockOpen || reminderSheetOpen || recurrenceSheetOpen || templateSheetOpen), () => { setCalendarOpen(false); setClockOpen(false); setReminderSheetOpen(false); setRecurrenceSheetOpen(false); setTemplateSheetOpen(false); });
  // Bozza in sessionStorage: sopravvive a un Indietro, a un reload o alla chiusura della scheda.
  const draft = useScheduleDraft({ enabled: open && !editMsgId && !!contact, contact, initialMessage, initialMedia, values: { message, date: selectedDate, time: selectedTime, recurrence, weekDays, media }, apply: (d) => { setMessage(d.message); setMedia(d.media); setRecurrence(d.recurrence); setWeekDays(d.weekDays); if (d.when) { setSelectedDate(d.when.date); setSelectedTime(d.when.time); } } });

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
    ? recurrenceLabel(recurrence, wallDate, weekDays).toLowerCase()
    : recurrenceTagLabel(initialRecurrenceRule);
  const seriesMediaChanged = seriesContinues && !!media && mediaChanged(initialMedia, media);

  // Limiti dei primi giorni (rapporto 360 B3): il giorno scelto è già pieno, o
  // il gruppo è troppo grande per i primi giorni → lo si dice PRIMA, con il
  // giorno in cui partirà davvero. Stessi conti del cron (app/lib/daily-limit.ts).
  const limitsNow = new Date();
  const dayFullText = isValidDate ? dayFullHint(todayLimit, queue, scheduledDate, limitsNow, editMsgId) : null;
  const bigGroupText = isGroup && isValidDate ? bigGroupWarmupHint(todayLimit, groupSize, scheduledDate, limitsNow) : null;

  // Riga "Ripeti" sotto data e ora (rapporto 360 B2/T5): prima era dentro
  // "Opzioni avanzate", chiusa, e chi programma l'allenamento non la trovava.
  const hasRecurrence = recurrence !== 'none';
  // Modifica di una serie con una regola che la modale non sa riscrivere (tipico:
  // "ogni venerdì 22:00" spostato dal cron a sabato 08:03): la regola resta com'è
  // e la riga la dice, invece di un falso "Non si ripete".
  const keepsStoredRule = !!editMsgId && !!initialRecurrenceRule && initialRecurrence === 'unknown' && !recurrenceTouched;
  const storedRuleLabel = keepsStoredRule ? recurrenceTagLabel(initialRecurrenceRule) : null;
  const recurrenceValueLabel = hasRecurrence
    ? recurrenceLabel(recurrence, wallDate, weekDays)
    : keepsStoredRule
      ? (storedRuleLabel ? storedRuleLabel.charAt(0).toUpperCase() + storedRuleLabel.slice(1) : 'Si ripete')
      : 'Non si ripete';
  // Più giorni scelti ma la data cade in un altro giorno (data cambiata dopo, o
  // riga spostata dal cron): quella data parte comunque, poi la serie segue i
  // giorni della regola. Lo si dice.
  const storedRule = keepsStoredRule ? parseRule(initialRecurrenceRule!) : null;
  const weeklySet = recurrence === 'weekly'
    ? weeklyDays(wallDate, weekDays)
    : storedRule?.freq === 'WEEKLY' && storedRule.byDay
      ? storedRule.byDay.map((code) => BYDAY_CODES.indexOf(code))
      : [];
  const offPatternNote = (weeklySet.length >= 2 || storedRule) && weeklySet.length > 0 && !weeklySet.includes(wallDate.getDay())
    ? `${editMsgId ? 'Questa volta' : 'Primo invio'} ${dateLabel}, poi ${weekdaysPhrase(weeklySet)}`
    : null;

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

  // Stessa scelta di quella a schermo? Si confrontano valore e giorni, non la
  // regola: un "ogni martedì" scelto su una data di sabato darebbe la stessa
  // regola di "ogni sabato" (un giorno solo segue la data).
  function sameRecurrenceChoice(v: RecurrenceValue, days: number[]): boolean {
    if (v !== recurrence) return false;
    if (v !== 'weekly') return true;
    return mondayFirst(days).join(',') === weeklyDays(wallDate, weekDays).join(',');
  }

  function recurrenceChanged(): boolean {
    if (recurrenceTouched) return true;
    if (initialRecurrence === 'unknown') return false;
    // Stessa scelta ma data spostata: BYDAY/BYMONTHDAY seguono la nuova data
    // (un giorno solo; più giorni scelti restano quelli).
    return buildRRule(recurrence, wallDate, weekDays) !== (initialRecurrenceRule || null);
  }

  // Scelta confermata nel foglio Ripeti. Settimanale con giorni che non
  // comprendono quello della data: la data va al primo giorno scelto, stessa
  // ora (il foglio lo mostra già come "Primo invio").
  function applyRecurrence(v: RecurrenceValue, days: number[]) {
    // Confermata la stessa scelta di prima (stessa ripetizione, stessi giorni):
    // non cambia niente. Prima la data saltava al primo giorno scelto e, in
    // modifica, il PATCH riscriveva l'ancora: una volta spostata dal cron a
    // mar 08:03 di un "lunedì e giovedì 18:00" finiva a gio 08:03 e tutta la
    // serie passava alle 08:03; una data scelta a mano ("Questa volta dom 4
    // ott") veniva annullata. Eccezione: serie con una regola che la modale non
    // sa riscrivere (keepsStoredRule), dove il foglio mostra "Non ripetere" e
    // confermarlo resta "ferma la serie", come prima.
    if (!keepsStoredRule && sameRecurrenceChoice(v, days)) return;
    setRecurrence(v);
    setWeekDays(v === 'weekly' ? days : []);
    setRecurrenceTouched(true);
    if (v === 'weekly' && days.length > 0) {
      const first = firstWeeklySend(wallDate, days);
      if (!isSameDay(first, wallDate)) setSelectedDate(first);
    }
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
            ...(recurrenceDirty ? { recurrence_rule: buildRRule(recurrence, wallDate, weekDays) ?? null } : {}),
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
            recurrence_rule: buildRRule(recurrence, wallDate, weekDays),
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

  // Finestra legata alla parte visibile dello schermo (wl-viewport, rapporto 360
  // B1/T2): con la tastiera aperta la testata resta in cima e "Invia" subito
  // sopra la tastiera. Prima era `inset-0`, alta quanto la pagina: la testata
  // usciva in alto e il pulsante finiva sotto la barra delle frecce.
  // Colonna: testata fissa → parte che scorre → avvisi e Invia, fuori dallo scroll.
  return (
    <div
      className="wl-viewport z-modal bg-black/60 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      data-testid="schedule-modal"
      onClick={onClose}
    >
      <div
        className="relative bg-text-primary w-full h-full sm:w-[400px] sm:h-[700px] sm:max-h-[90%] sm:rounded-3xl sm:shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 bg-[#202C33] pt-[env(safe-area-inset-top)]" data-testid="schedule-modal-header">
          <div className="flex items-center gap-3 px-3 h-14">
            <button
              type="button"
              onClick={onBack}
              aria-label="Indietro"
              className="w-11 h-11 -ml-1 inline-flex items-center justify-center rounded-full hover:bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </button>
            <div className="text-white font-medium text-base">{editMsgId ? 'Modifica messaggio' : 'Programma un messaggio'}</div>
          </div>
        </div>

        {/* pb-6: il CTA non è più un FAB sovrapposto ma una barra in-flow.
            overscroll-contain: arrivati in cima o in fondo, il trascinamento non
            passa alla pagina sotto (che ricaricava e chiudeva la finestra, M8). */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-6" data-testid="schedule-modal-scroll">
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
            {/* X da 44×44 (prima 28px, rapporto 360 T33). */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Chiudi"
              className="shrink-0 w-11 h-11 -mr-2.5 -mt-1.5 inline-flex items-center justify-center rounded-full hover:bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <X className="w-6 h-6" aria-hidden="true" />
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
          {/* Aree di tocco alte 44px (prima 34px): il pulsante è alto 44, il
              chip a vista dentro resta della misura di prima (come Allega). */}
          <div className="flex items-center gap-x-2 px-4 pt-1.5 flex-wrap" data-testid="quick-date-chips">
            {quickDateChips(romeNow).map((chip) => {
              const active = isSameDay(selectedDate, chip.date);
              return (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => setSelectedDate(chip.date)}
                  aria-pressed={active}
                  className="min-h-[44px] flex items-center rounded-full focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {/* Scelta attiva bianca su grigio, non verde: il verde è per le
                      azioni (rapporto 360, T35). Bianco su bianco 12% = 12,3:1. */}
                  <span
                    className={`text-[13px] px-3 py-1.5 rounded-full transition-colors ${
                      active
                        ? 'bg-white/[0.12] text-white font-semibold border border-[#8696A0]'
                        : 'bg-[#1F2C33] text-gray-400 border border-transparent hover:text-gray-200'
                    }`}
                  >
                    {chip.label}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setCalendarOpen(true)}
              className="min-h-[44px] flex items-center rounded-full focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <span className="text-[13px] px-3 py-1.5 rounded-full bg-[#1F2C33] text-gray-400 border border-transparent hover:text-gray-200 inline-flex items-center gap-1">
                <CalendarIcon className="w-3.5 h-3.5" aria-hidden="true" /> Altra data
              </span>
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
            <div className="px-4 -mt-1 pb-1 text-[13px] text-[#AEBAC1]" data-testid="rome-time-note">
              Orari in ora italiana
            </div>
          )}

          <button
            type="button"
            onClick={() => setRecurrenceSheetOpen(true)}
            aria-haspopup="dialog"
            data-testid="recurrence-row"
            className="w-full flex items-center gap-4 px-4 py-3 hover:bg-white/5 text-left focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <Repeat className="w-5 h-5 text-gray-400 shrink-0" />
            {/* Due righe, non "Ripeti … valore" affiancati: con "Ogni lunedì,
                mercoledì e venerdì" la scritta Ripeti si schiacciava a 0px e
                finiva sotto il valore (revisione B2). Valore e nota hanno tutta
                la larghezza e vanno a capo. */}
            <div className="flex-1 min-w-0">
              <div className="text-white text-base">Ripeti</div>
              {/* Valore in grigio chiaro, non verde (T35): #D1D5DB su #111B21 = 11,9:1. */}
              <div className={`text-[15px] leading-snug mt-0.5 ${hasRecurrence || keepsStoredRule ? 'text-[#D1D5DB]' : 'text-gray-400'}`} data-testid="recurrence-value">{recurrenceValueLabel}</div>
              {offPatternNote && (
                <div className="text-gray-400 text-sm mt-0.5" data-testid="recurrence-first-send">{offPatternNote}</div>
              )}
            </div>
            <ChevronRight className="w-5 h-5 text-gray-500 shrink-0" />
          </button>

          {ADVANCED_APPROVAL_REMINDER_ENABLED && (
            <div className="border-t border-[#2A3942] mx-4 mt-1">
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
                <div className="text-[#D1D5DB] text-base">{REMINDER_LABELS[reminder]}</div>
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

          <div className="px-4 pt-2">
            {/* "Usa un modello" sopra il campo (rapporto 360 T5): prima era la
                riga "Modello" dentro "Opzioni avanzate". */}
            <button
              type="button"
              onClick={() => setTemplateSheetOpen(true)}
              aria-haspopup="dialog"
              className="min-h-[44px] -ml-1 px-1 inline-flex items-center gap-1.5 text-sm text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30 rounded"
            >
              <FileText className="w-4 h-4 shrink-0" aria-hidden="true" />
              {selectedSeedId ? 'Cambia modello' : 'Usa un modello'}
            </button>
            {/* Testo a tutta larghezza (rapporto 360, T26): prima la graffetta
                occupava una colonna a sinistra e il testo partiva spostato di
                44px. La graffetta è nella riga sotto, sempre a vista; in modifica
                si può togliere o sostituire l'allegato (PATCH con `media`). */}
            <div className="bg-[#1F2C33] rounded-xl focus-within:ring-2 focus-within:ring-primary/30">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Scrivi il messaggio…"
                aria-label="Messaggio"
                rows={5}
                maxLength={3500}
                className="block w-full bg-transparent text-base text-white placeholder-gray-500 px-3 py-2.5 outline-none resize-none"
              />
            </div>
            {/* Aree di tocco alte 44px, i chip a vista restano piccoli. */}
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                onClick={() => setMediaPickerOpen(true)}
                aria-haspopup="dialog"
                title="Allega foto, video, documento o audio"
                className={`min-h-[44px] -ml-1 px-1 flex items-center focus:outline-none focus:ring-2 focus:ring-primary/30 rounded-full ${
                  media ? 'text-white' : 'text-gray-300 hover:text-white'
                }`}
              >
                <span className="relative inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full bg-[#1F2C33]">
                  <Paperclip className="w-4 h-4 shrink-0" aria-hidden="true" />
                  Allega
                  {media && (
                    <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-primary ring-2 ring-[#111B21]" />
                  )}
                </span>
              </button>
              {!isGroup && (
                <button
                  type="button"
                  onClick={() => setMessage((m) => (m.includes('{nome}') ? m : m + (m && !m.endsWith(' ') ? ' ' : '') + '{nome}'))}
                  className="min-h-[44px] px-1 flex items-center text-gray-300 hover:text-white focus:outline-none focus:ring-2 focus:ring-primary/30 rounded-full"
                  title="Inserisci il nome del contatto"
                >
                  <span className="text-[13px] px-3 py-1.5 rounded-full bg-[#1F2C33]">Inserisci il nome</span>
                </button>
              )}
              {/* #8696A0 su #111B21 = 5,7:1 (prima gray-500, 3,6:1). */}
              <div className="ml-auto text-xs text-[#8696A0] text-right tabular-nums">{message.length}/3500</div>
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
                    {message.trim().length === 0 && <span className="block text-xs text-[#8696A0]">Scrivi un testo per salvarlo come modello</span>}
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

        {/* Avvisi gialli sopra Invia: 13px, a sinistra (si leggono; prima 12px
            centrati su tre righe). Mentre si scrive c'è poco spazio sopra la
            tastiera e data e ora non si possono correggere: l'avviso sulla serie
            e quelli che dicono QUANDO parte ("Questo partirà domattina: …")
            restano su una riga, gli altri spariscono finché la tastiera è
            aperta (globals.css). Revisione B3, rapporto 360 T22. */}
        {seriesContinues && (
          <div className="wl-clamp-on-keyboard mx-4 mt-2 p-2.5 rounded-xl bg-amber-900/30 text-amber-200 text-[13px] leading-snug" role="status" data-testid="series-edit-note">
            Le modifiche valgono anche per tutte le prossime volte{seriesLabel ? ` (${seriesLabel})` : ''}.
            {seriesMediaChanged && ' Anche il nuovo allegato partirà ogni volta.'}
          </div>
        )}

        {courtesyHint(wallDate) && (
          <div className="wl-hide-on-keyboard mx-4 mt-2 p-2.5 rounded-xl bg-amber-900/30 text-amber-200 text-[13px] leading-snug" role="status" data-testid="courtesy-warning">
            {courtesyHint(wallDate)}
          </div>
        )}

        {dayFullText && (
          <div className="wl-clamp-on-keyboard mx-4 mt-2 p-2.5 rounded-xl bg-amber-900/30 text-amber-200 text-[13px] leading-snug" role="status" data-testid="day-full-warning">
            {dayFullText}
          </div>
        )}
        {bigGroupText && (
          <div className="wl-clamp-on-keyboard mx-4 mt-2 p-2.5 rounded-xl bg-amber-900/30 text-amber-200 text-[13px] leading-snug" role="status" data-testid="big-group-warmup-warning">
            {bigGroupText}
          </div>
        )}

        {isGroup && (
          // Note sotto la finestra a 13px #AEBAC1: 8,8:1 su #111B21 (prima 11px,
          // gray-500 3,6:1). Rapporto 360, T22.
          <div className="wl-hide-on-keyboard px-5 pt-2 text-[13px] leading-snug text-[#AEBAC1] text-center" data-testid="group-hint">
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
          <div className="wl-hide-on-keyboard mx-4 mt-2 p-2.5 rounded-xl bg-amber-900/30 text-amber-200 text-[13px] leading-snug" role="status" data-testid="group-disconnected-warning">
            Per programmare in un gruppo WhatsApp deve essere collegato: ricollegalo e riprova.{' '}
            <a href="/connect" className="underline font-semibold">Ricollega</a>
          </div>
        ) : connected ? (
          <div className="wl-hide-on-keyboard px-5 pt-2 text-[13px] leading-snug text-[#AEBAC1] text-center" data-testid="disconnect-microcopy">
            Se WhatsApp è disconnesso all&apos;orario previsto, il messaggio parte appena si riconnette.
          </div>
        ) : (
          <div className="wl-hide-on-keyboard mx-4 mt-2 p-2.5 rounded-xl bg-amber-900/30 text-amber-200 text-[13px] leading-snug" role="status" data-testid="disconnected-warning">
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
          onChange={applyRecurrence}
          referenceDate={wallDate}
          days={recurrence === 'weekly' ? weekDays : []}
          firstLabel={editMsgId ? 'Questa volta' : 'Primo invio'}
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
