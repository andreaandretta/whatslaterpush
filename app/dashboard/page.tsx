'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Calendar, CheckCircle2, Loader2, Smartphone, LogOut, Trash2, User
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { normalizeItalianPhone } from '../lib/phone';
import { cn } from '../lib/cn';
import PricingSection from '../components/PricingSection';
import FAQSection from '../components/FAQSection';
import Footer from '../components/Footer';

// --- Storage helpers ---
const supabaseClient = typeof window !== 'undefined' ? createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
) : null;

const PHONE_KEY = 'sw_phone';
const INST_KEY  = 'sw_instance';
const EXPIRY_KEY = 'sw_expiry';

const getStoredPhone    = () => (typeof window !== 'undefined' ? localStorage.getItem(PHONE_KEY) || '' : '');
const getStoredInstance = () => (typeof window !== 'undefined' ? localStorage.getItem(INST_KEY)  || '' : '');
const getStoredExpiry   = () => (typeof window !== 'undefined' ? localStorage.getItem(EXPIRY_KEY) || '' : '');
const savePhone    = (p: string) => { if (p) localStorage.setItem(PHONE_KEY, p); };
const saveInstance = (n: string) => { if (n) localStorage.setItem(INST_KEY, n); };
const saveExpiry   = () => { localStorage.setItem(EXPIRY_KEY, String(Date.now() + 30 * 24 * 3600 * 1000)); };
const clearPhone   = () => { localStorage.removeItem(PHONE_KEY); localStorage.removeItem(INST_KEY); localStorage.removeItem(EXPIRY_KEY); localStorage.removeItem('sw_onboarding_shown'); };

