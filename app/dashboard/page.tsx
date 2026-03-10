'use client'; // @ts-nocheck
import React, { useEffect, useRef, useState, useCallback } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { TextPlugin } from 'gsap/TextPlugin';
import {
  Calendar, MessageCircle, CheckCircle2, ArrowRight, Clock, Smartphone,
  Link as LinkIcon, ChevronDown, Loader2h, Paperclip, User, Send, QrCode,
  Hash, Shield, Zap, RefreshCw, Check, X, LogOut, Trash2, XCircle
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { createClient } from '@supabase/supabase-js'
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
if (typeof window !== 'undefined') { gsap.registerPlugin(ScrollTrigger, TextPlugin); }

// âââ Storage helpers âââ

const supabaseClient = typeof window !== 'undefined' ? createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
) : null;
const PHONE_KEY = 'sw_phone';
const INST_KEY  = 'sw_instance';
const getStoredPhone    = () => (typeof window !== 'undefined' ? localStorage.getItem(PHONE_KEY) || '' : '');
const getStoredInstance = () => (typeof window !== 'undefined' ? localStorage.getItem(INST_KEY)  || '' : '');
const savePhone    = (p: string) => { if (p) localStorage.setItem(PHONE_KEY, p); };
const saveInstance = (n: string) => { if (n) localStorage.setItem(INST_KEY, n); };
const EXPIRY_KEY  = 'sw_expiry';
const getStoredExpiry   = () => (typeof window !== 'undefined' ? localStorage.getItem(EXPIRY_KEY) || '' : '');
const saveExpiry        = () => { localStorage.setItem(EXPIRY_KEY, String(Date.now() + 24 * 3600 * 1000)); };
const clearPhone        = () => { localStorage.removeItem(PHONE_KEY); localStorage.removeItem(INST_KEY); localStorage.removeItem(EXPIRY_KEY); };

// BUG3 FIX: normalize Italian phone numbers for display
function normalizeITPhone(raw: string): string {
  if (!raw) return raw;
  let n = raw.replace(/\D/g, '');
  if (n.startsWith('0')) n = '39' + n.substring(1);
  else if (n.startsWith('3') && !n.startsWith('39')) n = '39' + n;
  return n;
}

