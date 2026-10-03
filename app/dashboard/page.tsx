'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Calendar, CheckCircle2, CreditCard, Loader2, LogOut, Plus, X,
} from 'lucide-react';
import ContactPickerModal, { type PickedContact } from '@/components/ContactPickerModal';
import { prefetchContacts, setContactsCacheOwner } from '@/app/lib/contacts-client-cache';
import ScheduleModal from '@/components/ScheduleModal';
import { ContactAvatar } from '@/components/ContactAvatar';
import PricingSection from '../components/PricingSection';
import FAQSection from '../components/FAQSection';
import MessagesSection, { type ScheduledMessage as MessagesSectionMessage } from '../components/MessagesSection';
import CalendarSyncCard from '../components/CalendarSyncCard';
import { DeliveryStatusIcon } from '../components/DeliveryStatusIcon';
import { MessagesEmptyState } from '../components/MessagesEmptyState';
import { shouldShowOnboardingHints, markOnboardingDone } from '../../components/onboarding/OnboardingTour';
import { getPlanLimits, getPlanName } from '../lib/plans';
import { WARMUP_RAMP } from '../lib/anti-ban';
import { todayStripText, type TodayLimit } from '../lib/daily-limit';
import { apiErrorText } from '../lib/api-error-text';
import { formatShortWhen, recurrenceTagLabel, resumeNextOccurrence } from '../lib/schedule-quick';
import { useModalHistory, useModalLayerOpen } from '../lib/use-modal-history';
import { isGroupJid, recipientDisplayName } from '../lib/jid';
import { LogoutDialog, type LogoutChoice } from './LogoutDialog';
import { checkSession, sessionRetryDelayMs, goTo } from '../lib/session-load';
import InstallPrompt from '../components/InstallPrompt';
import InstallAppButton from '../components/InstallAppButton';
import Logo from '@/components/Logo';


interface SubscriptionState {
  // Effective plan from GET /api/messages: the whole plan UI keys on it
  // (pricing, trial banner, counter, upgrade copy). Under the free beta the
  // server resolves it to 'beta'.
  plan: string;
  trial_ends_at: string | null;
  expired: boolean;
  // Stored plan: ONLY for the Stripe portal button — a paying user must keep
  // portal access (self-service cancel) while the beta overrides limits.
  rawPlan: string;
  billingEnabled: boolean;
  // Set via BETA_END_DATE env at T-14 (runbook §3) → end-of-beta banner.
  betaEndDate: string | null;
}

interface ScheduledMessage {
  id: string;
  recipient_name?: string;
  recipient_number?: string;
  parsed_message?: string;
  caption?: string;
  scheduled_at: string;
  status: string;
  retry_count?: number;
  error_message?: string;
  photo_url?: string | null;
  sent_at?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
}

type Segment = 'D' | 'B' | 'C' | null;

