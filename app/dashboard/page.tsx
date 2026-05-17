'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Calendar, CheckCircle2, Loader2, Smartphone, LogOut, Trash2, Plus
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { Button } from '@/components/Button';
import QuickCaptureModal from '@/components/QuickCaptureModal';
import ContactPickerModal from '@/components/ContactPickerModal';
import ScheduleModal from '@/components/ScheduleModal';
import { ContactAvatar } from '@/components/ContactAvatar';
import PricingSection from '../components/PricingSection';
import FAQSection from '../components/FAQSection';
import Footer from '../components/Footer';
import { getPlanLimits } from '../lib/plans';

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
}

type Segment = 'D' | 'B' | 'C' | null;

export default function DashboardPage() {
  const [instanceName, setInstanceName] = useState('');
  const [userPhone, setUserPhone]       = useState('');
  const [messages, setMessages]         = useState<ScheduledMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionState>({ plan: 'unknown', trial_ends_at: null, expired: false });
  const [totalLifetime, setTotalLifetime] = useState<number | null>(null);
  const [sessionValidated, setSessionValidated] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<{ number: string; name?: string } | null>(null);
  const [segment, setSegment] = useState<Segment>(null);
  const [showShareToast, setShowShareToast] = useState(false);

  const msgTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevLifetimeRef = useRef<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('seg');
    if (raw === 'D' || raw === 'B' || raw === 'C') setSegment(raw);
  }, []);

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
            setTotalLifetime(next);
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
          // Refresh messages on any instance update
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

  const statusConfig: Record<string, { color: string; label: string }> = {
    awaiting_confirm:  { color: '#EAB308', label: 'In attesa di conferma' },
    awaiting_contact:  { color: '#EAB308', label: 'In attesa del contatto' },
    awaiting_datetime: { color: '#EAB308', label: 'In attesa della data' },
    awaiting_message:  { color: '#EAB308', label: 'In attesa del messaggio' },
    pending:           { color: '#3B82F6', label: 'Programmato' },
    sending:           { color: '#3B82F6', label: 'In invio...' },
    sent:              { color: '#22C55E', label: 'Inviato' },
    failed:            { color: '#EF4444', label: 'Non inviato' },
    cancelled:         { color: '#9CA3AF', label: 'Annullato' },
  };

  function formatScheduled(scheduledAt: string): { date: string; time: string; urgent: boolean } {
    const target = new Date(scheduledAt);
    const now = new Date();
    const diffMs = target.getTime() - now.getTime();
    const diffMin = Math.round(diffMs / 60000);

    const hh = target.getHours().toString().padStart(2, '0');
    const mm = target.getMinutes().toString().padStart(2, '0');
    const time = `${hh}:${mm}`;

    if (diffMs < 0) return { date: 'scaduto', time, urgent: false };

    if (diffMin < 60) {
      return { date: `tra ${diffMin}min`, time, urgent: diffMin < 10 };
    }

    const sameDay = target.toDateString() === now.toDateString();
    if (sameDay) return { date: 'oggi', time, urgent: false };

    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    if (target.toDateString() === tomorrow.toDateString()) return { date: 'domani', time, urgent: false };

    const targetMidnight = new Date(target); targetMidnight.setHours(0, 0, 0, 0);
    const nowMidnight = new Date(now); nowMidnight.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((targetMidnight.getTime() - nowMidnight.getTime()) / 86400000);
    if (diffDays < 7) {
      const days = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
      return { date: days[target.getDay()], time, urgent: false };
    }

    const dd = target.getDate().toString().padStart(2, '0');
    const mo = (target.getMonth() + 1).toString().padStart(2, '0');
    return { date: `${dd}/${mo}`, time, urgent: false };
  }

  const showPricing = subscription.plan === 'trial' || subscription.plan === 'free' || subscription.expired;

  if (!sessionValidated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-text-primary font-sans">
      {/* Dashboard Navbar */}
      <DashboardNavbar userPhone={userPhone} onLogout={handleLogout} />

      <main className="pt-24 pb-12 px-4 max-w-4xl mx-auto space-y-8">
        {/* Connected status card */}
        <ConnectedCard userPhone={userPhone} />


        {/* Action buttons */}
        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => setContactPickerOpen(true)}
            className="w-full sm:w-auto"
          >
            ✉️ Manda messaggio
          </Button>
          <Button
            variant="outline"
            onClick={() => setQuickCaptureOpen(true)}
            className="w-full sm:w-auto"
          >
            <Plus className="w-5 h-5 mr-2" /> Nuovo follow-up
          </Button>
        </div>
        {/* Plan Badge */}
        {userPhone && subscription.plan !== 'unknown' && (
          <PlanBadge subscription={subscription} />
        )}

        {/* Welcome card — first access, no messages ever scheduled */}
        {sessionValidated && userPhone && totalLifetime === 0 && (
          <WelcomeCard segment={segment} />
        )}

        {/* Daily cap badge — only for free/personal */}
        {userPhone && (subscription.plan === 'free' || subscription.plan === 'personal') && (
          <DailyCapBadge plan={subscription.plan} messages={messages} />
        )}

        {/* Messages Section */}
        {userPhone && (
          <MessagesSection
            messages={messages}
            messagesLoading={messagesLoading}
            subscription={subscription}
            onDelete={handleDelete}
            formatScheduled={formatScheduled}
            statusConfig={statusConfig}
          />
        )}

        {/* How To Use Box — inline for new users, FAB for returning */}
        {(() => {
          const hasNoMessages = messages.length === 0;
          return hasNoMessages ? (
            <HowToUseBox />
          ) : (
            <>
              <button
                onClick={() => setShowHelp(!showHelp)}
                className="fixed bottom-4 right-4 w-12 h-12 rounded-full bg-primary text-white flex items-center justify-center shadow-lg text-lg font-bold z-30"
                aria-label="Aiuto"
              >
                ?
              </button>
              {showHelp && (
                <div className="fixed bottom-20 right-4 w-80 bg-white rounded-xl shadow-2xl p-4 z-30 text-sm text-text-primary">
                  <button onClick={() => setShowHelp(false)} className="absolute top-2 right-2 text-gray-400">&times;</button>
                  <p className="font-bold mb-2">Come funziona:</p>
                  <ol className="list-decimal list-inside space-y-1 text-text-secondary">
                    <li>Invia il contatto di un tuo cliente (📎 &rarr; Contatto)</li>
                    <li>Scrivi: &quot;Ricorda a [nome] l&apos;appuntamento di domani alle 15&quot;</li>
                  </ol>
                </div>
              )}
            </>
          );
        })()}

        {/* Pricing for trial/free users, or manage subscription for paying */}
        {(showPricing || subscription.plan === 'personal' || subscription.plan === 'business') && (
          <PricingSection currentPlan={subscription.plan} userPhone={userPhone} />
        )}

        {/* QuickCaptureModal */}
        <QuickCaptureModal
          open={quickCaptureOpen}
          onClose={() => setQuickCaptureOpen(false)}
          userPhone={userPhone}
        />

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
          onClose={() => { setScheduleOpen(false); setSelectedContact(null); }}
          onBack={() => { setScheduleOpen(false); setContactPickerOpen(true); }}
          contact={selectedContact}
          onScheduled={fetchMessages}
        />

        {showShareToast && (
          <ShareToast onClose={() => setShowShareToast(false)} />
        )}
      </main>

      <FAQSection />
      <Footer />
    </div>
  );
}