export default function DashboardPage() {
  // âââ State âââ
  const [connStatus, setConnStatus]     = useState<'disconnected'|'connecting'|'connected'>('disconnected');
  const [qrCode,      setQrCode]        = useState<string|null>(null);
  const [pairingCode, setPairingCode]   = useState<string|null>(null);
  const [instanceName, setInstanceName] = useState(() => getStoredInstance() || '');
  const [isLoading, setIsLoading]       = useState(false);
  const [error, setError]               = useState<string|null>(null);
  const [userPhone, setUserPhone]       = useState('');
  const [messages, setMessages]         = useState<any[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [subscription, setSubscription] = useState({ status:'unknown', trial_ends_at:null, expired:false });
  const [sessionValidated, setSessionValidated] = useState(false);

  const refreshTimer = useRef<any>(null);
  const msgTimer     = useRef<any>(null);

  // âââ Session validation on mount âââ
  useEffect(() => {
    const validateSession = async () => {
      const storedPhone = getStoredPhone();
      const storedInst  = getStoredInstance();
              // FIX P3: check session expiry (24h) â before everything
              const expiry = getStoredExpiry();
              if (expiry && Date.now() > parseInt(expiry)) {
                          console.log('[dashboard] session expired, clearing localStorage');
                          clearPhone();
                          setSessionValidated(true);
                          return;
              }
      if (!storedPhone || !storedInst) {
                
        setSessionValidated(true);
        return;
      }
      console.log('[dashboard] validating session for', storedInst);
      try {
        const res = await fetch('/api/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status', instanceName: storedInst }),
        });
        const r = await res.json();
        console.log('[dashboard] session validation result:', JSON.stringify(r));
        if (r.status === 'not_found' || r.status === 'close') {
          console.log('[dashboard] session invalid, clearing localStorage');
          clearPhone();
          setSessionValidated(true);
          return;
        }
        if (r.status === 'open') {
          // FIX C: owner verification â se l'istanza appartiene a un numero diverso, reset
          if (r.owner && normalizeITPhone(r.owner) !== normalizeITPhone(storedPhone)) {
            console.log('[dashboard] FIX C owner mismatch: owner=', r.owner, 'storedPhone=', storedPhone, 'â clearing session');
            clearPhone();
            setSessionValidated(true);
            return;
          }
          setUserPhone(normalizeITPhone(storedPhone));
          setInstanceName(storedInst);
          setConnStatus('connected');
                          saveExpiry(); // FIX P3: refresh 24h expiry on valid connection
          fetchMessagesForPhone(storedPhone);
        } else {
          // Stale session (connecting state but no owner) â clear it
          clearPhone();
        }
      } catch (e) {
        console.log('[dashboard] session validation error:', e);
                // FIX P3: on network error do NOT fake connected â stay disconnected
                // (avoids ghost sessions for new users loading the same URL)
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
    } catch(e) {}
    finally { setMessagesLoading(false); }
  }, [userPhone]);

  useEffect(() => {
    if (connStatus === 'connected' && userPhone) {
      fetchMessagesForPhone(userPhone);
      if (msgTimer.current) clearInterval(msgTimer.current);
      msgTimer.current = setInterval(() => fetchMessagesForPhone(userPhone), 30000);
    }
    return () => { if (msgTimer.current) clearInterval(msgTimer.current); };
  }, [connStatus, userPhone, fetchMessagesForPhone]);

  // Supabase Realtime: instant UI update on connection_status change
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
        (payload: any) => {
          const newStatus = payload.new?.connection_status;
          if (newStatus === 'open' && connStatus !== 'connected') {
            setConnStatus('connected');
            setQrCode(null);
            setPairingCode(null);
            if (refreshTimer.current) { clearInterval(refreshTimer.current); refreshTimer.current = null; }
            const phoneToUse = userPhone || getStoredPhone();
            if (phoneToUse) {
              setUserPhone(normalizeITPhone(phoneToUse));
              fetchMessagesForPhone(phoneToUse);
            }
          } else if (newStatus === 'close' && connStatus !== 'disconnected') {
            setConnStatus('disconnected');
          }
        }
      )
      .subscribe();

    return () => { supabaseClient.removeChannel(channel); };
  }, [instanceName, connStatus, userPhone]);

  // âââ handleConnect â new unified flow âââ
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
      console.log('[dashboard] getCodeAndPairing result:', JSON.stringify(r));
      if (r.error) {
        setError(r.error);
        setIsLoading(false);
        return;
      }
      if (r.instanceName) {
        setInstanceName(r.instanceName);
        saveInstance(r.instanceName);
      }
      if (r.qrCode) {
        const q = r.qrCode;
        setQrCode(q.startsWith('data:') ? q : 'data:image/png;base64,' + q);
      }
      if (r.pairingCode) setPairingCode(r.pairingCode);
      setConnStatus('connecting');

      // Start polling every 3 seconds
      if (refreshTimer.current) clearInterval(refreshTimer.current);
      const instName = r.instanceName;
      refreshTimer.current = setInterval(async () => {
        try {
          const sr = await fetch('/api/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'status', instanceName: instName }),
          });
          const s = await sr.json();
          console.log('[dashboard] poll status:', JSON.stringify(s));
          if (s.status === 'open') {
            clearInterval(refreshTimer.current);
                            saveExpiry(); // FIX P3: save 24h expiry on new connection
            setConnStatus('connected');
            setQrCode(null);
            setPairingCode(null);
            const phone = normalizeITPhone(s.owner || rawPhone.replace(/\D/g, ''));
            savePhone(phone);
            setUserPhone(normalizeITPhone(phone));
            // Set webhook
            await fetch('/api/connect', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'setWebhook', instanceName: instName }),
            });
            fetchMessagesForPhone(phone);
          }
        } catch(e) { console.log('[dashboard] poll error:', e); }
      }, 3000);

    } catch(e) {
      setError('Errore di connessione. Riprova.');
      console.log('[dashboard] handleConnect error:', e);
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
      } catch(e) {}
    }
    clearPhone();
    setUserPhone('');
    setMessages([]);
    setConnStatus('disconnected');
    setQrCode(null);
    setPairingCode(null);
    setInstanceName('');
    setSubscription({ status:'unknown', trial_ends_at:null, expired:false });
  };

  const handleDelete = async (id: any) => {
    try {
      await fetch('/api/messages', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, phone: userPhone }),
      });
      fetchMessagesForPhone();
    } catch(e) {}
  };

  const fmt = (d: string) => {
    try { return new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }); }
    catch(e) { return d; }
  };
  const statusColors: Record<string,string> = {
    pending:  'bg-yellow-100 text-yellow-800',
    sent:     'bg-green-100 text-green-800',
    failed:   'bg-red-100 text-red-800',
    cancelled:'bg-gray-100 text-gray-600',
  };

  return (
    <div className="min-h-screen bg-background text-text-primary font-sans selection:bg-primary/20 selection:text-accent overflow-hidden">
      <Navbar connStatus={connStatus} userPhone={userPhone} onLogout={handleLogout} />
      <HeroSection />
      <FeaturesSection />
      <PhilosophySection />
      <HowItWorksSection />
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
      {connStatus === 'connected' && userPhone && (
        <MessagesSection
          messages={messages}
          messagesLoading={messagesLoading}
          subscription={subscription}
          onDelete={handleDelete}
          fmt={fmt}
          statusColors={statusColors}
        />
      )}
      <PricingSection />
      <FAQSection />
      <Footer />
    </div>
  );
}
// âââ NAVBAR âââ
function Navbar({ connStatus, userPhone, onLogout }: any) {
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        start: 'top -50', end: 99999,
        toggleClass: { className: 'nav-scrolled', targets: navRef.current }
      });
    });
    return () => ctx.revert();
  }, []);
  return (
    <nav ref={navRef} className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[95%] max-w-5xl rounded-full px-4 md:px-6 py-3 transition-all duration-300 flex items-center justify-between bg-white/70 backdrop-blur-md text-text-primary shadow-sm border border-gray-200">
      <div className="flex items-center gap-2 font-bold text-lg md:text-xl tracking-tight">
        <Calendar className="w-5 h-5 md:w-6 md:h-6 text-primary" />
        <span>WhatsLater</span>
      </div>
      <div className="hidden md:flex items-center gap-8 text-sm font-medium">
        <a href="#come-funziona" className="hover:text-primary transition-colors">Come Funziona</a>
        <a href="#prezzi" className="hover:text-primary transition-colors">Prezzi</a>
        <a href="#faq" className="hover:text-primary transition-colors">FAQ</a>
      </div>
      <div className="flex items-center gap-2 md:gap-3">
        {connStatus === 'connected' && (
          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            connected
          </span>
        )}
        {userPhone ? (
          <button onClick={onLogout} className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-red-500 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50">
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
        ) : (
          <a href="#connetti" className="bg-primary text-white px-4 md:px-5 py-2 rounded-full text-sm font-semibold hover:scale-105 transition-transform shadow-[0_4px_14px_0_rgba(37,211,102,0.39)]">
            Connetti Ora
          </a>
        )}
      </div>
    </nav>
  );
}
// âââ HERO SECTION âââ
function HeroSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.to('.bubble', { y: 'random(-100, 100)', x: 'random(-100, 100)', rotation: 'random(-45, 45)', duration: 'random(10, 20)', repeat: -1, yoyo: true, ease: 'sine.inOut', stagger: 0.5 });
      gsap.from('.hero-text', { y: 50, opacity: 0, duration: 1, stagger: 0.2, ease: 'power3.out', delay: 0.2 });
      gsap.from('.phone-mockup', { y: 100, opacity: 0, duration: 1.2, ease: 'back.out(1.2)', delay: 0.6 });
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 2 });
      tl.to('.phone-screen-lock', { opacity: 0, duration: 0.5, delay: 1 })
        .to('.wa-icon', { scale: 0.9, duration: 0.1, yoyo: true, repeat: 1 })
        .to('.home-screen', { opacity: 0, duration: 0.3 })
        .to('.wa-chats', { opacity: 1, duration: 0.3 })
        .to('.chat-self', { backgroundColor: 'rgba(0,0,0,0.05)', duration: 0.1, yoyo: true, repeat: 1 }, '+=0.5')
        .to('.wa-chats', { opacity: 0, duration: 0.3 })
        .to('.wa-inside-chat', { opacity: 1, duration: 0.3 })
        .to('.attach-icon', { scale: 0.8, duration: 0.1, yoyo: true, repeat: 1 }, '+=0.5')
        .to('.attach-menu', { y: 0, opacity: 1, duration: 0.3, ease: 'back.out(1.5)' })
        .to('.contact-btn', { scale: 0.9, duration: 0.1, yoyo: true, repeat: 1 }, '+=0.5')
        .to('.attach-menu', { y: 50, opacity: 0, duration: 0.2 })
        .fromTo('.contact-card-preview', { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'spring' })
        .to('.send-contact-btn', { scale: 0.9, duration: 0.1, yoyo: true, repeat: 1 }, '+=0.5')
        .to('.contact-card-preview', { opacity: 0, duration: 0.2 })
        .fromTo('.sent-contact', { scale: 0.8, opacity: 0, x: 20 }, { scale: 1, opacity: 1, x: 0, duration: 0.3, ease: 'back.out(1.5)' })
        .to('.typing-indicator', { opacity: 1, duration: 0.2 }, '+=0.5')
        .to('.chat-input-text', { text: "Ricorda l'appuntamento di domani alle 10:00", duration: 1.5, ease: 'none' })
        .to('.typing-indicator', { opacity: 0, duration: 0.1 })
        .to('.send-msg-btn', { scale: 0.8, duration: 0.1, yoyo: true, repeat: 1 }, '+=0.2')
        .to('.chat-input-text', { text: "", duration: 0.1 })
        .fromTo('.sent-msg', { scale: 0.8, opacity: 0, x: 20 }, { scale: 1, opacity: 1, x: 0, duration: 0.3, ease: 'back.out(1.5)' })
        .fromTo('.confirmation-badge', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'back.out(1.5)' }, '+=0.5')
        .to({}, { duration: 3 });
    }, containerRef);
    return () => ctx.revert();
  }, []);
  return (
    <section ref={containerRef} className="relative min-h-[100dvh] flex flex-col items-center justify-center pt-20 overflow-hidden bg-gradient-to-b from-background via-[#e8f5e9] to-white">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(6)].map((_, i) => (
          <div key={i} className={cn("bubble absolute rounded-full bg-primary/10 blur-3xl", i % 2 === 0 ? "w-64 h-64" : "w-96 h-96")} style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%` }} />
        ))}
      </div>
      <div className="relative z-10 text-center px-4 max-w-4xl mx-auto mt-10">
        <h1 className="hero-text text-5xl md:text-7xl font-bold text-text-primary tracking-tight mb-2 font-sans">Scrivi Ora.</h1>
        <h2 className="hero-text text-6xl md:text-8xl font-serif italic text-primary mb-6">Invia Dopo.</h2>
        <p className="hero-text text-text-secondary font-mono text-sm md:text-base max-w-xl mx-auto leading-relaxed">Programma i messaggi WhatsApp semplicemente chattando a te stesso. Nessuna complicazione. A partire da &euro;1.99/mese.</p>
      </div>
      <div className="phone-mockup relative mt-16 w-[300px] h-[600px] bg-black rounded-[3rem] border-[8px] border-black shadow-[0_20px_50px_rgba(0,0,0,0.2)] flex-shrink-0">
        <div className="absolute -left-[10px] top-24 w-1 h-8 bg-gray-800 rounded-l-md"></div>
        <div className="absolute -left-[10px] top-36 w-1 h-12 bg-gray-800 rounded-l-md"></div>
        <div className="absolute -left-[10px] top-52 w-1 h-12 bg-gray-800 rounded-l-md"></div>
        <div className="absolute -right-[10px] top-36 w-1 h-16 bg-gray-800 rounded-r-md"></div>
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-24 h-6 bg-black rounded-full z-50"></div>
        <div className="relative w-full h-full bg-[#EFEAE2] overflow-hidden font-sans text-sm rounded-[2.5rem]">
          <div className="phone-screen-lock absolute inset-0 bg-black/40 backdrop-blur-md z-40 flex flex-col items-center justify-center text-white">
            <Clock className="w-12 h-12 mb-2 opacity-80" /><div className="text-4xl font-light">09:41</div><div className="text-sm mt-2 opacity-80">Scorri per sbloccare</div>
          </div>
          <div className="home-screen absolute inset-0 bg-gradient-to-b from-blue-400 to-blue-600 z-30 p-6 pt-16">
            <div className="grid grid-cols-4 gap-4"><div className="wa-icon w-12 h-12 bg-[#25D366] rounded-2xl flex items-center justify-center shadow-sm mx-auto"><MessageCircle className="w-7 h-7 text-white" fill="currentColor" /></div></div>
          </div>
          <div className="wa-chats absolute inset-0 bg-white z-20 opacity-0 flex flex-col">
            <div className="bg-[#075E54] text-white pt-12 pb-3 px-4 flex justify-between items-center"><span className="font-semibold text-lg">WhatsApp</span></div>
            <div className="flex-1 overflow-hidden">
              <div className="chat-self flex items-center gap-3 p-3 border-b border-gray-100"><div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center"><User className="w-6 h-6 text-gray-500" /></div><div className="flex-1"><div className="flex justify-between"><span className="font-semibold">Te Stesso (Tu)</span><span className="text-xs text-gray-500">09:41</span></div><span className="text-sm text-gray-500">Invia un messaggio...</span></div></div>
              {[1,2,3].map(i => (<div key={i} className="flex items-center gap-3 p-3 border-b border-gray-100 opacity-50"><div className="w-12 h-12 bg-gray-200 rounded-full"></div><div className="flex-1"><div className="h-4 bg-gray-200 rounded w-24 mb-2"></div><div className="h-3 bg-gray-100 rounded w-40"></div></div></div>))}
            </div>
          </div>
          <div className="wa-inside-chat absolute inset-0 bg-[#EFEAE2] z-10 opacity-0 flex flex-col">
            <div className="bg-[#075E54] text-white pt-12 pb-2 px-2 flex items-center gap-2"><ArrowRight className="w-5 h-5 rotate-180" /><div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center"><User className="w-5 h-5 text-gray-600" /></div><span className="font-semibold">Te Stesso (Tu)</span></div>
            <div className="flex-1 p-3 flex flex-col justify-end gap-2 overflow-hidden relative">
              <div className="sent-contact self-end bg-[#dcf8c6] p-2 rounded-lg rounded-tr-none shadow-sm max-w-[80%] opacity-0"><div className="flex items-center gap-3 border-b border-green-200 pb-2 mb-2"><div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center"><User className="w-6 h-6 text-gray-600" /></div><span className="font-semibold">Andrea</span></div><div className="text-xs text-center text-gray-600">Messaggio a Andrea</div></div>
              <div className="sent-msg self-end bg-[#dcf8c6] p-2 rounded-lg rounded-tr-none shadow-sm max-w-[80%] opacity-0"><span className="text-sm">Ricorda l&apos;appuntamento di domani alle 10:00</span><div className="text-[10px] text-gray-500 text-right mt-1">09:42</div></div>
              <div className="confirmation-badge self-center bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm text-xs font-medium text-primary flex items-center gap-1.5 opacity-0 mt-2"><CheckCircle2 className="w-3.5 h-3.5" /> Programmato per Dom 24 Feb, 10:00</div>
            </div>
            <div className="bg-[#f0f0f0] p-2 flex items-end gap-2 pb-6">
              <div className="bg-white flex-1 rounded-full flex items-center px-3 py-2 min-h-[40px]"><span className="chat-input-text text-sm text-gray-800"></span><span className="typing-indicator w-0.5 h-4 bg-primary ml-0.5 animate-pulse opacity-0"></span></div>
              <div className="attach-icon w-10 h-10 rounded-full flex items-center justify-center text-gray-500"><Paperclip className="w-5 h-5" /></div>
              <div className="send-msg-btn w-10 h-10 bg-[#00a884] rounded-full flex items-center justify-center text-white shadow-sm"><Send className="w-4 h-4 ml-1" /></div>
            </div>
            <div className="attach-menu absolute bottom-20 left-4 right-4 bg-white rounded-2xl p-4 shadow-lg opacity-0 translate-y-10 flex flex-wrap justify-center gap-4">
              <div className="flex flex-col items-center gap-1"><div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-white"><User className="w-6 h-6" /></div><span className="text-xs">Documento</span></div>
              <div className="flex flex-col items-center gap-1"><div className="w-12 h-12 bg-pink-500 rounded-full flex items-center justify-center text-white"><User className="w-6 h-6" /></div><span className="text-xs">Fotocamera</span></div>
              <div className="contact-btn flex flex-col items-center gap-1"><div className="w-12 h-12 bg-blue-400 rounded-full flex items-center justify-center text-white"><User className="w-6 h-6" /></div><span className="text-xs font-medium">Contatto</span></div>
            </div>
            <div className="contact-card-preview absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl p-4 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] opacity-0 translate-y-full pb-8">
              <div className="text-center font-semibold mb-4">Invia contatto</div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl mb-4"><div className="w-12 h-12 bg-gray-300 rounded-full flex items-center justify-center"><User className="w-6 h-6 text-gray-600" /></div><span className="font-medium text-lg">Andrea</span></div>
              <div className="send-contact-btn w-12 h-12 bg-[#00a884] rounded-full flex items-center justify-center text-white shadow-md mx-auto"><Send className="w-5 h-5 ml-1" /></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
// âââ FEATURES SECTION âââ
function FeaturesSection() {
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl1 = gsap.timeline({ repeat: -1, repeatDelay: 2 });
      tl1.to('.nl-input', { text: "Manda a Marco tra 2 ore", duration: 1.5, ease: 'none' })
        .to('.nl-dots', { opacity: 1, duration: 0.2 }).to('.nl-dots', { opacity: 0, duration: 0.2, delay: 1 })
        .fromTo('.nl-output', { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }).to({}, { duration: 2 })
        .to('.nl-input', { text: "", duration: 0.1 }).to('.nl-output', { opacity: 0, duration: 0.1 })
        .to('.nl-input', { text: "Domani mattina alle 8", duration: 1.5, ease: 'none' })
        .to('.nl-dots', { opacity: 1, duration: 0.2 }).to('.nl-dots', { opacity: 0, duration: 0.2, delay: 1 })
        .to('.nl-output-2', { y: 0, opacity: 1, duration: 0.4 }).to({}, { duration: 2 })
        .to('.nl-input', { text: "", duration: 0.1 }).to('.nl-output-2', { opacity: 0, duration: 0.1 });
      const tl2 = gsap.timeline({ repeat: -1, repeatDelay: 2 });
      tl2.fromTo('.ac-contact', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'spring' })
        .to('.ac-caption', { text: "Buon compleanno!", duration: 1.5, ease: 'none', delay: 0.5 })
        .fromTo('.ac-badge', { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(1.5)', delay: 0.5 })
        .to({}, { duration: 2 }).to(['.ac-contact', '.ac-caption', '.ac-badge'], { opacity: 0, duration: 0.3 });
      const tl3 = gsap.timeline({ repeat: -1, repeatDelay: 2 });
      tl3.to('.sq-timer', { text: "00:00", duration: 2, ease: 'none' })
        .to('.sq-status-1', { rotationX: 90, duration: 0.2 }).to('.sq-status-1-done', { rotationX: 0, duration: 0.2 })
        .to('.sq-row-1', { y: -50, opacity: 0, duration: 0.4, delay: 0.5 })
        .to('.sq-row-2', { y: -60, duration: 0.4 }, '<').to('.sq-row-3', { y: -60, duration: 0.4 }, '<')
        .fromTo('.sq-row-new', { y: 20, opacity: 0 }, { y: -60, opacity: 1, duration: 0.5, ease: 'back.out(1.5)' })
        .to('.sq-cancel-input', { text: "Cancella Marco", duration: 1, ease: 'none', delay: 1 })
        .to('.sq-row-2', { x: 50, opacity: 0, backgroundColor: '#fee2e2', duration: 0.4 })
        .to({}, { duration: 2 })
        .to(['.sq-row-1', '.sq-row-2', '.sq-row-3', '.sq-row-new', '.sq-cancel-input'], { clearProps: 'all' })
        .to('.sq-status-1', { rotationX: 0, duration: 0 }).to('.sq-status-1-done', { rotationX: -90, duration: 0 });
    }, sectionRef);
    return () => ctx.revert();
  }, []);
  return (
    <section ref={sectionRef} className="py-32 px-6 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-20">
          <h2 className="text-4xl md:text-5xl font-bold text-text-primary mb-4 tracking-tight">La Magia di Programmare e Dimenticare</h2>
          <p className="text-xl text-text-secondary font-serif italic">Tre superpoteri per chi tiene davvero alle persone.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-background rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 flex flex-col h-[400px]">
            <h3 className="text-xl font-bold mb-2 flex items-center gap-2"><Zap className="w-5 h-5 text-primary" /> Linguaggio Naturale</h3>
            <p className="text-sm text-text-secondary mb-8">Scrivi come parleresti. L&apos;AI capisce date, ore e intenzioni.</p>
            <div className="flex-1 flex flex-col justify-center items-center relative">
              <div className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-50 mb-4"><span className="nl-input text-sm font-medium text-gray-800"></span><span className="w-0.5 h-4 bg-primary inline-block ml-1 animate-pulse"></span></div>
              <div className="nl-dots opacity-0 flex gap-1 mb-4"><div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div><div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div><div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div></div>
              <div className="nl-output absolute bottom-10 opacity-0 bg-primary/10 text-accent px-4 py-2 rounded-xl text-sm font-mono font-medium flex items-center gap-2"><Calendar className="w-4 h-4" /> Oggi, 14:30 &rarr; Marco Rossi</div>
              <div className="nl-output-2 absolute bottom-10 opacity-0 bg-primary/10 text-accent px-4 py-2 rounded-xl text-sm font-mono font-medium flex items-center gap-2"><Calendar className="w-4 h-4" /> Dom 24 Feb, 08:00 &rarr; Luca B.</div>
            </div>
          </div>
          <div className="bg-background rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 flex flex-col h-[400px]">
            <h3 className="text-xl font-bold mb-2 flex items-center gap-2"><Paperclip className="w-5 h-5 text-primary" /> Allega il Contatto</h3>
            <p className="text-sm text-text-secondary mb-8">Invia la rubrica a te stesso. Aggiungi il messaggio. Fatto.</p>
            <div className="flex-1 flex flex-col justify-center items-center relative w-full">
              <div className="w-full max-w-[240px] bg-[#EFEAE2] rounded-2xl p-4 shadow-inner relative overflow-hidden h-[200px] flex flex-col justify-end">
                <div className="ac-contact bg-white p-3 rounded-xl shadow-sm mb-2 flex items-center gap-3"><div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center"><User className="w-5 h-5 text-gray-500" /></div><span className="font-semibold text-sm">Andrea</span></div>
                <div className="bg-[#dcf8c6] p-2 rounded-xl rounded-tr-none self-end shadow-sm mb-2 min-h-[36px] min-w-[100px]"><span className="ac-caption text-sm"></span></div>
                <div className="ac-badge absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm text-[10px] font-medium text-primary flex items-center gap-1 whitespace-nowrap"><CheckCircle2 className="w-3 h-3" /> Programmato &rarr; 15 Mar, 09:00</div>
              </div>
            </div>
          </div>
          <div className="bg-background rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 flex flex-col h-[400px]">
            <h3 className="text-xl font-bold mb-2 flex items-center gap-2"><RefreshCw className="w-5 h-5 text-primary" /> Coda Intelligente</h3>
            <p className="text-sm text-text-secondary mb-8">Gestisci tutto dalla chat. Annulla con un messaggio.</p>
            <div className="flex-1 flex flex-col relative w-full overflow-hidden">
              <div className="space-y-2 relative h-[150px]">
                <div className="sq-row-1 bg-white p-3 rounded-xl shadow-sm border border-gray-50 flex justify-between items-center relative z-30"><div className="flex flex-col"><span className="text-xs font-bold">Marco R.</span><span className="text-[10px] text-gray-500 truncate w-24">&quot;Ciao, ci vediamo?&quot;</span></div><div className="flex items-center gap-2"><span className="sq-timer text-xs font-mono text-orange-500">00:03</span><div className="relative w-4 h-4"><Clock className="sq-status-1 absolute inset-0 w-4 h-4 text-orange-500" /><CheckCircle2 className="sq-status-1-done absolute inset-0 w-4 h-4 text-primary" style={{ transform: 'rotateX(-90deg)' }} /></div></div></div>
                <div className="sq-row-2 bg-white p-3 rounded-xl shadow-sm border border-gray-50 flex justify-between items-center relative z-20"><div className="flex flex-col"><span className="text-xs font-bold">Sara M.</span><span className="text-[10px] text-gray-500 truncate w-24">&quot;Buon compleanno!&quot;</span></div><div className="flex items-center gap-2"><span className="text-xs font-mono text-gray-400">15 Mar</span><Clock className="w-4 h-4 text-gray-400" /></div></div>
                <div className="sq-row-3 bg-white p-3 rounded-xl shadow-sm border border-gray-50 flex justify-between items-center relative z-10 opacity-50"><div className="flex flex-col"><span className="text-xs font-bold">Luca B.</span><span className="text-[10px] text-gray-500 truncate w-24">&quot;Reminder app...&quot;</span></div><CheckCircle2 className="w-4 h-4 text-primary" /></div>
                <div className="sq-row-new absolute top-full left-0 right-0 bg-white p-3 rounded-xl shadow-sm border border-gray-50 flex justify-between items-center opacity-0"><div className="flex flex-col"><span className="text-xs font-bold">Anna</span><span className="text-[10px] text-gray-500 truncate w-24">&quot;Riunione spostata&quot;</span></div><Clock className="w-4 h-4 text-orange-500" /></div>
              </div>
              <div className="mt-auto bg-white rounded-full px-3 py-2 shadow-sm border border-gray-100 flex items-center"><span className="sq-cancel-input text-xs font-medium text-red-500"></span><span className="w-0.5 h-3 bg-red-500 inline-block ml-1 animate-pulse"></span></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// âââ PHILOSOPHY SECTION âââ
function PhilosophySection() {
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.phil-text-1', { scrollTrigger: { trigger: sectionRef.current, start: 'top 60%', end: 'center center', scrub: 1 }, x: -100, opacity: 0 });
      gsap.from('.phil-text-2', { scrollTrigger: { trigger: sectionRef.current, start: 'top 50%', end: 'center center', scrub: 1 }, x: 100, opacity: 0 });
    }, sectionRef);
    return () => ctx.revert();
  }, []);
  return (
    <section ref={sectionRef} className="py-40 px-6 bg-text-primary text-white overflow-hidden">
      <div className="max-w-5xl mx-auto flex flex-col gap-8">
        <h2 className="phil-text-1 text-5xl md:text-7xl font-bold font-sans text-left">Dimenticare costa caro.</h2>
        <h2 className="phil-text-2 text-5xl md:text-7xl font-serif italic text-primary text-right">Essere presenti non ha prezzo.</h2>
        <p className="mt-16 text-sm md:text-base font-mono text-[#F3F5F7]/70 max-w-2xl mx-auto text-center leading-relaxed">WhatsLater &egrave; il gesto di cura programmata. Nessun compleanno dimenticato. Nessun follow-up perso. Nessun buongiorno mancato perch&eacute; erano le 2 di notte. Costa meno di un caff&egrave; al mese.</p>
      </div>
    </section>
  );
}

// âââ HOW IT WORKS SECTION âââ
function HowItWorksSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray('.hiw-card');
      cards.forEach((card: any, i) => {
        if (i === cards.length - 1) return;
        ScrollTrigger.create({ trigger: card, start: 'top 10%', endTrigger: cards[i + 1], end: 'top 20%', pin: true, pinSpacing: false, animation: gsap.to(card, { scale: 0.9, opacity: 0.5, filter: 'blur(10px)', ease: 'none' }), scrub: true });
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);
  return (
    <section ref={containerRef} id="come-funziona" className="py-20 bg-background relative">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-20"><h2 className="text-4xl font-bold text-text-primary">Come Funziona</h2></div>
        <div className="space-y-24">
          <div className="hiw-card bg-white rounded-[3rem] p-10 md:p-16 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 min-h-[60vh] flex flex-col justify-center relative z-10">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div>
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-6"><span className="text-primary font-bold text-xl">1</span></div>
                <h3 className="text-3xl font-bold mb-4">Connetti WhatsApp</h3>
                <p className="text-text-secondary mb-8">Scansiona il QR Code o usa un codice di abbinamento. Sicuro, veloce e direttamente dal tuo telefono.</p>
                <ul className="space-y-4 text-sm font-medium">
                  <li className="flex items-center gap-3"><Smartphone className="w-5 h-5 text-primary" /> Apri WhatsApp</li>
                  <li className="flex items-center gap-3"><Shield className="w-5 h-5 text-primary" /> Dispositivi collegati</li>
                  <li className="flex items-center gap-3"><LinkIcon className="w-5 h-5 text-primary" /> Collega un dispositivo</li>
                </ul>
              </div>
              <div className="bg-background rounded-3xl p-8 flex items-center justify-center">
                <div className="w-48 h-48 bg-white rounded-2xl shadow-sm border-2 border-primary/20 flex items-center justify-center relative overflow-hidden"><QrCode className="w-32 h-32 text-text-primary" /><div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/20 to-transparent h-1/2 animate-[scan_2s_ease-in-out_infinite]"></div></div>
              </div>
            </div>
          </div>
          <div className="hiw-card bg-white rounded-[3rem] p-10 md:p-16 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 min-h-[60vh] flex flex-col justify-center relative z-20">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div className="order-2 md:order-1 bg-[#EFEAE2] rounded-3xl p-6 flex items-center justify-center h-[400px] overflow-hidden relative">
                <div className="w-[240px] h-[480px] bg-white rounded-[2rem] shadow-xl border-4 border-gray-800 flex flex-col translate-y-10 relative">
                  <div className="absolute -left-[6px] top-16 w-1 h-6 bg-gray-800 rounded-l-md"></div><div className="absolute -left-[6px] top-24 w-1 h-10 bg-gray-800 rounded-l-md"></div><div className="absolute -left-[6px] top-36 w-1 h-10 bg-gray-800 rounded-l-md"></div><div className="absolute -right-[6px] top-24 w-1 h-12 bg-gray-800 rounded-r-md"></div>
                  <div className="w-full h-full overflow-hidden rounded-[1.75rem] flex flex-col">
                    <div className="bg-[#075E54] text-white p-3 flex items-center gap-2 text-xs font-medium"><ArrowRight className="w-4 h-4 rotate-180" /> Te Stesso (Tu)</div>
                    <div className="flex-1 p-3 flex flex-col justify-end gap-2 bg-[#EFEAE2]">
                      <div className="bg-white p-2 rounded-lg shadow-sm self-end w-3/4"><div className="flex items-center gap-2 border-b pb-1 mb-1"><User className="w-4 h-4" /> <span className="text-xs font-bold">Andrea</span></div><div className="text-[10px] text-gray-500">Contatto</div></div>
                      <div className="bg-[#dcf8c6] p-2 rounded-lg shadow-sm self-end text-xs">Ricorda appuntamento domani</div>
                    </div>
                    <div className="bg-gray-100 p-2 flex gap-2 items-center"><div className="bg-white flex-1 rounded-full h-8"></div><div className="w-8 h-8 bg-[#00a884] rounded-full flex items-center justify-center text-white"><Send className="w-3 h-3 ml-0.5" /></div></div>
                  </div>
                </div>
              </div>
              <div className="order-1 md:order-2">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-6"><span className="text-primary font-bold text-xl">2</span></div>
                <h3 className="text-3xl font-bold mb-4">Invia un Contatto a Te Stesso</h3>
                <p className="text-text-secondary mb-8">Apri la chat con te stesso su WhatsApp. Allega il contatto della persona a cui vuoi scrivere, aggiungi il messaggio e invia.</p>
              </div>
            </div>
          </div>
          <div className="hiw-card bg-white rounded-[3rem] p-10 md:p-16 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 min-h-[60vh] flex flex-col justify-center relative z-30">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div>
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-6"><span className="text-primary font-bold text-xl">3</span></div>
                <h3 className="text-3xl font-bold mb-4">Rilassati</h3>
                <p className="text-text-secondary mb-8">L&apos;AI capisce quando inviare il messaggio. Tu non devi fare altro. Ti avviseremo quando sar&agrave; consegnato.</p>
                <div className="inline-flex items-center gap-2 bg-green-50 text-green-700 px-4 py-2 rounded-full text-sm font-medium"><CheckCircle2 className="w-4 h-4" /> Tutti inviati con successo</div>
              </div>
              <div className="bg-background rounded-3xl p-8 flex flex-col gap-4">
                {[1,2,3].map((i) => (<div key={i} className="bg-white p-4 rounded-2xl shadow-sm flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center"><Check className="w-5 h-5 text-primary" /></div><div><div className="text-sm font-bold">Messaggio inviato</div><div className="text-xs text-gray-500">Oggi, 09:00</div></div></div></div>))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
// âââ CONNECTION ZONE â Unified UX (no tabs) âââ
function ConnectionZone({ connStatus, qrCode, pairingCode, isLoading, error, userPhone, onConnect, onDisconnect }: any) {
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const prevConnStatusRef = useRef<string>('disconnected');

  // Show onboarding modal when connection transitions to 'connected'
  useEffect(() => {
    if (connStatus === 'connected' && prevConnStatusRef.current !== 'connected') {
      setShowOnboarding(true);
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

  // âââ CONNECTED STATE âââ
  if (connStatus === 'connected') {
    const waUrl = `https://wa.me/+${userPhone}?text=Ciao!%20Per%20programmare%20un%20messaggio%2C%20inviami%20la%20vCard%20del%20destinatario%20e%20poi%20scrivi%3A%20Invia%20a%20%5BNome%5D%20domani%20alle%2015%3A%20Il%20tuo%20messaggio`;
    return (
      <>
        {showOnboarding && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-2xl font-bold mb-3">Sei connesso! 🎉</h2>
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
        <section id="connetti" className="py-24 bg-gradient-to-b from-background to-[#e8f5e9]">
          <div className="max-w-3xl mx-auto px-6">
            <div className="bg-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.05)] overflow-hidden">
              <div className="p-12 text-center flex flex-col items-center">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
                  <CheckCircle2 className="w-10 h-10 text-primary" />
                </div>
                <h3 className="text-2xl font-bold mb-2">WhatsApp Connesso!</h3>
                {userPhone && <p className="text-text-secondary mb-2">Numero: +{userPhone}</p>}
                <p className="text-text-secondary mb-8">Sei pronto per programmare il tuo primo messaggio.</p>
                <div className="w-full bg-background rounded-2xl p-6 text-left mb-8">
                  <h4 className="font-bold mb-4">Come iniziare:</h4>
                  <ol className="space-y-3 text-sm">
                    <li className="flex gap-3"><span className="bg-white w-6 h-6 rounded-full flex items-center justify-center font-bold shadow-sm shrink-0">1</span> Apri WhatsApp e cerca la chat &quot;Te Stesso&quot;</li>
                    <li className="flex gap-3"><span className="bg-white w-6 h-6 rounded-full flex items-center justify-center font-bold shadow-sm shrink-0">2</span> Tocca la graffetta e seleziona &quot;Contatto&quot;</li>
                    <li className="flex gap-3"><span className="bg-white w-6 h-6 rounded-full flex items-center justify-center font-bold shadow-sm shrink-0">3</span> Invia il contatto e scrivi il messaggio!</li>
                  </ol>
                </div>
                <button onClick={onDisconnect} className="px-6 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors flex items-center gap-2">
                  <LogOut className="w-4 h-4" /> Disconnetti
                </button>
              </div>
            </div>
          </div>
        </section>
      </>
    );
  }

  // âââ CONNECTING / DISCONNECTED STATE âââ
  return (
    <section id="connetti" className="py-24 bg-gradient-to-b from-background to-[#e8f5e9]">
      <div className="max-w-3xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-text-primary mb-4">Collega il tuo WhatsApp</h2>
          <p className="text-text-secondary">Inserisci il tuo numero di telefono per generare il codice di collegamento</p>
        </div>
        <div className="bg-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.05)] overflow-hidden">
          <div className="p-8 md:p-12">
            {/* Phone input â always visible, required before showing QR/code */}
            <form onSubmit={handleSubmit} className="max-w-sm mx-auto flex flex-col gap-4 mb-8">
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
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center text-sm text-red-600">
                  {phoneError || error}
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

            {/* QR + Pairing Code â shown simultaneously once generated */}
            {(qrCode || pairingCode) && (
              <div className="flex flex-col items-center gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* QR Code section */}
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

                {/* Divider */}
                {qrCode && pairingCode && (
                  <div className="flex items-center gap-4 w-full max-w-sm">
                    <div className="flex-1 h-px bg-gray-200"></div>
                    <span className="text-xs text-gray-400 font-medium">OPPURE</span>
                    <div className="flex-1 h-px bg-gray-200"></div>
                  </div>
                )}

                {/* Pairing Code section */}
                {pairingCode && (
                  <div className="flex flex-col items-center gap-3 w-full max-w-sm">
                    <p className="text-sm font-semibold text-gray-700">Oppure inserisci questo codice su WhatsApp</p>
                    <div className="text-4xl md:text-5xl font-mono font-bold tracking-widest text-text-primary bg-background py-5 px-8 rounded-3xl border border-gray-200 shadow-inner w-full text-center">
                      {pairingCode.length >= 8 ? pairingCode.slice(0,4) + '-' + pairingCode.slice(4,8) : pairingCode}
                    </div>
                  <button
                    onClick={handleCopy}
                    className="mt-3 flex items-center gap-2 mx-auto px-4 py-2 rounded-lg bg-white/80 hover:bg-white text-green-700 text-sm font-medium transition-all shadow-sm border border-green-200 hover:border-green-400"
                    title="Copia codice"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    {copied ? 'Copiato!' : 'Copia Codice'}
                  </button>
                    <p className="text-xs text-gray-500 text-center">
                      Vai su WhatsApp &rarr; Menu &#8942; &rarr; Dispositivi connessi &rarr; Connetti con numero &rarr; Inserisci il codice qui sopra
                    </p>
                  </div>
                )}

                {/* Status */}
                <div className="flex items-center gap-2 text-primary font-medium bg-primary/10 px-5 py-2.5 rounded-full">
                  <Loader2 className="w-4 h-4 animate-spin" /> In attesa di connessione...
                </div>
              </div>
            )}

            {/* If connected (shouldn't show here but safety) */}
            {connStatus === 'connected' && (
              <div className="flex items-center justify-center gap-2 text-primary font-medium bg-primary/10 px-5 py-2.5 rounded-full">
                <CheckCircle2 className="w-5 h-5" /> Connesso!
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
// âââ MESSAGES SECTION âââ
function MessagesSection({ messages, messagesLoading, subscription, onDelete, fmt, statusColors }: any) {
  const trunc = (s: string, n: number) => (!s ? '' : s.length > n ? s.substring(0, n) + '...' : s);
  return (
    <section className="py-16 bg-white">
      <div className="max-w-4xl mx-auto px-6">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-3xl font-bold text-text-primary">Messaggi Schedulati</h2>
          <span className="text-sm text-text-secondary bg-background px-3 py-1 rounded-full">{messages.length} messagg{messages.length !== 1 ? 'i' : 'io'}</span>
        </div>
        {subscription.expired && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6 flex items-center justify-between">
            <div><p className="font-semibold text-red-700">Trial Scaduto</p><p className="text-sm text-red-600">Abbonati per continuare.</p></div>
            <a href="#prezzi" className="px-4 py-2 bg-primary text-white rounded-xl font-medium text-sm">Abbonati</a>
          </div>
        )}
        {messagesLoading ? (
          <div className="bg-background rounded-3xl p-12 text-center"><p className="text-gray-400 animate-pulse">Caricamento...</p></div>
        ) : messages.length === 0 ? (
          <div className="bg-background rounded-3xl p-12 text-center"><p className="text-gray-500">Nessun messaggio. Invia una vCard a &quot;Te Stesso&quot; su WhatsApp!</p></div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg: any) => (
              <div key={msg.id} className="bg-background rounded-2xl shadow-sm border border-gray-100 p-5 transition-all hover:shadow-md">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-900 truncate">{(msg.recipient_name || msg.recipient_number || '?') + (msg.recipient_name && msg.recipient_number ? ' (' + msg.recipient_number + ')' : '')}</span>
                      <span className={'px-2 py-0.5 rounded-full text-xs font-medium ' + (statusColors[msg.status] || 'bg-gray-100 text-gray-600')}>{msg.status}</span>
                    </div>
                    <p className="text-sm text-gray-700 mb-1 font-medium">{trunc(msg.parsed_message || '', 100)}</p>
                    {msg.caption && msg.caption !== msg.parsed_message && <p className="text-xs text-gray-400 mb-1">Originale: {trunc(msg.caption, 60)}</p>}
                    <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar className="w-3 h-3" /> {fmt(msg.scheduled_at)}</p>
                  </div>
                  <button onClick={() => onDelete(msg.id)} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-700 hover:bg-red-50 transition-colors flex items-center gap-1 shrink-0"><Trash2 className="w-3 h-3" /> Elimina</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// âââ PRICING SECTION âââ
function PricingSection() {
  return (
    <section id="prezzi" className="py-24 bg-white">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <h2 className="text-4xl md:text-5xl font-bold text-text-primary mb-4">Un prezzo. Nessuna sorpresa.</h2>
        <p className="text-xl text-text-secondary font-serif italic mb-16">Semplice come inviare un messaggio.</p>
        <div className="max-w-md mx-auto bg-white rounded-[3rem] p-10 shadow-[0_20px_50px_rgba(0,0,0,0.08)] border border-primary/20 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-2 bg-primary"></div>
          <h3 className="text-2xl font-bold mb-2">WhatsLater</h3>
          <div className="flex items-baseline justify-center gap-1 mb-8"><span className="text-5xl font-bold">&euro;1.99</span><span className="text-text-secondary">/mese</span></div>
          <ul className="space-y-4 text-left mb-10">
            <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Messaggi illimitati*</li>
            <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Connessione QR Code o Codice</li>
            <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Linguaggio naturale AI</li>
            <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Coda messaggi in tempo reale</li>
            <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Supporto via WhatsApp</li>
          </ul>
          <a href="#connetti" className="block w-full bg-primary text-white py-4 rounded-2xl font-bold text-lg hover:scale-[1.02] transition-transform shadow-lg shadow-primary/30 mb-4">Inizia Ora &mdash; &euro;1.99/mese</a>
          <p className="text-[10px] text-gray-400">*Soggetto a rate limiting di 15 msg/min per protezione account.</p>
        </div>
        <p className="mt-12 text-sm text-text-secondary">Hai un team o un business? <a href="mailto:hello@whatslater.com" className="text-primary font-medium hover:underline">Scrivici.</a></p>
      </div>
    </section>
  );
}

// âââ FAQ SECTION âââ
function FAQSection() {
  const faqs = [
    { q: "Il mio WhatsApp Ã¨ sicuro?", a: "Assolutamente sÃ¬. Usiamo lo stesso protocollo di WhatsApp Web. Non leggiamo i tuoi messaggi. I dati sono protetti con Row Level Security su database PostgreSQL." },
    { q: "Devo scansionare un QR Code?", a: "Puoi scegliere: scansiona un QR Code oppure inserisci un codice di abbinamento a 8 cifre direttamente su WhatsApp. Entrambi i metodi funzionano dal cellulare." },
    { q: "Cosa succede se il mio telefono Ã¨ spento?", a: "Il messaggio resta in coda. Quando torni online, viene inviato automaticamente. Ti avvisiamo se qualcosa non va." },
    { q: "Posso annullare un messaggio programmato?", a: "SÃ¬. Scrivi 'annulla' o 'cancella [nome]' nella chat con Te Stesso, oppure eliminalo dalla dashboard." },
    { q: "Come funziona l'AI?", a: "Scrivi in linguaggio naturale â 'domani alle 9', 'fra 2 ore', 'lunedÃ¬ mattina' â e la nostra AI (GPT-4o Mini) capisce esattamente quando inviare." }
  ];
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  return (
    <section id="faq" className="py-24 bg-background">
      <div className="max-w-3xl mx-auto px-6">
        <h2 className="text-4xl font-bold text-text-primary mb-12 text-center">Domande Frequenti</h2>
        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <button className="w-full px-6 py-5 text-left font-semibold flex justify-between items-center focus:outline-none" onClick={() => setOpenIndex(openIndex === i ? null : i)}>
                {faq.q}<ChevronDown className={cn("w-5 h-5 text-gray-400 transition-transform duration-300", openIndex === i && "rotate-180")} />
              </button>
              <div className={cn("px-6 overflow-hidden transition-all duration-300 ease-in-out", openIndex === i ? "max-h-40 pb-5 opacity-100" : "max-h-0 opacity-0")}><p className="text-text-secondary text-sm leading-relaxed">{faq.a}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// âââ FOOTER âââ
function Footer() {
  return (
    <footer className="bg-text-primary text-white rounded-t-[4rem] pt-20 pb-10 px-6 mt-20">
      <div className="max-w-5xl mx-auto flex flex-col items-center text-center">
        <div className="flex items-center gap-2 font-bold text-2xl tracking-tight mb-4"><Calendar className="w-8 h-8 text-primary" /><span>WhatsLater</span></div>
        <p className="text-gray-400 mb-12">Scrivi ora, invia dopo.</p>
        <div className="flex flex-wrap justify-center gap-8 text-sm font-medium text-gray-300 mb-16">
          <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
          <a href="#" className="hover:text-white transition-colors">Termini di Servizio</a>
          <a href="mailto:hello@whatslater.com" className="hover:text-white transition-colors">Contatti</a>
        </div>
        <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full text-xs font-medium mb-8"><div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div> Sistema Operativo</div>
        <div className="text-xs text-gray-500 space-y-2"><p>Made in Italy IT &middot; Hosted on EU servers</p><p>Copyright &copy; 2026 WhatsLater</p></div>
      </div>
    </footer>
  );
}