interface SubscriptionState {
  status: string;
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

export default function DashboardPage() {
  const [connStatus, setConnStatus]     = useState<'disconnected'|'connecting'|'connected'>('disconnected');
  const [qrCode, setQrCode]            = useState<string | null>(null);
  const [pairingCode, setPairingCode]   = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState(() => getStoredInstance() || '');
  const [isLoading, setIsLoading]       = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [userPhone, setUserPhone]       = useState('');
  const [messages, setMessages]         = useState<ScheduledMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionState>({ status: 'unknown', trial_ends_at: null, expired: false });
  const [sessionValidated, setSessionValidated] = useState(false);

  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgTimer     = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Session validation on mount ---
  useEffect(() => {
    const validateSession = async () => {
      const storedPhone = getStoredPhone();
      const storedInst  = getStoredInstance();
      const expiry = getStoredExpiry();
      if (expiry && Date.now() > parseInt(expiry)) {
        clearPhone();
        setSessionValidated(true);
        return;
      }
      if (!storedPhone || !storedInst) {
        setSessionValidated(true);
        return;
      }

      // Try up to 2 times with a delay to handle transient states
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch('/api/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'status', instanceName: storedInst }),
          });
          const r = await res.json();

          if (r.status === 'open') {
            if (r.owner && normalizeItalianPhone(r.owner) !== normalizeItalianPhone(storedPhone)) {
              clearPhone();
              setSessionValidated(true);
              return;
            }
            setUserPhone(normalizeItalianPhone(storedPhone));
            setInstanceName(storedInst);
            setConnStatus('connected');
            saveExpiry();
            fetchMessagesForPhone(storedPhone);
            setSessionValidated(true);
            return;
          }

          if (r.status === 'not_found') {
            // Instance doesn't exist at all — clear session
            clearPhone();
            setSessionValidated(true);
            return;
          }

          // Transient states: 'close', 'connecting', etc.
          // On first attempt, wait and retry before giving up
          if (attempt === 0) {
            console.log('[dashboard] status=' + r.status + ', retrying in 3s...');
            await new Promise(resolve => setTimeout(resolve, 3000));
            continue;
          }

          // After retry, if still 'close' — keep session but show disconnected
          // User can reconnect without losing their phone/instance data
          if (r.status === 'close') {
            setUserPhone(normalizeItalianPhone(storedPhone));
            setInstanceName(storedInst);
            setConnStatus('disconnected');
          } else {
            // 'connecting' or other transient — show as connecting
            setUserPhone(normalizeItalianPhone(storedPhone));
            setInstanceName(storedInst);
            setConnStatus('disconnected');
          }
        } catch {
          // On network error, keep session data — don't logout
          if (attempt === 1) {
            setUserPhone(normalizeItalianPhone(storedPhone));
            setInstanceName(storedInst);
            setConnStatus('disconnected');
          }
        }
      }
      setSessionValidated(true);
    };
    validateSession();
  }, []);

  const fetchMessagesForPhone = useCallback(async (phone?: string) => {
    const ph = phone || userPhone || getStoredPhone();
    if (!ph) { setMessagesLoading(false); return; }
    try {
      const res = await fetch('/api/messages?phone=' + encodeURIComponent(ph));
      if (res.status === 403) {
        const err = await res.json();
        setSubscription({ status: err.subscription_status || 'expired', trial_ends_at: err.trial_ends_at, expired: true });
        setMessages([]);
        return;
      }
      if (res.ok) {
        const d = await res.json();
        if (d.messages) {
          setMessages(Array.isArray(d.messages) ? d.messages : []);
          setSubscription({ status: d.subscription_status || 'unknown', trial_ends_at: d.trial_ends_at, expired: false });
        } else setMessages(Array.isArray(d) ? d : []);
      }
    } catch {
      // ignore
    } finally {
      setMessagesLoading(false);
    }
  }, [userPhone]);

  useEffect(() => {
    if (connStatus === 'connected' && userPhone) {
      fetchMessagesForPhone(userPhone);
      if (msgTimer.current) clearInterval(msgTimer.current);
      msgTimer.current = setInterval(() => fetchMessagesForPhone(userPhone), 30000);
    }
    return () => { if (msgTimer.current) clearInterval(msgTimer.current); };
  }, [connStatus, userPhone, fetchMessagesForPhone]);

  // Supabase Realtime
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
        (payload: { new?: { connection_status?: string } }) => {
          const newStatus = payload.new?.connection_status;
          if (newStatus === 'open' && connStatus !== 'connected') {
            setConnStatus('connected');
            setQrCode(null);
            setPairingCode(null);
            if (refreshTimer.current) { clearInterval(refreshTimer.current); refreshTimer.current = null; }
            const phoneToUse = userPhone || getStoredPhone();
            if (phoneToUse) {
              setUserPhone(normalizeItalianPhone(phoneToUse));
              fetchMessagesForPhone(phoneToUse);
            }
          } else if (newStatus === 'close' && connStatus !== 'disconnected') {
            setConnStatus('disconnected');
          }
        }
      )
      .subscribe();

    return () => { supabaseClient.removeChannel(channel); };
  }, [instanceName, connStatus, userPhone, fetchMessagesForPhone]);

  const handleConnect = async (rawPhone: string) => {
    setIsLoading(true);
    setError(null);
    setQrCode(null);
    setPairingCode(null);
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getCodeAndPairing', phone: rawPhone }),
      });
      const r = await res.json();
      if (r.error) { setError(r.error); setIsLoading(false); return; }
      if (r.instanceName) { setInstanceName(r.instanceName); saveInstance(r.instanceName); }
      if (r.qrCode) { setQrCode(r.qrCode.startsWith('data:') ? r.qrCode : 'data:image/png;base64,' + r.qrCode); }
      if (r.pairingCode) setPairingCode(r.pairingCode);
      setConnStatus('connecting');

      if (refreshTimer.current) clearInterval(refreshTimer.current);
      const instName = r.instanceName;
      const pollStart = Date.now();
      refreshTimer.current = setInterval(async () => {
        // Timeout after 35 seconds
        if (Date.now() - pollStart > 35000) {
          clearInterval(refreshTimer.current!);
          setConnStatus('disconnected');
          setQrCode(null);
          setPairingCode(null);
          setError('Connessione scaduta. Riprova inserendo di nuovo il codice su WhatsApp → Impostazioni → Dispositivi collegati → Collega dispositivo');
          return;
        }
        try {
          const sr = await fetch('/api/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'status', instanceName: instName }),
          });
          const s = await sr.json();
          if (s.status === 'open') {
            clearInterval(refreshTimer.current!);
            saveExpiry();
            setConnStatus('connected');
            setQrCode(null);
            setPairingCode(null);
            const phone = normalizeItalianPhone(s.owner || rawPhone.replace(/\D/g, ''));
            savePhone(phone);
            setUserPhone(normalizeItalianPhone(phone));
            await fetch('/api/connect', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'setWebhook', instanceName: instName }),
            });
            fetchMessagesForPhone(phone);
          }
        } catch {
          // ignore poll errors
        }
      }, 3000);
    } catch {
      setError('Errore di connessione. Riprova.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (msgTimer.current) clearInterval(msgTimer.current);
    const inst = getStoredInstance() || instanceName;
    if (inst) {
      try {
        await fetch('/api/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'disconnect', instanceName: inst }),
        });
      } catch {
        // ignore
      }
    }
    clearPhone();
    setUserPhone('');
    setMessages([]);
    setConnStatus('disconnected');
    setQrCode(null);
    setPairingCode(null);
    setInstanceName('');
    setSubscription({ status: 'unknown', trial_ends_at: null, expired: false });
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch('/api/messages', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, phone: userPhone }),
      });
      fetchMessagesForPhone();
    } catch {
      // ignore
    }
  };

  const fmt = (d: string) => {
    try { return new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }); }
    catch { return d; }
  };

  const statusColors: Record<string, string> = {
    pending:   'bg-yellow-100 text-yellow-800',
    sent:      'bg-green-100 text-green-800',
    failed:    'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-600',
  };

  const trunc = (s: string, n: number) => (!s ? '' : s.length > n ? s.substring(0, n) + '...' : s);

  const showPricing = subscription.status === 'trial' || subscription.expired;

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
      <DashboardNavbar connStatus={connStatus} userPhone={userPhone} onLogout={handleLogout} />

      <main className="pt-24 pb-12 px-4 max-w-4xl mx-auto space-y-8">
        {/* Connection Zone */}
        <ConnectionZone
          connStatus={connStatus}
          qrCode={qrCode}
          pairingCode={pairingCode}
          isLoading={isLoading}
          error={error}
          userPhone={userPhone}
          onConnect={handleConnect}
          onDisconnect={handleLogout}
        />

        {/* Messages Section - only when connected */}
        {connStatus === 'connected' && userPhone && (
          <MessagesSection
            messages={messages}
            messagesLoading={messagesLoading}
            subscription={subscription}
            onDelete={handleDelete}
            fmt={fmt}
            statusColors={statusColors}
            trunc={trunc}
          />
        )}

        {/* How To Use Box - only when connected */}
        {connStatus === 'connected' && (
          <HowToUseBox />
        )}

        {/* Pricing for trial users */}
        {showPricing && <PricingSection />}
      </main>

      <FAQSection />
      <Footer />
    </div>
  );
}