// --- Connected Status Card ---
function ConnectedCard({ userPhone }: { userPhone: string }) {
  const waUrl = `https://wa.me/${userPhone}`;
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold">WhatsApp Connesso</h3>
            {userPhone && <p className="text-sm text-text-secondary">+{userPhone}</p>}
          </div>
        </div>
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Smartphone className="w-4 h-4" />
          Apri WhatsApp
        </a>
      </div>
    </div>
  );
}

// --- Dashboard Navbar ---
function DashboardNavbar({ userPhone, onLogout }: {
  userPhone: string;
  onLogout: () => void;
}) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200 px-4 md:px-6 py-3">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-lg tracking-tight">
          <Calendar className="w-5 h-5 text-primary" />
          <span>WhatsLater</span>
        </div>
        <div className="flex items-center gap-3">
          {userPhone && (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              Connesso
            </span>
          )}
          {userPhone ? (
            <button onClick={onLogout} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-gray-200 hover:bg-gray-50 transition-colors">
              <LogOut className="w-3.5 h-3.5" /> Disconnetti
            </button>
          ) : (
            <a href="/" className="text-sm text-text-secondary hover:text-primary transition-colors">Home</a>
          )}
        </div>
      </div>
    </nav>
  );
}

// --- Messages Section ---
function MessagesSection({ messages, messagesLoading, subscription, onDelete, formatScheduled, statusConfig }: {
  messages: ScheduledMessage[];
  messagesLoading: boolean;
  subscription: SubscriptionState;
  onDelete: (id: string) => void;
  formatScheduled: (d: string) => { date: string; time: string; urgent: boolean };
  statusConfig: Record<string, { color: string; label: string }>;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-text-primary">Messaggi programmati</h2>
        <span className="text-sm text-text-secondary bg-white px-3 py-1 rounded-full border border-gray-100">
          {messages.length} messagg{messages.length !== 1 ? 'i' : 'io'}
        </span>
      </div>
      {subscription.expired && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4 flex items-center justify-between">
          <div><p className="font-semibold text-red-700">Trial Scaduto</p><p className="text-sm text-red-600">Abbonati per continuare.</p></div>
          <a href="#prezzi" className="px-4 py-2 bg-primary text-white rounded-xl font-medium text-sm">Abbonati</a>
        </div>
      )}
      {messagesLoading ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <Loader2 className="w-6 h-6 text-primary animate-spin mx-auto mb-2" />
          <p className="text-gray-400">Caricamento...</p>
        </div>
      ) : messages.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <p className="text-gray-500">Nessun messaggio programmato. Inizia con &quot;Nuovo contatto&quot;.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {messages.map((msg) => {
            const sched = formatScheduled(msg.scheduled_at);
            const status = statusConfig[msg.status] || { color: '#9CA3AF', label: msg.status };
            const cancellable = msg.status === 'pending' || msg.status.startsWith('awaiting_');
            return (
              <div key={msg.id} className="flex items-center gap-3 p-3 rounded-xl bg-white border border-gray-100 shadow-sm">
                <ContactAvatar name={msg.recipient_name} number={msg.recipient_number || ''} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-text-primary truncate">
                      {msg.recipient_name || `+${msg.recipient_number || '?'}`}
                    </div>
                    <div className={`text-xs shrink-0 ${sched.urgent ? 'text-red-500' : 'text-text-secondary'}`}>
                      {sched.date}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-text-secondary truncate">
                      {(msg.parsed_message || '').substring(0, 60)}
                    </div>
                    <div className="text-xs text-text-secondary flex items-center gap-1.5 shrink-0">
                      <span>{sched.time}</span>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.color }} />
                    </div>
                  </div>
                </div>
                {cancellable && (
                  <button
                    onClick={() => { if (confirm('Vuoi annullare questo invio?')) onDelete(msg.id) }}
                    className="p-2 text-gray-400 hover:text-red-400 transition-colors"
                    title="Annulla invio"
                    aria-label="Annulla invio"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Plan Badge ---
function PlanBadge({ subscription }: { subscription: SubscriptionState }) {
  const planLabels: Record<string, string> = {
    trial: 'Trial',
    free: 'Free',
    personal: 'Personal',
    business: 'Business',
  };
  const planColors: Record<string, string> = {
    trial: 'bg-blue-100 text-blue-700 border-blue-200',
    free: 'bg-gray-100 text-gray-600 border-gray-200',
    personal: 'bg-green-100 text-green-700 border-green-200',
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

// --- Share Toast (after first scheduled message) ---
function ShareToast({ onClose }: { onClose: () => void }) {
  const shareUrl = 'https://wa.me/?text=Programmo%20i%20miei%20messaggi%20con%20WhatsLater%20%F0%9F%9A%80%20whatslater.it';
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] sm:w-auto sm:max-w-md bg-white rounded-2xl shadow-2xl border border-green-200 p-4">
      <button
        onClick={onClose}
        className="absolute top-2 right-3 text-gray-400 hover:text-gray-600 text-xl leading-none"
        aria-label="Chiudi"
      >
        &times;
      </button>
      <p className="text-sm font-bold text-[#075E54] mb-1 pr-6">Primo messaggio programmato!</p>
      <p className="text-xs text-text-secondary mb-3">Fai sapere ai tuoi contatti come ti organizzi.</p>
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

// --- Daily Cap Badge ---
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

  const planLabel = plan === 'free' ? 'Free' : 'Personal';
  const nextPlan = plan === 'free' ? 'Personal' : 'Professional';
  const nextLimit = plan === 'free' ? 20 : 35;

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

// --- Welcome Card (first access, no messages scheduled yet) ---
function getWelcomeCopy(segment: Segment): string {
  switch (segment) {
    case 'D':
    case 'B':
    case 'C':
    default:
      return 'Benvenuto! Clicca Manda messaggio per programmare il tuo primo messaggio.';
  }
}

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

// --- How To Use Box ---
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