export default function DashboardPage() {
  const router = useRouter();
  const [instanceName, setInstanceName] = useState('');
  const [userPhone, setUserPhone]       = useState('');
  const [messages, setMessages]         = useState<ScheduledMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionState>({ plan: 'unknown', trial_ends_at: null, expired: false, rawPlan: 'unknown', billingEnabled: true, betaEndDate: null });
  const [connected, setConnected] = useState(true); // Evolution link state from /api/messages
  // Limite di oggi dalla GET (rampa dei primi giorni, piano, invii fatti, coda):
  // null = server vecchio o calcolo non riuscito → testo generico.
  const [todayLimit, setTodayLimit] = useState<TodayLimit | null>(null);
  const [sessionValidated, setSessionValidated] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<PickedContact | null>(null);
  const [showShareToast, setShowShareToast] = useState(false);
  // Toast for inline feedback after duplicate/pause/delete actions. Auto-dismisses in 5s.
  const [toast, setToast] = useState<{ text: string; undo?: () => void; id: number } | null>(null);
  // Carry an initial message text into ScheduleModal when duplicating.
  const [prefillText, setPrefillText] = useState<string>('');
  // When editing a message in-place, track its id so ScheduleModal calls PATCH.
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  // Allegato con cui si apre la modale: in modifica E in Duplica (prima Duplica
  // lo perdeva in silenzio e partiva solo la didascalia).
  const [editingMedia, setEditingMedia] = useState<{ media_type: 'image' | 'video' | 'document' | 'audio'; media_url: string; media_filename: string; bytes: number } | null>(null);
  // Duplica di un messaggio il cui file è già stato tolto dalla pulizia dei 30 giorni.
  const [mediaUnavailable, setMediaUnavailable] = useState(false);
  // Modifica: orario e ripetizione attuali, così la modale riparte da lì.
  const [editingScheduledAt, setEditingScheduledAt] = useState<string | null>(null);
  const [editingRecurrenceRule, setEditingRecurrenceRule] = useState<string | null>(null);
  // Modale aperta da "Riattiva" su un orario passato: salvando rimette in coda.
  const [editingResume, setEditingResume] = useState(false);
  // "Riattiva" su un messaggio in pausa il cui orario è passato: si chiede
  // "Invia ora" / "Scegli un nuovo orario" invece di rimetterlo in coda col
  // vecchio orario (partiva entro un minuto, a qualsiasi ora).
  const [timePassedMsg, setTimePassedMsg] = useState<MessagesSectionMessage | null>(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  // Onboarding hints — gated on localStorage. Resolved post-mount to avoid
  // SSR hydration mismatch on localStorage access.
  const [showOnboardingHints, setShowOnboardingHints] = useState(false);
  // Porta finta "foto del calendario" (GET /api/feedback, una volta per apertura).
  const [fakeDoor, setFakeDoor] = useState<{ active: boolean; answered: boolean }>({ active: false, answered: false });
  const feedbackAskedRef = useRef(false);

  const msgTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevLifetimeRef = useRef<number | null>(null);

  useEffect(() => {
    setShowOnboardingHints(shouldShowOnboardingHints());
  }, []);

  // --- Cookie-based auth check on mount ---
  // Solo un 401 vero porta a /connect; rete assente / 5xx / HTML di un captive
  // portal → "Connessione assente, riprovo" e nuovo tentativo (fase 1b: prima
  // un blip all'apertura spingeva a re-inserire il numero, e init scollegava un
  // WhatsApp funzionante). Vedi app/lib/session-load.ts.
  const [sessionOffline, setSessionOffline] = useState(false);
  const sessionRetryRef = useRef<() => void>(() => {});
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      if (timer) { clearTimeout(timer); timer = null; }
      const out = await checkSession();
      if (cancelled) return;
      if (out.kind === 'login') {
        goTo('/connect');
        return;
      }
      if (out.kind === 'retry') {
        setSessionOffline(true);
        timer = setTimeout(() => { void load(); }, sessionRetryDelayMs(attempt++));
        return;
      }
      setSessionOffline(false);
      setUserPhone(out.phone);
      setInstanceName(out.instanceName);
      setSessionValidated(true);
      // La cache della rubrica appartiene a questo numero: se la sessione è cambiata
      // (altra scheda, bfcache) si svuota prima di qualunque lettura.
      setContactsCacheOwner(out.phone || null);
      // Scalda la rubrica a pagina ferma: alla prima apertura del picker la lista c'è già.
      const idle: (cb: () => void) => void =
        (window as any).requestIdleCallback || ((cb: () => void) => setTimeout(cb, 1500));
      idle(() => { void prefetchContacts(); });
    };
    sessionRetryRef.current = () => { attempt = 0; void load(); };
    // Tornata la rete: riprova subito invece di aspettare il prossimo giro.
    const onOnline = () => sessionRetryRef.current();
    window.addEventListener('online', onOnline);
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  // Una sola GET /api/feedback per apertura: dice se mostrare la porta finta e
  // registra lato server l'apertura della dashboard (dashboard_seen, max 1 al giorno).
  // Gli errori si ignorano: la scheda semplicemente non compare.
  useEffect(() => {
    if (!sessionValidated || feedbackAskedRef.current) return;
    feedbackAskedRef.current = true;
    fetch('/api/feedback')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setFakeDoor({ active: !!b?.calendar_photo?.active, answered: !!b?.calendar_photo?.answered }))
      .catch(() => {});
  }, [sessionValidated]);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch('/api/messages');
      if (res.status === 403) {
        const err = await res.json();
        setSubscription({ plan: err.subscription_plan || 'expired', trial_ends_at: err.trial_ends_at, expired: true, rawPlan: err.raw_plan || err.subscription_plan || 'expired', billingEnabled: err.billing_enabled !== false, betaEndDate: null });
        setMessages([]);
        return;
      }
      if (res.ok) {
        const d = await res.json();
        if (d.messages) {
          setMessages(Array.isArray(d.messages) ? d.messages : []);
          setSubscription({ plan: d.subscription_plan || 'free', trial_ends_at: d.trial_ends_at, expired: false, rawPlan: d.raw_plan || d.subscription_plan || 'free', billingEnabled: d.billing_enabled !== false, betaEndDate: d.beta_end_date || null });
          setConnected(d.connection_status === 'open');
          setTodayLimit(d.today_limit && typeof d.today_limit.limit === 'number' ? d.today_limit : null);
          if (typeof d.total_scheduled_lifetime === 'number') {
            const next = d.total_scheduled_lifetime;
            if (prevLifetimeRef.current === 0 && next === 1) {
              setShowShareToast(true);
              // First successful schedule — graduate onboarding hints.
              // Not gated on the "Skip" button (which no longer exists);
              // gated on real product progress.
              markOnboardingDone();
              setShowOnboardingHints(false);
              // Unlock the install banner. InstallPrompt mounts above; it
              // reads the flag at mount and listens for this event so it
              // surfaces immediately on the same first-msg transition.
              try { localStorage.setItem('wl_first_msg_done', '1'); } catch { /* private mode */ }
              try { window.dispatchEvent(new Event('wl-first-msg-done')); } catch { /* SSR */ }
            }
            prevLifetimeRef.current = next;
          }
        } else setMessages(Array.isArray(d) ? d : []);
      }
    } catch {
      // ignore
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionValidated) {
      fetchMessages();
      if (msgTimer.current) clearInterval(msgTimer.current);
      msgTimer.current = setInterval(fetchMessages, 30000);
    }
    return () => { if (msgTimer.current) clearInterval(msgTimer.current); };
  }, [sessionValidated, fetchMessages]);


  // Freno educativo (incidente 23 ago): la stabilità del collegamento È il
  // prodotto e per rientrare serve il supporto finché il recupero self-service
  // (OTP v1.5) non esiste. Prima un window.confirm diceva che i messaggi
  // "partono COMUNQUE": falso, "Disconnetti" scollega davvero WhatsApp, e la coda
  // restava lì a partire tutta insieme al ricollegamento, settimane dopo
  // (7 set 2026). Ora il dialogo chiede cosa fare della coda; di default la
  // mette in pausa, così niente parte da solo a un ricollegamento futuro.
  const handleLogout = () => setLogoutOpen(true);

  // 'device' = esci solo da qui (i promemoria continuano); il resto scollega
  // WhatsApp con la scelta sulla coda (fase 1b, vedi LogoutDialog).
  const doLogout = async (choice: LogoutChoice) => {
    if (msgTimer.current) clearInterval(msgTimer.current);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(choice === 'device' ? { scope: 'device' } : { queue: choice }),
      });
    } catch {
      // ignore
    }
    window.location.href = '/';
  };

  // scope arriva solo dalle righe ricorrenti ("Solo questa volta" / "Tutta la
  // serie", chiesto da MessagesSection).
  const handleDelete = async (id: string, scope?: 'occurrence' | 'series') => {
    try {
      const res = await fetch('/api/messages', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scope ? { id, scope } : { id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.message || apiErrorText(data, res.status));
        return;
      }
      // Toast SOLO a eliminazione avvenuta (prima MessagesSection diceva
      // "Eliminato" subito, anche quando il server rifiutava).
      const gone = messages.find((m) => m.id === id);
      // Gruppo: mai le cifre del JID. Persona: come prima.
      const who = gone && isGroupJid(gone.recipient_number)
        ? recipientDisplayName(gone)
        : gone?.recipient_name || gone?.recipient_number || 'messaggio';
      if (typeof data?.skipped_to === 'string') {
        showToast(`Saltato questa volta — il prossimo parte ${formatShortWhen(new Date(data.skipped_to))}`);
      } else if (scope === 'series') {
        showToast(`Promemoria ricorrente interrotto — ${who}`);
      } else {
        showToast(`Eliminato — ${who}`);
      }
      fetchMessages();
    } catch {
      showToast('Errore di rete — riprova.');
    }
  };

  // Inline toast surface used by MessagesSection for delete/duplicate/pause feedback.
  const showToast = useCallback((text: string, undo?: () => void) => {
    const id = Date.now();
    setToast({ text, undo, id });
    setTimeout(() => {
      setToast((curr) => (curr && curr.id === id ? null : curr));
    }, 5000);
  }, []);

  // Google Calendar OAuth callback lands here with ?calendar=connected|error.
  // Toast the outcome once the page is actually rendering (post auth-check,
  // so the 5s auto-dismiss doesn't race the session validation), then strip
  // the param so a refresh doesn't re-toast.
  const calendarParamHandled = useRef(false);
  useEffect(() => {
    if (!sessionValidated || calendarParamHandled.current) return;
    calendarParamHandled.current = true;
    const cal = new URLSearchParams(window.location.search).get('calendar');
    if (!cal) return;
    if (cal === 'connected') showToast('Google Calendar collegato!');
    else if (cal === 'error') showToast('Collegamento Google Calendar non riuscito — riprova.');
    router.replace('/dashboard');
  }, [sessionValidated, showToast, router]);

  // Duplicate — opens ScheduleModal pre-filled with the same contact and text.
  // Skips the contact picker step entirely. The user just confirms date/time.
  const handleDuplicate = useCallback((msg: MessagesSectionMessage) => {
    setSelectedContact({
      number: msg.recipient_number || '',
      name: msg.recipient_name,
    });
    setPrefillText(msg.parsed_message || msg.caption || '');
    // Stesso file dello Storage: la nuova riga pending lo protegge dalla pulizia.
    setEditingMedia(mediaOf(msg));
    setMediaUnavailable(!!msg.media_type && !msg.media_url);
    setEditingMsgId(null);
    setScheduleOpen(true);
  }, []);

  // Numero sconosciuto a WhatsApp: stesso testo (e allegato) verso un altro
  // contatto scelto dalla rubrica. Riprova qui non servirebbe a niente.
  const handleChooseOtherContact = useCallback((msg: MessagesSectionMessage) => {
    setPrefillText(msg.parsed_message || msg.caption || '');
    setEditingMedia(mediaOf(msg));
    setMediaUnavailable(!!msg.media_type && !msg.media_url);
    setEditingMsgId(null);
    setContactPickerOpen(true);
  }, []);

  // Edit — open ScheduleModal in edit mode: pre-fill contact+text and pass the
  // original message id so handleSubmit routes to PATCH (edit-in-place) instead
  // of POST (new schedule). The original message is NOT duplicated.
  const handleEdit = useCallback((msg: MessagesSectionMessage) => {
    setSelectedContact({
      number: msg.recipient_number || "",
      name: msg.recipient_name,
    });
    setPrefillText(msg.parsed_message || msg.caption || "");
    setEditingMsgId(msg.id);
    // La modale riparte dall'orario e dalla ripetizione del messaggio.
    setEditingScheduledAt(msg.scheduled_at);
    setEditingRecurrenceRule(msg.recurrence_rule || null);
    setEditingResume(false);
    // Allegato esistente: la modale lo mostra e permette di toglierlo o sostituirlo.
    setEditingMedia(mediaOf(msg));
    setScheduleOpen(true);
  }, []);

  const resetModalPrefill = () => {
    setPrefillText('');
    setEditingMsgId(null);
    setEditingMedia(null);
    setMediaUnavailable(false);
    setEditingScheduledAt(null);
    setEditingRecurrenceRule(null);
    setEditingResume(false);
  };

  // Pause/resume — optimistic; backend ignores unknown statuses silently for now.
  const handlePauseToggle = useCallback(async (msg: MessagesSectionMessage) => {
    const newStatus = msg.status === 'paused' ? 'pending' : 'paused';
    // Riprendere un messaggio il cui orario è già passato lo farebbe partire
    // subito col testo vecchio: si chiede prima (il server fa lo stesso
    // controllo e risponde 409 time_passed, gestito sotto).
    if (newStatus === 'pending' && new Date(msg.scheduled_at).getTime() < Date.now() + 60_000) {
      setTimePassedMsg(msg);
      return;
    }
    // Optimistic
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, status: newStatus } : m)));
    if (newStatus === 'paused') showToast('Messaggio in pausa');
    try {
      const res = await fetch('/api/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: msg.id, status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, status: msg.status } : m)));
        if (data?.error === 'time_passed') setTimePassedMsg(msg);
        else showToast(apiErrorText(data, res.status));
      } else if (newStatus === 'pending') {
        // "Riattivato" solo a conferma avvenuta: il server può dire time_passed.
        showToast('Messaggio riattivato');
      }
      fetchMessages();
    } catch {
      // Roll back on network error
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, status: msg.status } : m)));
      showToast('Errore di rete — riprova.');
    }
  }, [fetchMessages, showToast]);

  // "Invia ora" dal dialogo orario-passato: tra ~2 minuti (il PATCH vuole
  // almeno 60 s nel futuro; il margine copre la latenza). È una scelta
  // esplicita dell'utente, quindi niente fascia 08-21.
  const handleResumeNow = useCallback(async (msg: MessagesSectionMessage) => {
    setTimePassedMsg(null);
    try {
      const res = await fetch('/api/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: msg.id, status: 'pending', scheduled_at: new Date(Date.now() + 2 * 60_000).toISOString(), keep_recurrence_anchor: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.message || apiErrorText(data, res.status));
      } else {
        showToast('Riattivato — parte tra un paio di minuti');
      }
      fetchMessages();
    } catch {
      showToast('Errore di rete — riprova.');
    }
  }, [fetchMessages, showToast]);

  // "Riprendi dalla prossima volta" (serie in pausa con l'orario passato,
  // rapporto 360 B2/T17): la riga torna in coda alla prossima volta della serie,
  // all'ora di sempre. Il vecchio avviso non parte, le volte perse si saltano.
  // keep_recurrence_anchor: l'ora delle volte dopo resta quella scelta all'inizio.
  const handleResumeNext = useCallback(async (msg: MessagesSectionMessage, next: Date) => {
    setTimePassedMsg(null);
    try {
      const res = await fetch('/api/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: msg.id, status: 'pending', scheduled_at: next.toISOString(), keep_recurrence_anchor: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.message || apiErrorText(data, res.status));
      } else {
        showToast(`Ripreso — la prossima volta parte ${formatShortWhen(next)}`);
      }
      fetchMessages();
    } catch {
      showToast('Errore di rete — riprova.');
    }
  }, [fetchMessages, showToast]);

  // "Scegli un nuovo orario": la modale di modifica, che salvando rimette in coda.
  const handleResumeWithNewTime = useCallback((msg: MessagesSectionMessage) => {
    setTimePassedMsg(null);
    handleEdit(msg);
    setEditingResume(true);
  }, [handleEdit]);

  // Snooze one-tap — reschedule via PATCH without opening the edit modal.
  // Optimistic update on scheduled_at; the refetch settles the jittered value.
  const handleSnooze = useCallback(async (msg: MessagesSectionMessage, iso: string, label: string) => {
    const prev = msg.scheduled_at;
    setMessages((p) => p.map((m) => (m.id === msg.id ? { ...m, scheduled_at: iso } : m)));
    try {
      const res = await fetch('/api/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: msg.id, scheduled_at: iso, keep_recurrence_anchor: true }),
      });
      if (!res.ok) {
        setMessages((p) => p.map((m) => (m.id === msg.id ? { ...m, scheduled_at: prev } : m)));
        const data = await res.json().catch(() => ({}));
        showToast(data.message || 'Non sono riuscito a posticiparlo — riprova.');
        return;
      }
      // Il toast dice il nuovo orario vero (label resta per chiarezza del preset).
      // Un messaggio in pausa resta in pausa: prima il toast diceva
      // "Posticipato" e il messaggio non partiva mai.
      const when = formatShortWhen(new Date(iso));
      showToast(msg.status === 'paused'
        ? `Spostato a ${when} (${label.toLowerCase()}) — resta in pausa finché non lo riprendi`
        : `Posticipato a ${when} (${label.toLowerCase()})`);
      fetchMessages();
    } catch {
      setMessages((p) => p.map((m) => (m.id === msg.id ? { ...m, scheduled_at: prev } : m)));
      showToast('Errore di rete — riprova.');
    }
  }, [fetchMessages, showToast]);

  // Retry — re-queue a failed message (status: failed → pending). The
  // FailedMessageCard owns the inline spinner (it awaits this), so we DON'T
  // optimistically flip the status: the card stays red/spinning until the
  // PATCH + refetch resolve, then the refetch moves it back into the live
  // queue. On failure we toast and leave the card so the user can retry again.
  const handleRetry = useCallback(async (msg: MessagesSectionMessage) => {
    try {
      const res = await fetch('/api/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: msg.id, action: 'retry' }),
      });
      if (!res.ok) {
        // Il server spiega perché (es. numero che WhatsApp non conosce).
        const data = await res.json().catch(() => ({}));
        showToast(data.message || 'Non sono riuscito a rimetterlo in coda — riprova.');
        await fetchMessages();
        return;
      }
      showToast('Rimesso in coda — riprovo a inviarlo a breve.');
      await fetchMessages();
    } catch {
      showToast('Errore di rete — riprova.');
    }
  }, [fetchMessages, showToast]);

  // Status → coloured dot. Pending/awaiting/sending share the orange "in
  // attesa" bucket; sent green; failed red; cancelled gray.
  const statusConfig: Record<string, { color: string; label: string }> = {
    awaiting_confirm:  { color: '#F97316', label: 'In attesa di conferma' },
    awaiting_contact:  { color: '#F97316', label: 'In attesa del contatto' },
    awaiting_datetime: { color: '#F97316', label: 'In attesa della data' },
    awaiting_message:  { color: '#F97316', label: 'In attesa del messaggio' },
    pending:           { color: '#F97316', label: 'In attesa' },
    sending:           { color: '#F97316', label: 'In invio...' },
    sent:              { color: '#22C55E', label: 'Inviato' },
    failed:            { color: '#EF4444', label: 'Non inviato' },
    cancelled:         { color: '#9CA3AF', label: 'Annullato' },
  };

  // Always format the scheduled date — never collapse past dates to a
  // "Scaduto" label. Weekday names are only used for upcoming dates within
  // the next week; past dates older than yesterday show the full DD mon
  // form so the user can read history unambiguously.
  function formatScheduled(scheduledAt: string): { date: string; time: string } {
    const target = new Date(scheduledAt);
    const now = new Date();

    const hh = target.getHours().toString().padStart(2, '0');
    const mm = target.getMinutes().toString().padStart(2, '0');
    const time = `${hh}:${mm}`;

    const targetMidnight = new Date(target); targetMidnight.setHours(0, 0, 0, 0);
    const nowMidnight = new Date(now); nowMidnight.setHours(0, 0, 0, 0);
    const diffDays = Math.round((targetMidnight.getTime() - nowMidnight.getTime()) / 86400000);

    if (diffDays === 0) return { date: 'oggi', time };
    if (diffDays === 1) return { date: 'domani', time };
    if (diffDays === -1) return { date: 'ieri', time };
    if (diffDays > 1 && diffDays < 7) {
      const days = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
      return { date: days[target.getDay()], time };
    }

    const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
    const dd = target.getDate();
    return { date: `${dd} ${months[target.getMonth()]}`, time };
  }

  // Pricing visibility:
  // - free / expired → always show (they need to pay)
  // - trial with > 3 days left → hide (don't pester active users)
  // - trial with ≤ 3 days left → show (last call to convert)
  let trialDaysLeft = Infinity;
  if (subscription.plan === 'trial' && subscription.trial_ends_at) {
    trialDaysLeft = Math.max(0, Math.ceil(
      (new Date(subscription.trial_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    ));
  }
  const showPricing =
    subscription.plan === 'free' ||
    subscription.expired ||
    (subscription.plan === 'trial' && trialDaysLeft <= 3);
  const showFAQ = showPricing;

  // Pulse ring on the FAB whenever the "Prossimi" tab would be empty —
  // i.e. no message in pending/sending/paused/awaiting_*/failed state. Mirrors
  // the MessagesSection partition (which now surfaces failed messages at the
  // top of Prossimi) so the two stay in sync: a user whose only messages
  // failed has actionable content (Riprova) and must NOT get the "schedule your
  // first" pulse. Gated on `!messagesLoading` so the ring doesn't flicker on
  // first paint before /api/messages has resolved.
  const queueEmpty =
    !messagesLoading &&
    !messages.some((m) => m.status !== 'sent' && m.status !== 'cancelled');

  if (!sessionValidated) {
    return (
      <div className="min-h-screen bg-[#111B21] flex flex-col items-center justify-center gap-4 px-6 text-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        {sessionOffline && (
          <div role="status" className="space-y-3">
            <p className="text-sm text-gray-300">Connessione assente — riprovo da solo.</p>
            <p className="text-xs text-gray-400">WhatsApp resta collegato: i messaggi programmati partono comunque.</p>
            <button
              type="button"
              onClick={() => sessionRetryRef.current()}
              className="rounded-lg bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
            >
              Riprova ora
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#111B21] text-white font-sans">
      {/* rawPlan, not plan: the portal button must stay visible for real
          subscribers even while the beta resolves everyone's plan to 'beta'. */}
      <DashboardNavbar userPhone={userPhone} plan={subscription.rawPlan} onLogout={handleLogout} />

      {/* Status strip — fuses connected + plan + daily counter + contextual upgrade */}
      <StatusStrip
        userPhone={userPhone}
        subscription={subscription}
        messages={messages}
        connected={connected}
        todayLimit={todayLimit}
      />

      <main className="flex-1 flex flex-col w-full max-w-2xl mx-auto px-4 pt-6 pb-12 space-y-8">
        {/* Banner in pagina (pull-only, niente push: principio silenzioso). */}
        {userPhone && !connected && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/40 px-4 py-3 flex items-center justify-between gap-3" role="status" data-testid="disconnected-banner">
            <div className="text-sm text-red-200">
              <strong>WhatsApp scollegato</strong> — i messaggi in coda partiranno quando lo ricolleghi.
            </div>
            <a href="/connect" className="shrink-0 rounded-lg bg-red-500 px-3 py-2 text-sm font-semibold text-white">Ricollega</a>
          </div>
        )}
        {userPhone && (
          subscription.expired ? (
            <div className="bg-[#202C33] border border-red-500/40 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-red-400">Trial Scaduto</p>
                <p className="text-sm text-gray-400">Abbonati per continuare.</p>
              </div>
              <a href="#prezzi" className="px-4 py-2 bg-primary text-[#0B141A] rounded-xl font-medium text-sm">Abbonati</a>
            </div>
          ) : messagesLoading ? (
            <div className="bg-[#202C33] rounded-2xl border border-[#2A3942] p-12 text-center">
              <Loader2 className="w-6 h-6 text-primary animate-spin mx-auto mb-2" />
              <p className="text-gray-400">Caricamento...</p>
            </div>
          ) : messages.length === 0 ? (
            showOnboardingHints
              ? <MessagesEmptyState className="flex-1" />
              : <EmptyState />
          ) : (
            <MessagesSection
              messages={messages}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onEdit={handleEdit}
              onPauseToggle={handlePauseToggle}
              onRetry={handleRetry}
              onSnooze={handleSnooze}
              onShowToast={showToast}
              onChooseOtherContact={handleChooseOtherContact}
              connected={connected}
              fakeDoor={fakeDoor}
              onFakeDoorAnswered={() => setFakeDoor((f) => ({ ...f, answered: true }))}
            />
          )
        )}

        {/* Google Calendar reminders — the card manages its own visibility:
            it renders nothing while CALENDAR_SYNC_ENABLED is off (GET
            /api/calendar → {enabled:false}), so mounting it unconditionally
            here is safe. */}
        {userPhone && <CalendarSyncCard onShowToast={showToast} />}

        {/* Pricing visible only to free/trial (and expired so the "Abbonati"
            anchor in the expired banner still resolves). Paying users manage
            their subscription via the navbar link, no need to show plans. */}
        {showPricing && (
          <PricingSection currentPlan={subscription.plan} userPhone={userPhone} theme="dark" />
        )}

        <ContactPickerModal
          open={contactPickerOpen}
          // Chiuso senza scegliere: niente testo/allegato residui nel prossimo messaggio.
          onClose={() => { setContactPickerOpen(false); setPrefillText(''); setEditingMedia(null); setMediaUnavailable(false); }}
          onSelect={(contact) => {
            setSelectedContact(contact);
            setContactPickerOpen(false);
            setScheduleOpen(true);
          }}
        />

        <ScheduleModal
          open={scheduleOpen}
          onClose={() => { setScheduleOpen(false); setSelectedContact(null); resetModalPrefill(); }}
          onBack={() => { setScheduleOpen(false); setContactPickerOpen(true); resetModalPrefill(); }}
          contact={selectedContact}
          onScheduled={fetchMessages}
          initialMessage={prefillText}
          editMsgId={editingMsgId}
          initialMedia={editingMedia}
          initialScheduledAt={editingScheduledAt}
          initialRecurrenceRule={editingRecurrenceRule}
          mediaUnavailable={mediaUnavailable}
          connected={connected}
          resumeOnSave={editingResume}
          todayLimit={todayLimit}
          queue={messages}
        />

        {timePassedMsg && (
          <TimePassedDialog
            msg={timePassedMsg}
            onCancel={() => setTimePassedMsg(null)}
            onSendNow={() => { void handleResumeNow(timePassedMsg); }}
            onResumeNext={(next) => { void handleResumeNext(timePassedMsg, next); }}
            onPickTime={() => handleResumeWithNewTime(timePassedMsg)}
          />
        )}

        <LogoutDialog
          open={logoutOpen}
          pendingCount={messages.filter((m) => m.status === 'pending').length}
          onCancel={() => setLogoutOpen(false)}
          onConfirm={(queue) => { setLogoutOpen(false); void doLogout(queue); }}
        />

        {showShareToast && (
          <ShareToast onClose={() => setShowShareToast(false)} />
        )}
      </main>

      {/* FAB — mobile round, desktop pill. Pulse ring is active whenever the
          "Prossimi" queue is empty (no pending/awaiting message), so any user
          without scheduled messages gets guided to the action — not just
          first-run onboarding. Auto-quiets the moment a message is queued. */}
      {/* Sopra la barretta dell'iPhone quando il browser ne dà la misura (B5 del 30/9).
          Pillola "+ Programma" alta 56px, testo 16px #0B141A sul verde (9,4:1):
          prima un cerchio con l'aeroplanino, che fa pensare a "invia adesso"
          (rapporto 360, T24). Il nome per i lettori di schermo contiene la
          scritta a vista. */}
      <div className="sm:hidden fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-4 z-fab" data-testid="mobile-fab">
        {queueEmpty && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-primary onboarding-pulse-ring pulse-pill pointer-events-none"
          ></span>
        )}
        <button
          type="button"
          onClick={() => setContactPickerOpen(true)}
          className="relative h-14 pl-4 pr-5 bg-primary text-[#0B141A] rounded-full shadow-2xl flex items-center gap-1.5 text-base font-semibold hover:bg-primary-hover active:scale-95 transition-transform"
          aria-label="Programma un messaggio"
        >
          <Plus className="w-6 h-6" strokeWidth={2.5} aria-hidden="true" />
          Programma
        </button>
      </div>

      <div className="hidden sm:block fixed bottom-6 right-6 z-fab">
        {queueEmpty && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-primary onboarding-pulse-ring pulse-pill pointer-events-none"
          ></span>
        )}
        <button
          type="button"
          onClick={() => setContactPickerOpen(true)}
          className="relative bg-primary text-[#0B141A] rounded-full shadow-2xl h-14 px-6 flex items-center gap-2 text-base font-semibold hover:bg-primary-hover active:scale-95 transition-transform"
        >
          <Plus className="w-5 h-5" strokeWidth={2.5} aria-hidden="true" />
          Programma un messaggio
        </button>
      </div>

      {showFAQ && <FAQSection theme="dark" />}

      {/* Micro-riga legale — sostituisce il footer marketing su dashboard.
          Niente blocco verde / CTA, solo riassicurazione cifratura.
          shrink-0 so the flex-col root keeps it anchored at the bottom. */}
      {/* 12px #8696A0 su #0B141A = 6,1:1 (prima 11px gray-600, 2,46:1). pb-24 su
          telefono: la riga non finisce sotto la pillola "+ Programma". */}
      <footer className="shrink-0 border-t border-[#2A3942] bg-[#0B141A] pt-3 pb-24 sm:pb-3 px-4 text-center">
        <p className="text-xs text-[#8696A0] leading-relaxed">
          © 2026 WhatsLater · I tuoi messaggi sono cifrati. Non li leggiamo mai.
        </p>
      </footer>

      <InstallPrompt />

      {/* Action toast — surfaces feedback from MessagesSection (duplicate/pause/delete). */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-toast w-[calc(100%-2rem)] sm:w-auto sm:max-w-md">
          <div className="bg-[#2A3942] border border-[#3B4A54] rounded-xl px-4 py-3 flex items-center gap-3 shadow-2xl">
            <span className="flex-1 text-sm text-white">{toast.text}</span>
            {toast.undo && (
              <button
                onClick={() => { toast.undo!(); setToast(null); }}
                className="text-primary font-bold text-xs uppercase tracking-wider"
              >
                Annulla
              </button>
            )}
            <button
              onClick={() => setToast(null)}
              className="text-gray-500 hover:text-gray-300 -m-1 p-1"
              aria-label="Chiudi"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// "Riattiva" su un messaggio in pausa il cui orario è già passato. Pull-only:
// si apre solo dal tocco dell'utente, nessuna notifica.
// Serie (rapporto 360 B2/T17): prima c'erano solo "Invia ora" (che manda il
// vecchio avviso) e "Scegli un nuovo orario" (che rifà l'ora di tutte le volte
// dopo). Ora la prima scelta è "Riprendi dalla prossima volta (…)".
function TimePassedDialog({ msg, onCancel, onSendNow, onResumeNext, onPickTime }: {
  msg: MessagesSectionMessage; onCancel: () => void; onSendNow: () => void; onResumeNext: (next: Date) => void; onPickTime: () => void;
}) {
  // Indietro chiude solo questa finestra, come "Lascia in pausa" (rapporto 360, T13).
  useModalHistory(true, onCancel);
  const when = formatShortWhen(new Date(msg.scheduled_at));
  const next = msg.recurrence_rule ? resumeNextOccurrence(msg) : null;
  const seriesLabel = msg.recurrence_rule ? recurrenceTagLabel(msg.recurrence_rule) : null;
  return (
    <div className="wl-viewport z-sheet flex items-end sm:items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="time-passed-title"
        data-testid="time-passed-dialog"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-h-full overflow-y-auto overscroll-contain sm:max-w-sm sm:mx-4 bg-[#1F2C33] border-t sm:border border-[#2A3942] rounded-t-2xl sm:rounded-2xl p-5 pb-safe shadow-2xl"
      >
        <h3 id="time-passed-title" className="text-white font-semibold">L&apos;orario è già passato</h3>
        {next ? (
          <p className="text-sm text-gray-400 mt-1">
            Era programmato per {when}. È un messaggio che si ripete{seriesLabel ? ` (${seriesLabel})` : ''}: puoi ripartire dalla prossima volta, senza mandare quello vecchio.
          </p>
        ) : (
          <p className="text-sm text-gray-400 mt-1">
            Era programmato per {when}. Se lo riprendi così parte subito, con il testo di allora: controlla che sia ancora giusto.
          </p>
        )}
        <div className="mt-4 flex flex-col gap-2">
          {next && (
            <button
              onClick={() => onResumeNext(next)}
              className="w-full py-3 rounded-xl bg-primary/15 text-primary font-semibold hover:bg-primary/25 transition-colors"
            >
              Riprendi dalla prossima volta ({formatShortWhen(next)})
            </button>
          )}
          <button
            onClick={onSendNow}
            className={next
              ? 'w-full py-3 rounded-xl bg-white/[0.06] text-gray-100 font-semibold hover:bg-white/10 transition-colors'
              : 'w-full py-3 rounded-xl bg-primary/15 text-primary font-semibold hover:bg-primary/25 transition-colors'}
          >
            Invia ora
          </button>
          <button
            onClick={onPickTime}
            className="w-full py-3 rounded-xl bg-white/[0.06] text-gray-100 font-semibold hover:bg-white/10 transition-colors"
          >
            Scegli un nuovo orario
          </button>
          <button
            onClick={onCancel}
            className="w-full py-2.5 rounded-xl text-gray-400 hover:text-gray-200 transition-colors"
          >
            Lascia in pausa
          </button>
        </div>
      </div>
    </div>
  );
}

// Allegato di una riga nel formato della modale (null se manca o è stato
// già rimosso dallo Storage dalla pulizia dei 30 giorni).
function mediaOf(msg: MessagesSectionMessage): { media_type: 'image' | 'video' | 'document' | 'audio'; media_url: string; media_filename: string; bytes: number } | null {
  const mt = msg.media_type;
  return msg.media_url && (mt === 'image' || mt === 'video' || mt === 'document' || mt === 'audio')
    ? { media_type: mt, media_url: msg.media_url, media_filename: msg.media_filename || '', bytes: 0 }
    : null;
}

// --- Status Strip (fuses ConnectedCard + PlanBadge + DailyCapBadge + contextual upgrade) ---
function StatusStrip({ userPhone, subscription, messages, connected, todayLimit }: {
  userPhone: string;
  subscription: SubscriptionState;
  messages: ScheduledMessage[];
  connected: boolean;
  todayLimit: TodayLimit | null;
}) {
  const planKnown = subscription.plan !== 'unknown';
  const planLabel = getPlanName(subscription.plan);
  const limits = getPlanLimits(subscription.plan);
  // 'beta' included: transparency on the beta cap (50/day) beats hiding it.
  // Nei primi giorni dal collegamento si vede con qualunque piano: è lì che
  // il limite vero (5, 10…) è lontano da quello del piano.
  const showCounter = planKnown && (subscription.plan === 'free' || subscription.plan === 'personal' || subscription.plan === 'professional' || subscription.plan === 'beta' || !!todayLimit?.warmup);
  // Numero vero dal server (B3): "Oggi partono 2 messaggi (massimo 5 oggi) · nei primi giorni…".
  const strip = todayLimit ? todayStripText(todayLimit) : null;

  // Count messages scheduled or sent today (matches legacy DailyCapBadge logic)
  const today = new Date();
  const sameDay = (d: Date) =>
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const countToday = messages.filter((m) => {
    if (m.status !== 'sent' && m.status !== 'pending') return false;
    const sched = new Date(m.scheduled_at);
    return !isNaN(sched.getTime()) && sameDay(sched);
  }).length;

  // Trial countdown
  let trialDays = 0;
  if (subscription.plan === 'trial' && subscription.trial_ends_at) {
    trialDays = Math.max(0, Math.ceil(
      (new Date(subscription.trial_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    ));
  }

  // Last 4 digits of phone + masked country/area code for trust without exposing the full number.
  // E.g. raw "393331234567" → displayed "+39 333 ··· 4567".
  const maskedPhone = ((): string => {
    if (!userPhone) return '';
    const digits = userPhone.replace(/\D/g, '');
    if (digits.length < 6) return digits ? `···${digits.slice(-4)}` : '';
    // Italian numbers: country code 39 + 3-digit prefix + 7 digits = 12 total.
    if (digits.startsWith('39') && digits.length >= 11) {
      const prefix = digits.slice(2, 5);
      const last4 = digits.slice(-4);
      return `+39 ${prefix} ··· ${last4}`;
    }
    const last4 = digits.slice(-4);
    const cc = digits.slice(0, Math.min(3, digits.length - 4));
    return `+${cc} ··· ${last4}`;
  })();

  // Context-aware upgrade copy. The 'trial' case is handled by <TrialBanner/>
  // below (dismissible outline early on, fixed-urgent in the last 3 days).
  const upgradeCopy = ((): string | null => {
    if (!planKnown) return null;
    switch (subscription.plan) {
      case 'free':
        return 'Sblocca 20 msg/giorno con Personal €4.99 →';
      case 'personal':
        return 'Passa a Professional per 35 msg/giorno →';
      case 'professional':
        return 'Passa a Business per 50 msg + contatti illimitati →';
      default:
        return null;
    }
  })();
  const showTrialBanner = planKnown && subscription.plan === 'trial';

  // End-of-beta notice (runbook §3): appears only when BETA_END_DATE is set
  // on Vercel at T-14 — the one advance-warning surface before billing
  // reactivation. Lifecycle exception to the silent principle.
  const betaEndLabel = ((): string | null => {
    if (subscription.billingEnabled || !subscription.betaEndDate) return null;
    const d = new Date(subscription.betaEndDate);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  })();

  return (
    <div className="max-w-4xl mx-auto px-4 pt-20 pb-3 border-b border-[#2A3942] text-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between sm:flex-wrap gap-1 sm:gap-2">
        {/* Riga 1 mobile / parte sinistra desktop: stato + piano */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Connected pill — neutral background, small primary dot for the
              "alive" signal. Reserves green-saturated treatment for FAB only. */}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#202C33] border border-[#2A3942] text-xs text-gray-400">
            <span className={'w-1.5 h-1.5 rounded-full ' + (connected ? 'bg-primary shadow-[0_0_0_3px_rgba(37,211,102,0.18)]' : 'bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.18)]')} aria-hidden></span>
            {connected ? 'Connesso' : 'Disconnesso'}
            {maskedPhone && (
              <span className="font-semibold text-white tabular-nums ml-0.5">{maskedPhone}</span>
            )}
          </span>
          {planKnown && (
            <>
              <span className="text-gray-600">·</span>
              <span className="text-gray-400">Piano {planLabel}</span>
            </>
          )}
        </div>
        {/* Riga 2 mobile / parte destra desktop: counter + upgrade */}
        {(showCounter || upgradeCopy || showTrialBanner || betaEndLabel) && (
          <div className="flex items-center justify-between gap-2 flex-wrap sm:justify-end sm:gap-3">
            {showCounter && strip && (
              // Il limite di OGGI calcolato come il cron (rampa ∧ piano). Grigio
              // chiaro a 13px per la nota: 8,8:1 sul fondo.
              <span className="text-white font-medium" data-testid="daily-counter">
                {strip.main}
                {strip.detail && <span className="text-[#AEBAC1] text-[13px]">{' '}{strip.detail}</span>}
                {strip.note && <span className="text-[#AEBAC1] text-[13px]">{' · '}{strip.note}</span>}
              </span>
            )}
            {showCounter && !strip && (
              // Senza il dato del server: "meno nei primi giorni" solo se la rampa
              // (da 5) scende sotto il piano: col Free (3 al giorno) non è vero.
              <span className="text-white font-medium" data-testid="daily-counter">
                Oggi {countToday === 1 ? 'parte' : 'partono'} {countToday} messagg{countToday === 1 ? 'io' : 'i'}
                <span className="text-[#AEBAC1] text-[13px] ml-1">(fino a {limits.dailyLimit} al giorno{limits.dailyLimit > WARMUP_RAMP[0] ? ', meno nei primi giorni' : ''})</span>
              </span>
            )}
            {betaEndLabel && (
              <span className="bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded-full text-xs font-semibold shrink-0">
                La beta gratuita termina il {betaEndLabel}
              </span>
            )}
            {showTrialBanner && <TrialBanner daysLeft={trialDays} />}
            {upgradeCopy && (
              <a
                href="#prezzi"
                // Upgrade banner (non-trial) = warning → AMBER, not green.
                // Keeps the dashboard's single-green-element rule.
                className="bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 hover:bg-amber-500/15 transition-colors"
              >
                {upgradeCopy}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Trial banner (Option C) ---
// Days > 3 → outline pill with ✕ that snoozes the banner for 3 days via
// localStorage. Days ≤ 3 → solid amber pill, no ✕, always visible (last call
// to convert). Days ≤ 0 → "Trial scaduto" wording, otherwise identical.
// Dismiss state is local-only — re-pair / new device starts fresh, which is
// fine because the urgent window (≤ 3 days) overrides any stale flag anyway.
const TRIAL_DISMISS_KEY = 'wl_trial_banner_dismissed';
const TRIAL_DISMISS_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function TrialBanner({ daysLeft }: { daysLeft: number }) {
  const urgent = daysLeft <= 3;
  const expired = daysLeft <= 0;
  // Hydration guard: localStorage read must run client-side only, otherwise
  // SSR + first paint would render the dismissible state then flip to hidden.
  const [resolved, setResolved] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (urgent) {
      // Urgent window ignores the dismiss flag — always render.
      setResolved(true);
      return;
    }
    try {
      const raw = localStorage.getItem(TRIAL_DISMISS_KEY);
      if (raw) {
        const ts = new Date(raw).getTime();
        if (!isNaN(ts) && Date.now() - ts < TRIAL_DISMISS_TTL_MS) {
          setHidden(true);
        }
      }
    } catch {
      // private mode / disabled storage — fail open (show the banner)
    }
    setResolved(true);
  }, [urgent]);

  if (!resolved || hidden) return null;

  const text = expired
    ? 'Trial scaduto — attiva Personal €4.99 →'
    : daysLeft === 1
      ? '⏰ Ultimo giorno di trial — attiva Personal €4.99 →'
      : urgent
        ? `⏰ Trial scade tra ${daysLeft} giorni — attiva Personal €4.99 →`
        : `Trial scade tra ${daysLeft}gg — continua con Personal €4.99 →`;

  if (urgent) {
    return (
      <a
        href="#prezzi"
        className="bg-[#FFA500] text-[#0b141a] px-2.5 py-1 rounded-full text-xs font-bold shrink-0 hover:opacity-90 transition-opacity"
      >
        {text}
      </a>
    );
  }

  const onDismiss = () => {
    try {
      localStorage.setItem(TRIAL_DISMISS_KEY, new Date().toISOString());
    } catch {
      // ignore — banner will re-appear next paint, acceptable
    }
    setHidden(true);
  };

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <a
        href="#prezzi"
        className="border border-[#FFA500]/50 text-[#FFA500] px-2.5 py-1 rounded-full text-xs font-semibold hover:bg-[#FFA500]/10 transition-colors"
      >
        {text}
      </a>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Nascondi avviso trial per 3 giorni"
        className="w-11 h-11 -m-2 inline-flex items-center justify-center text-[#FFA500]/70 hover:text-[#FFA500] rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFA500]/40"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// --- Empty State (replaces WelcomeCard + "0 messages" placeholder) ---
// flex-1 lets the parent flex-col stretch this to fill remaining space;
// justify-center then centres the content vertically. No min-h-[55vh] —
// the parent now owns the height contract.
function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
      <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mb-4">
        <Calendar className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-bold mb-2 text-white">
        Nessun messaggio programmato
      </h2>
      <p className="text-gray-400 max-w-md mx-auto">
        Programma il prossimo messaggio per la squadra o per le famiglie. Tocca «Programma» in basso a destra per iniziare.
      </p>
    </div>
  );
}

// --- Dashboard Navbar ---
function DashboardNavbar({ userPhone, plan, onLogout }: {
  userPhone: string;
  plan: string;
  onLogout: () => void;
}) {
  const isPaying = plan === 'personal' || plan === 'professional' || plan === 'business';
  // Con una finestra o un foglio aperto la barra sparisce (rapporto 360, T9):
  // prima restava sopra la finestra del messaggio, a piena luce, con l'icona di
  // uscita toccabile mentre si scriveva.
  const layerOpen = useModalLayerOpen();

  const handlePortal = async () => {
    try {
      const res = await fetch('/api/payment/portal', { method: 'POST' });
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
      } else {
        alert('Impossibile aprire il portale. Riprova tra qualche istante.');
      }
    } catch {
      alert('Errore di rete. Riprova tra qualche istante.');
    }
  };

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 bg-[#111B21]/95 backdrop-blur-md border-b border-[#2A3942] h-12${layerOpen ? ' invisible' : ''}`}
      aria-hidden={layerOpen || undefined}
      data-testid="dashboard-nav"
    >
      <div className="max-w-4xl mx-auto h-full flex items-center justify-between gap-2 px-3 sm:px-4">
        <div className="flex items-center gap-1.5 min-w-0">
          <Logo size={22} />
          <span
            className={`text-sm font-bold tracking-tight text-white truncate ${
              isPaying ? 'hidden sm:inline' : 'inline'
            }`}
          >
            WhatsLater
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <InstallAppButton />
          {isPaying && (
            <button
              onClick={handlePortal}
              aria-label="Gestisci abbonamento"
              className="flex items-center justify-center w-11 h-11 sm:w-auto sm:h-10 sm:px-3 sm:gap-1 text-gray-400 hover:text-gray-200 rounded-lg transition-colors shrink-0"
            >
              <CreditCard className="w-4 h-4" />
              <span className="hidden sm:inline text-sm">Abbonamento</span>
            </button>
          )}
          {userPhone ? (
            <button
              onClick={onLogout}
              aria-label="Disconnetti"
              className="flex items-center justify-center w-11 h-11 sm:w-auto sm:h-10 sm:px-3 sm:gap-1 text-gray-400 hover:text-gray-200 rounded-lg transition-colors shrink-0"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline text-sm">Disconnetti</span>
            </button>
          ) : (
            <a href="/" className="text-sm text-gray-400 hover:text-primary transition-colors">Home</a>
          )}
        </div>
      </div>
    </nav>
  );
}

// --- Messages Section (V4 dense layout — LEGACY, kept for rollback) ---
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function MessagesSectionLegacyV4({ messages, onDelete, formatScheduled, statusConfig }: {
  messages: ScheduledMessage[];
  onDelete: (id: string) => void;
  formatScheduled: (d: string) => { date: string; time: string };
  statusConfig: Record<string, { color: string; label: string }>;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-xl font-bold tracking-tight text-white">Prossimi messaggi</h2>
        <span className="text-xs text-gray-400">
          {messages.length} programmat{messages.length === 1 ? 'o' : 'i'}
        </span>
      </div>
      <div className="bg-[#202C33] rounded-2xl border border-[#2A3942] divide-y divide-[#2A3942] overflow-hidden">
        {messages.map((msg) => {
          const sched = formatScheduled(msg.scheduled_at);
          const status = statusConfig[msg.status] || { color: '#9CA3AF', label: msg.status };
          const cancellable = msg.status === 'pending' || msg.status.startsWith('awaiting_');
          const displayName = msg.recipient_name || `+${msg.recipient_number || '?'}`;
          return (
            <div
              key={msg.id}
              className="flex items-start gap-3 p-4 hover:bg-[#2A3942]/50 transition-colors"
            >
              <ContactAvatar
                name={msg.recipient_name}
                number={msg.recipient_number || ''}
                size="md"
                photoSrc={msg.photo_url || undefined}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-semibold text-sm truncate text-white">
                    {displayName}
                  </p>
                  <div className="flex items-center gap-1.5 shrink-0 text-xs text-gray-400 font-medium">
                    <span>{sched.date} {sched.time}</span>
                    <DeliveryStatusIcon msg={msg} />
                    <span
                      className="w-2.5 h-2.5 rounded-full ring-2 ring-[#202C33]"
                      style={{ backgroundColor: status.color }}
                      aria-label={status.label}
                      title={status.label}
                    />
                  </div>
                </div>
                <p className="text-sm text-gray-400 mt-1 line-clamp-2">
                  {msg.parsed_message || ''}
                </p>
              </div>
              {cancellable && (
                <button
                  onClick={() => { if (confirm('Vuoi annullare questo invio?')) onDelete(msg.id) }}
                  className="text-gray-500 hover:text-red-400 shrink-0 transition-colors p-2 -m-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center"
                  title="Annulla invio"
                  aria-label="Annulla invio"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Share Toast (after first scheduled message) ---
function ShareToast({ onClose }: { onClose: () => void }) {
  const shareUrl = 'https://wa.me/?text=Programmo%20i%20miei%20messaggi%20con%20WhatsLater%20%F0%9F%9A%80%20whatslater.it';
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] sm:w-auto sm:max-w-md bg-[#202C33] rounded-2xl shadow-2xl border border-[#2A3942] p-4">
      <button
        onClick={onClose}
        className="absolute top-2 right-3 text-gray-400 hover:text-gray-200 text-xl leading-none"
        aria-label="Chiudi"
      >
        &times;
      </button>
      <p className="text-sm font-bold text-green-400 mb-1 pr-6">Primo messaggio programmato!</p>
      <p className="text-xs text-gray-400 mb-3">Fai sapere ai tuoi contatti come ti organizzi.</p>
      <a
        href={shareUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 bg-[#25D366] text-[#0B141A] px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#1ebe5b] transition-colors"
      >
        Condividi su WhatsApp
      </a>
    </div>
  );
}

// =====================================================================
// LEGACY components — kept (unmounted) for easy V4 regression rollback.
// Do NOT remove without explicit approval; restoring them is a 1-line
// JSX edit if the V4 layout needs to be reverted.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ConnectedCard({ userPhone }: { userPhone: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
          <CheckCircle2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="font-bold">WhatsApp Connesso</h3>
          {userPhone && <p className="text-sm text-text-secondary">+{userPhone}</p>}
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function PlanBadge({ subscription }: { subscription: SubscriptionState }) {
  const planLabels: Record<string, string> = {
    trial: 'Trial',
    free: 'Free',
    personal: 'Personal',
    professional: 'Professional',
    business: 'Business',
  };
  const planColors: Record<string, string> = {
    trial: 'bg-blue-100 text-blue-700 border-blue-200',
    free: 'bg-gray-100 text-gray-600 border-gray-200',
    personal: 'bg-green-100 text-green-700 border-green-200',
    professional: 'bg-teal-100 text-teal-700 border-teal-200',
    business: 'bg-purple-100 text-purple-700 border-purple-200',
  };

  const label = planLabels[subscription.plan] || subscription.plan;
  const color = planColors[subscription.plan] || planColors.free;

  let trialInfo = '';
  if (subscription.plan === 'trial' && subscription.trial_ends_at) {
    const daysLeft = Math.max(0, Math.ceil((new Date(subscription.trial_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    trialInfo = daysLeft > 0 ? `${daysLeft} giorni rimanenti` : 'Scaduto';
  }

  return (
    <div className={`flex items-center justify-between rounded-xl px-4 py-3 border ${color}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Piano: {label}</span>
        {trialInfo && <span className="text-xs opacity-75">({trialInfo})</span>}
      </div>
      {(subscription.plan === 'trial' || subscription.plan === 'free') && (
        <a href="#prezzi" className="text-xs font-medium hover:underline">Passa a Personal</a>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function DailyCapBadge({ plan, messages }: { plan: string; messages: ScheduledMessage[] }) {
  const limits = getPlanLimits(plan);
  const today = new Date();
  const sameDay = (d: Date) =>
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();

  const countToday = messages.filter((m) => {
    if (m.status !== 'sent' && m.status !== 'pending') return false;
    const sched = new Date(m.scheduled_at);
    return !isNaN(sched.getTime()) && sameDay(sched);
  }).length;

  const UPGRADE_PATH: Record<string, string> = {
    free: 'personal',
    personal: 'professional',
    professional: 'business',
  };
  const upgradeTarget = UPGRADE_PATH[plan] || 'business';
  const planLabel = getPlanName(plan);
  const nextPlan = getPlanName(upgradeTarget);
  const nextLimit = getPlanLimits(upgradeTarget).dailyLimit;

  return (
    <div className="flex items-center justify-between rounded-xl px-4 py-3 border border-gray-200 bg-white">
      <p className="text-sm text-text-primary">
        Oggi {countToday === 1 ? 'parte' : 'partono'} <strong>{countToday}</strong> messagg{countToday === 1 ? 'io' : 'i'}
        <span className="text-text-secondary"> — Limite {planLabel}: {limits.dailyLimit}/giorno</span>
      </p>
      <a href="#prezzi" className="text-xs font-semibold text-primary hover:underline shrink-0 ml-3">
        Sblocca {nextLimit} con {nextPlan} →
      </a>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getWelcomeCopy(segment: Segment): string {
  switch (segment) {
    case 'D':
    case 'B':
    case 'C':
    default:
      return 'Benvenuto! Tocca Programma per programmare il tuo primo messaggio.';
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function WelcomeCard({ segment }: { segment: Segment }) {
  return (
    <div className="rounded-2xl border border-green-200 bg-green-50 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-[#25D366] flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-5 h-5 text-[#0B141A]" />
        </div>
        <p className="text-sm text-[#075E54] font-medium leading-snug">
          {getWelcomeCopy(segment)}
        </p>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function HowToUseBox() {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h3 className="font-bold mb-4">Come usare WhatsLater</h3>
      <ol className="space-y-3 text-sm">
        <li className="flex gap-3">
          <span className="bg-primary/10 text-primary w-6 h-6 rounded-full flex items-center justify-center font-bold shrink-0 text-xs">1</span>
          <span>Tocca <strong>Programma</strong></span>
        </li>
        <li className="flex gap-3">
          <span className="bg-primary/10 text-primary w-6 h-6 rounded-full flex items-center justify-center font-bold shrink-0 text-xs">2</span>
          <span>Cerca il contatto o aggiungine uno nuovo con nome e numero</span>
        </li>
        <li className="flex gap-3">
          <span className="bg-primary/10 text-primary w-6 h-6 rounded-full flex items-center justify-center font-bold shrink-0 text-xs">3</span>
          <span>Scegli data e ora — il messaggio parte dal tuo numero in automatico</span>
        </li>
      </ol>
    </div>
  );
}