// --- Dashboard Navbar ---
function DashboardNavbar({ connStatus, userPhone, onLogout }: {
  connStatus: string;
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
          {connStatus === 'connected' && (
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

// --- Connection Zone ---
function ConnectionZone({ connStatus, qrCode, pairingCode, isLoading, error, userPhone, onConnect, onDisconnect }: {
  connStatus: string;
  qrCode: string | null;
  pairingCode: string | null;
  isLoading: boolean;
  error: string | null;
  userPhone: string;
  onConnect: (phone: string) => void;
  onDisconnect: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const prevConnStatusRef = useRef<string>('disconnected');

  useEffect(() => {
    // Show onboarding only on FIRST ever connection (not on page refresh)
    const alreadyShown = typeof window !== 'undefined' && localStorage.getItem('sw_onboarding_shown');
    if (connStatus === 'connected' && prevConnStatusRef.current === 'connecting' && !alreadyShown) {
      setShowOnboarding(true);
      localStorage.setItem('sw_onboarding_shown', '1');
    }
    prevConnStatusRef.current = connStatus;
  }, [connStatus]);

  const handleCopy = () => {
    if (pairingCode) {
      navigator.clipboard.writeText(pairingCode).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let clean = phone.replace(/\D/g, '');
    if (clean.startsWith('0039')) clean = clean.substring(4);
    else if (clean.startsWith('39') && clean.length > 12) clean = clean.substring(2);
    if (clean.length < 10) {
      setPhoneError('Inserisci il tuo numero di telefono (es: 3401234567)');
      return;
    }
    setPhoneError('');
    onConnect(clean);
  };

  // Connected state
  if (connStatus === 'connected') {
    const waUrl = `https://wa.me/+${userPhone}`;
    return (
      <>
        {showOnboarding && (
          <div className="fixed inset-x-0 top-16 bottom-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-2xl font-bold mb-3">Sei connesso!</h2>
              <p className="text-text-secondary text-sm leading-relaxed mb-6">
                Invia messaggi programmati direttamente da WhatsApp.<br />
                Manda la vCard del destinatario, poi scrivi:<br />
                <span className="font-mono font-medium text-text-primary">Invia a [Nome] domani alle 15: Il tuo messaggio</span>
              </p>
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-primary text-white py-3 rounded-xl font-semibold hover:scale-[1.02] transition-transform shadow-lg shadow-primary/30 mb-3 text-center block"
              >
                Inizia a messaggiare
              </a>
              <button
                onClick={() => setShowOnboarding(false)}
                className="w-full py-3 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 transition-colors"
              >
                Chiudi
              </button>
            </div>
          </div>
        )}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-bold">WhatsApp Connesso</h3>
              {userPhone && <p className="text-sm text-text-secondary">+{userPhone}</p>}
            </div>
          </div>
        </div>
      </>
    );
  }

  // Disconnected / connecting state
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-6 md:p-8">
        <h2 className="text-2xl font-bold text-text-primary mb-2 text-center">Connetti WhatsApp</h2>
        <p className="text-text-secondary text-sm text-center mb-6">
          Inserisci il tuo numero per generare il codice di collegamento
        </p>

        <form onSubmit={handleSubmit} className="max-w-sm mx-auto flex flex-col gap-4 mb-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Il tuo numero di telefono
            </label>
            <input
              type="tel"
              placeholder="Es: 3401234567"
              className="w-full bg-background border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow text-base"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setPhoneError(''); }}
              disabled={connStatus === 'connecting'}
            />
            <p className="text-xs text-gray-500 mt-1">Inserisci il tuo numero di telefono</p>
          </div>
          {(phoneError || error) && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <p className="text-sm text-red-600">{phoneError || error}</p>
              {error?.includes('scaduta') && (
                <button
                  onClick={() => { if (phone) onConnect(phone); }}
                  className="mt-3 bg-primary text-white px-5 py-2 rounded-xl font-semibold text-sm hover:bg-primary/90 transition-colors"
                >
                  Riprova
                </button>
              )}
            </div>
          )}
          {connStatus !== 'connecting' && (
            <button
              type="submit"
              disabled={isLoading || !phone}
              className={cn(
                "bg-primary text-white px-6 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all",
                (isLoading || !phone) && "opacity-60 cursor-not-allowed"
              )}
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Smartphone className="w-5 h-5" />}
              {isLoading ? 'Connessione in corso...' : 'Collega WhatsApp'}
            </button>
          )}
        </form>

        {/* QR + Pairing Code */}
        {(qrCode || pairingCode) && (
          <div className="flex flex-col items-center gap-6">
            {qrCode && (
              <div className="flex flex-col items-center gap-3">
                <p className="text-sm font-semibold text-gray-700">QR Code generato</p>
                <p className="text-xs text-gray-500">Scansiona con WhatsApp &rarr; Dispositivi collegati</p>
                <div className="w-56 h-56 bg-white border-4 border-primary/20 rounded-3xl p-3 shadow-lg relative flex items-center justify-center overflow-hidden">
                  <img src={qrCode} alt="QR Code" className="w-full h-full object-contain relative z-10" />
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/10 to-transparent h-1/2 animate-[scan_2s_ease-in-out_infinite] z-20 pointer-events-none"></div>
                </div>
              </div>
            )}

            {qrCode && pairingCode && (
              <div className="flex items-center gap-4 w-full max-w-sm">
                <div className="flex-1 h-px bg-gray-200"></div>
                <span className="text-xs text-gray-400 font-medium">OPPURE</span>
                <div className="flex-1 h-px bg-gray-200"></div>
              </div>
            )}

            {pairingCode && (
              <div className="flex flex-col items-center gap-3 w-full max-w-sm">
                <p className="text-sm font-semibold text-gray-700">Oppure inserisci questo codice su WhatsApp</p>
                <div className="text-4xl md:text-5xl font-mono font-bold tracking-widest text-text-primary bg-background py-5 px-8 rounded-3xl border border-gray-200 shadow-inner w-full text-center">
                  {pairingCode.length >= 8 ? pairingCode.slice(0, 4) + '-' + pairingCode.slice(4, 8) : pairingCode}
                </div>
                <button
                  onClick={handleCopy}
                  className="mt-2 flex items-center gap-2 mx-auto px-4 py-2 rounded-lg bg-white/80 hover:bg-white text-green-700 text-sm font-medium transition-all shadow-sm border border-green-200 hover:border-green-400"
                >
                  {copied ? 'Copiato!' : 'Copia Codice'}
                </button>
                <p className="text-xs text-gray-500 text-center">
                  WhatsApp &rarr; Menu &#8942; &rarr; Dispositivi connessi &rarr; Connetti con numero &rarr; Inserisci il codice
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 text-primary font-medium bg-primary/10 px-5 py-2.5 rounded-full">
              <Loader2 className="w-4 h-4 animate-spin" /> In attesa di connessione...
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Messages Section ---
function MessagesSection({ messages, messagesLoading, subscription, onDelete, fmt, statusColors, trunc }: {
  messages: ScheduledMessage[];
  messagesLoading: boolean;
  subscription: SubscriptionState;
  onDelete: (id: string) => void;
  fmt: (d: string) => string;
  statusColors: Record<string, string>;
  trunc: (s: string, n: number) => string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-text-primary">Messaggi Schedulati</h2>
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
          <p className="text-gray-500">Nessun messaggio. Invia una vCard a &quot;Te Stesso&quot; su WhatsApp!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((msg) => (
            <div key={msg.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 transition-all hover:shadow-md">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900 truncate">
                      {(msg.recipient_name || msg.recipient_number || '?') + (msg.recipient_name && msg.recipient_number ? ' (' + msg.recipient_number + ')' : '')}
                    </span>
                    <span className={'px-2 py-0.5 rounded-full text-xs font-medium ' + (statusColors[msg.status] || 'bg-gray-100 text-gray-600')}>
                      {msg.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mb-1 font-medium">{trunc(msg.parsed_message || '', 100)}</p>
                  {msg.caption && msg.caption !== msg.parsed_message && (
                    <p className="text-xs text-gray-400 mb-1">Originale: {trunc(msg.caption, 60)}</p>
                  )}
                  <p className="text-xs text-gray-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> {fmt(msg.scheduled_at)}
                  </p>
                </div>
                <button
                  onClick={() => onDelete(msg.id)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-700 hover:bg-red-50 transition-colors flex items-center gap-1 shrink-0"
                >
                  <Trash2 className="w-3 h-3" /> Elimina
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
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
          <span>Apri WhatsApp e cerca la chat <strong>&quot;Te Stesso&quot;</strong></span>
        </li>
        <li className="flex gap-3">
          <span className="bg-primary/10 text-primary w-6 h-6 rounded-full flex items-center justify-center font-bold shrink-0 text-xs">2</span>
          <span>Tocca la graffetta e seleziona <strong>&quot;Contatto&quot;</strong> del destinatario</span>
        </li>
        <li className="flex gap-3">
          <span className="bg-primary/10 text-primary w-6 h-6 rounded-full flex items-center justify-center font-bold shrink-0 text-xs">3</span>
          <span>Scrivi il messaggio con data/ora: <strong>&quot;Invia a Marco domani alle 9: Ciao!&quot;</strong></span>
        </li>
      </ol>
    </div>
  );
}
