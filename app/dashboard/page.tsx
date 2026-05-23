'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Calendar, CheckCircle2, Loader2, LogOut, Send, X,
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import ContactPickerModal from '@/components/ContactPickerModal';
import ScheduleModal from '@/components/ScheduleModal';
import { ContactAvatar } from '@/components/ContactAvatar';
import PricingSection from '../components/PricingSection';
import FAQSection from '../components/FAQSection';
import Footer from '../components/Footer';
import MessagesSection, { type ScheduledMessage as MessagesSectionMessage } from '../components/MessagesSection';
import { getPlanLimits, getPlanName } from '../lib/plans';

const supabaseClient = typeof window !== 'undefined' ? createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
) : null;

interface SubscriptionState {
  plan: string;
  trial_ends_at: string | null;
  expired: boolean;
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
}

type Segment = 'D' | 'B' | 'C' | null;

export default function DashboardPage() {
  const [instanceName, setInstanceName] = useState('');
  const [userPhone, setUserPhone]       = useState('');
  const [messages, setMessages]         = useState<ScheduledMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionState>({ plan: 'unknown', trial_ends_at: null, expired: false });
  const [sessionValidated, setSessionValidated] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<{ number: string; name?: string } | null>(null);
  const [showShareToast, setShowShareToast] = useState(false);
  // Toast for inline feedback after duplicate/pause/delete actions. Auto-dismisses in 5s.
  const [toast, setToast] = useState<{ text: string; undo?: () => void; id: number } | null>(null);
  // Carry an initial message text into ScheduleModal when duplicating.
  const [prefillText, setPrefillText] = useState<string>('');

  const msgTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevLifetimeRef = useRef<number | null>(null);

  // --- Cookie-based auth check on mount ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (cancelled) return;
        if (res.status === 401 || !res.ok) {
          window.location.href = '/connect';
          return;
        }
        const data = await res.json();
        setUserPhone(data.phone);
        setInstanceName(data.instanceName);
        setSessionValidated(true);
      } catch {
        if (!cancelled) window.location.href = '/connect';
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch('/api/messages');
      if (res.status === 403) {
        const err = await res.json();
        setSubscription({ plan: err.subscription_plan || 'expired', trial_ends_at: err.trial_ends_at, expired: true });
        setMessages([]);
        return;
      }
      if (res.ok) {
        const d = await res.json();
        if (d.messages) {
          setMessages(Array.isArray(d.messages) ? d.messages : []);
          setSubscription({ plan: d.subscription_plan || 'free', trial_ends_at: d.trial_ends_at, expired: false });
          if (typeof d.total_scheduled_lifetime === 'number') {
            const next = d.total_scheduled_lifetime;
            if (prevLifetimeRef.current === 0 && next === 1) {
              setShowShareToast(true);
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

  // Supabase Realtime — listen for connection status changes
  useEffect(() => {
    if (!supabaseClient || !instanceName) return;
    const channel = supabaseClient
      .channel('conn-status-' + instanceName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_instances',
          filter: `instance_name=eq.${instanceName}`
        },
        () => {
          fetchMessages();
        }
      )
      .subscribe();

    return () => { supabaseClient.removeChannel(channel); };
  }, [instanceName, fetchMessages]);

  const handleLogout = async () => {
    if (msgTimer.current) clearInterval(msgTimer.current);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    window.location.href = '/';
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch('/api/messages', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      fetchMessages();
    } catch {
      // ignore
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

  // Duplicate — opens ScheduleModal pre-filled with the same contact and text.
  // Skips the contact picker step entirely. The user just confirms date/time.
  const handleDuplicate = useCallback((msg: MessagesSectionMessage) => {
    setSelectedContact({
      number: msg.recipient_number || '',
      name: msg.recipient_name,
    });
    setPrefillText(msg.parsed_message || msg.caption || '');
    setScheduleOpen(true);
  }, []);

  // Edit — same flow as duplicate for now; backend doesn't have an update
  // endpoint yet, so for an MVP we duplicate-then-delete-original.
  // TODO(backend): add PATCH /api/messages for true edit-in-place.
  const handleEdit = useCallback((msg: MessagesSectionMessage) => {
    handleDuplicate(msg);
    showToast('Modifica come duplicato — l’originale resta finché non lo elimini.');
  }, [handleDuplicate, showToast]);

  // Pause/resume — optimistic; backend ignores unknown statuses silently for now.
  const handlePauseToggle = useCallback(async (msg: MessagesSectionMessage) => {
    const newStatus = msg.status === 'paused' ? 'pending' : 'paused';
    // Optimistic
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, status: newStatus } : m)));
    showToast(newStatus === 'paused' ? 'Messaggio in pausa' : 'Messaggio riattivato');
    try {
      await fetch('/api/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: msg.id, status: newStatus }),
      });
      fetchMessages();
    } catch {
      // Roll back on network error
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, status: msg.status } : m)));
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

  if (!sessionValidated) {
    return (
      <div className="min-h-screen bg-[#111B21] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111B21] text-white font-sans pb-32">
      <DashboardNavbar userPhone={userPhone} plan={subscription.plan} onLogout={handleLogout} />

      {/* Status strip — fuses connected + plan + daily counter + contextual upgrade */}
      <StatusStrip
        userPhone={userPhone}
        subscription={subscription}
        messages={messages}
      />

      <main className="px-4 max-w-4xl mx-auto pt-6 pb-12 space-y-8">
        {userPhone && (
          subscription.expired ? (
            <div className="bg-[#202C33] border border-red-500/40 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-red-400">Trial Scaduto</p>
                <p className="text-sm text-gray-400">Abbonati per continuare.</p>
              </div>
              <a href="#prezzi" className="px-4 py-2 bg-primary text-white rounded-xl font-medium text-sm">Abbonati</a>
            </div>
          ) : messagesLoading ? (
            <div className="bg-[#202C33] rounded-2xl border border-[#2A3942] p-12 text-center">
              <Loader2 className="w-6 h-6 text-primary animate-spin mx-auto mb-2" />
              <p className="text-gray-500">Caricamento...</p>
            </div>
          ) : messages.length === 0 ? (
            <EmptyState />
          ) : (
            <MessagesSection
              messages={messages}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onEdit={handleEdit}
              onPauseToggle={handlePauseToggle}
              onShowToast={showToast}
            />
          )
        )}

        {/* Pricing visible only to free/trial (and expired so the "Abbonati"
            anchor in the expired banner still resolves). Paying users manage
            their subscription via the navbar link, no need to show plans. */}
        {showPricing && (
          <PricingSection currentPlan={subscription.plan} userPhone={userPhone} theme="dark" />
        )}

        <ContactPickerModal
          open={contactPickerOpen}
          onClose={() => setContactPickerOpen(false)}
          onSelect={(contact) => {
            setSelectedContact(contact);
            setContactPickerOpen(false);
            setScheduleOpen(true);
          }}
        />

        <ScheduleModal
          open={scheduleOpen}
          onClose={() => { setScheduleOpen(false); setSelectedContact(null); setPrefillText(''); }}
          onBack={() => { setScheduleOpen(false); setContactPickerOpen(true); setPrefillText(''); }}
          contact={selectedContact}
          onScheduled={fetchMessages}
          initialMessage={prefillText}
        />

        {showShareToast && (
          <ShareToast onClose={() => setShowShareToast(false)} />
        )}
      </main>

      {/* FAB — mobile round, desktop pill. Wrapped to host the attention ripple. */}
      <div className="sm:hidden fixed bottom-6 right-6 z-30">
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-primary wa-ping pointer-events-none"
        ></span>
        <button
          onClick={() => setContactPickerOpen(true)}
          className="relative w-14 h-14 bg-primary text-white rounded-full shadow-2xl flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
          aria-label="Manda messaggio"
        >
          <Send className="w-6 h-6 -ml-0.5" fill="currentColor" />
        </button>
      </div>

      <div className="hidden sm:block fixed bottom-6 right-6 z-30">
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-primary wa-ping pointer-events-none"
        ></span>
        <button
          onClick={() => setContactPickerOpen(true)}
          className="relative bg-primary text-white rounded-full shadow-2xl px-6 py-4 flex items-center gap-2 font-semibold hover:scale-105 active:scale-95 transition-transform"
        >
          <Send className="w-5 h-5 -ml-0.5" fill="currentColor" />
          Manda messaggio
        </button>
      </div>

      {showFAQ && <FAQSection theme="dark" />}
      <Footer theme="dark" />

      {/* Action toast — surfaces feedback from MessagesSection (duplicate/pause/delete). */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] sm:w-auto sm:max-w-md">
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

// --- Status Strip (fuses ConnectedCard + PlanBadge + DailyCapBadge + contextual upgrade) ---
function StatusStrip({ userPhone, subscription, messages }: {
  userPhone: string;
  subscription: SubscriptionState;
  messages: ScheduledMessage[];
}) {
  const planKnown = subscription.plan !== 'unknown';
  const planLabel = getPlanName(subscription.plan);
  const limits = getPlanLimits(subscription.plan);
  const showCounter = planKnown && (subscription.plan === 'free' || subscription.plan === 'personal' || subscription.plan === 'professional');

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

  // Context-aware upgrade copy
  const upgradeCopy = ((): string | null => {
    if (!planKnown) return null;
    switch (subscription.plan) {
      case 'free':
        return 'Sblocca 20 msg/giorno con Personal €4.99 →';
      case 'trial':
        return `Trial scade tra ${trialDays}gg — continua con Personal €4.99 →`;
      case 'personal':
        return 'Passa a Professional per 35 msg/giorno →';
      case 'professional':
        return 'Passa a Business per 50 msg + contatti illimitati →';
      default:
        return null;
    }
  })();

  return (
    <div className="max-w-4xl mx-auto px-4 pt-20 pb-3 border-b border-[#2A3942] text-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between sm:flex-wrap gap-1 sm:gap-2">
        {/* Riga 1 mobile / parte sinistra desktop: stato + piano */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Connected pill — neutral background, small primary dot for the
              "alive" signal. Reserves green-saturated treatment for FAB only. */}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#202C33] border border-[#2A3942] text-xs text-gray-400">
            <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_0_3px_rgba(37,211,102,0.18)]" aria-hidden></span>
            Connesso
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
        {(showCounter || upgradeCopy) && (
          <div className="flex items-center justify-between gap-2 flex-wrap sm:justify-end sm:gap-3">
            {showCounter && (
              <span className="text-white font-medium">
                Hai schedulato {countToday} messagg{countToday === 1 ? 'io' : 'i'} oggi ✓
                <span className="text-gray-500 text-xs ml-1">(limite {limits.dailyLimit})</span>
              </span>
            )}
            {upgradeCopy && (
              <a
                href="#prezzi"
                // Trial/upgrade banner = warning ("action needed soon") → AMBER,
                // not green. Keeps the dashboard's single-green-element rule.
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

// --- Empty State (replaces WelcomeCard + "0 messages" placeholder) ---
function EmptyState() {
  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
        <Calendar className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-bold mb-2 text-white">
        Nessun messaggio programmato
      </h2>
      <p className="text-gray-400 max-w-md mx-auto">
        Programma il prossimo messaggio per la tua squadra o i tuoi clienti. Tocca il bottone in basso a destra per iniziare.
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
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#111B21]/95 backdrop-blur-md border-b border-[#2A3942] px-4 md:px-6 py-3">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-lg tracking-tight text-white">
          <Calendar className="w-5 h-5 text-primary" />
          <span>WhatsLater</span>
        </div>
        <div className="flex items-center gap-3">
          {isPaying && (
            <button
              onClick={handlePortal}
              className="text-xs font-medium text-primary hover:underline whitespace-nowrap"
            >
              Gestisci abbonamento
            </button>
          )}
          {userPhone ? (
            <button onClick={onLogout} className="flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium border border-[#2A3942] text-gray-300 hover:bg-[#2A3942] transition-colors">
              <LogOut className="w-4 h-4" /> Disconnetti
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
        className="inline-flex items-center gap-2 bg-[#25D366] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#1ebe5b] transition-colors"
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
        Hai schedulato <strong>{countToday}</strong> messagg{countToday === 1 ? 'io' : 'i'} oggi ✓
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
      return 'Benvenuto! Clicca Manda messaggio per programmare il tuo primo messaggio.';
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function WelcomeCard({ segment }: { segment: Segment }) {
  return (
    <div className="rounded-2xl border border-green-200 bg-green-50 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-[#25D366] flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-5 h-5 text-white" />
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
          <span>Clicca <strong>Manda messaggio</strong></span>
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
