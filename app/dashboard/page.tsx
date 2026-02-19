// @ts-nocheck
'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import React from 'react'

// ─── AUTH HELPERS ─────────────────────────────────────────────────────────────
// P5: Sessione basata su numero WhatsApp (phone_number) salvato in localStorage.
// Quando l'utente si connette, il suo phone viene salvato → autenticazione leggera.
// Logout = cancella localStorage + ricarica pagina.
// I dati in dashboard vengono filtrati PER PHONE, isolamento garantito lato server.

const PHONE_KEY = 'sw_phone';
const getStoredPhone = () => (typeof window !== 'undefined' ? localStorage.getItem(PHONE_KEY) || '' : '');
const savePhone = (p: string) => { if (p) localStorage.setItem(PHONE_KEY, p); };
const clearPhone = () => { localStorage.removeItem(PHONE_KEY); };

export default function DashboardPage() {
  const [status, setStatus] = useState('disconnected')
  const [qrCode, setQrCode] = useState(null)
  const [pairingCode, setPairingCode] = useState(null)
  const [instanceName] = useState('SchedWhats-Primary')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const refreshTimer = useRef(null)
  const [messages, setMessages] = useState([])
  const [messagesLoading, setMessagesLoading] = useState(true)
  const msgTimer = useRef(null)
  const [subscription, setSubscription] = useState({ status: 'unknown', trial_ends_at: null, expired: false })
  const [userPhone, setUserPhone] = useState('')

  // Carica dal localStorage all'avvio
  useEffect(() => {
    const saved = getStoredPhone();
    if (saved) setUserPhone(saved);
  }, []);

  const fetchMessages = useCallback(async (phone?: string) => {
    const ph = phone || userPhone || getStoredPhone();
    if (!ph) { setMessagesLoading(false); return; }
    try {
      const res = await fetch('/api/messages?phone=' + encodeURIComponent(ph));
      if (res.status === 403) {
        const err = await res.json();
        setSubscription({ status: err.subscription_status || 'expired', trial_ends_at: err.trial_ends_at, expired: true });
        setMessages([]); return;
      }
      if (res.ok) {
        const d = await res.json();
        if (d.messages) {
          setMessages(Array.isArray(d.messages) ? d.messages : []);
          setSubscription({ status: d.subscription_status || 'unknown', trial_ends_at: d.trial_ends_at, expired: false });
        } else setMessages(Array.isArray(d) ? d : []);
      }
    } catch(e) { /* ignore */ }
    finally { setMessagesLoading(false); }
  }, [userPhone]);

  useEffect(() => {
    checkStatus();
    fetchMessages();
    msgTimer.current = setInterval(() => fetchMessages(), 30000);
    return () => { if(refreshTimer.current) clearInterval(refreshTimer.current); if(msgTimer.current) clearInterval(msgTimer.current); };
  }, [fetchMessages]);

  // P5: Logout — cancella phone e torna allo stato iniziale
  const handleLogout = () => {
    clearPhone();
    setUserPhone('');
    setMessages([]);
    setStatus('disconnected');
    setQrCode(null);
    setPairingCode(null);
    setSubscription({ status:'unknown', trial_ends_at:null, expired:false });
    if(refreshTimer.current) clearInterval(refreshTimer.current);
    if(msgTimer.current) clearInterval(msgTimer.current);
  };

  const handleCancel = async (id) => {
    try {
      await fetch('/api/messages', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id, status:'cancelled', phone: userPhone }) });
      fetchMessages();
    } catch(e) {}
  };

  const handleDelete = async (id) => {
    try {
      await fetch('/api/messages', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id, phone: userPhone }) });
      fetchMessages();
    } catch(e) {}
  };

  const checkStatus = async () => {
    try {
      const res = await fetch('/api/connect', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'status', instanceName }) });
      const r = await res.json();
      if (r.success) {
        const st = (r.data?.status||'').toLowerCase();
        if (st==='open'||st==='connected') { setStatus('connected'); setQrCode(null); setPairingCode(null); if(refreshTimer.current) clearInterval(refreshTimer.current); }
      }
    } catch(e) {}
  };

  const handleGetCode = async () => {
    setIsLoading(true); setError(null);
    try {
      const res = await fetch('/api/connect', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'getCode', instanceName }) });
      const r = await res.json();
      if (r.success && r.data) {
        setStatus('connecting');
        if (r.data.qrCode) { const q=r.data.qrCode; setQrCode(q.startsWith('data:') ? q : 'data:image/png;base64,'+q); }
        if (r.data.pairingCode) setPairingCode(r.data.pairingCode);
        if(refreshTimer.current) clearInterval(refreshTimer.current);
        refreshTimer.current = setInterval(async () => {
          try {
            const sr = await fetch('/api/connect', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'status', instanceName }) });
            const s = await sr.json();
            const st = (s.data?.status||'').toLowerCase();
            if (st==='open'||st==='connected') {
              setStatus('connected'); setQrCode(null); setPairingCode(null);
              if(refreshTimer.current) clearInterval(refreshTimer.current);
              // P5: quando connesso, carica messaggi per il phone attuale
              fetchMessages();
              return;
            }
            const rr = await fetch('/api/connect', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'getCode', instanceName }) });
            const rRes = await rr.json();
            if (rRes.success && rRes.data?.qrCode) { const q=rRes.data.qrCode; setQrCode(q.startsWith('data:') ? q : 'data:image/png;base64,'+q); }
          } catch(e) {}
        }, 20000);
      } else setError(r.error||'Failed to get QR code');
    } catch(e) { setError('Connection failed.'); }
    finally { setIsLoading(false); }
  };

  const handleDisconnect = async () => {
    try { await fetch('/api/connect', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'disconnect', instanceName }) }); } catch(e) {}
    setStatus('disconnected'); setQrCode(null); setPairingCode(null);
    if(refreshTimer.current) clearInterval(refreshTimer.current);
  };

  const C = React.createElement;
  const statusColors = { pending:'bg-yellow-100 text-yellow-800', sent:'bg-green-100 text-green-800', failed:'bg-red-100 text-red-800', cancelled:'bg-gray-100 text-gray-600' };
  const connColors = { disconnected:'bg-red-100 text-red-700', connecting:'bg-orange-100 text-orange-700', connected:'bg-green-100 text-green-700' };
  const fmt = d => { try { return new Date(d).toLocaleString('it-IT',{ timeZone:'Europe/Rome' }); } catch(e) { return d; } };
  const trunc = (s,n) => (!s?'':s.length>n?s.substring(0,n)+'...':s);
  const getDaysLeft = () => !subscription.trial_ends_at ? 0 : Math.max(0, Math.ceil((new Date(subscription.trial_ends_at).getTime()-Date.now())/86400000));

  // P5: se non c'è phone, mostra prompt per inserirlo manualmente
  const renderPhonePrompt = () => {
    if (userPhone) return null;
    return C('div', { className:'bg-yellow-50 border border-yellow-200 rounded-2xl p-4 mb-6' },
      C('p', { className:'text-sm text-yellow-700 mb-2' }, 'Inserisci il tuo numero WhatsApp per vedere i tuoi messaggi:'),
      C('div', { className:'flex gap-2' },
        C('input', { type:'text', placeholder:'es. 393401234567', className:'flex-1 px-3 py-2 border rounded-xl text-sm', id:'phone-input-manual' }),
        C('button', {
          onClick: () => {
            const v = document.getElementById('phone-input-manual')?.value?.trim();
            if (v) { savePhone(v); setUserPhone(v); fetchMessages(v); }
          },
          className:'px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium'
        }, 'Carica')
      )
    );
  };

  const renderBanner = () => {
    if (subscription.expired) return C('div', { className:'bg-red-50 border border-red-200 rounded-2xl p-4 mb-6' },
      C('div', { className:'flex items-center justify-between' },
        C('div', null, C('p', { className:'font-semibold text-red-700' }, 'Trial Scaduto'), C('p', { className:'text-sm text-red-600' }, 'Il tuo periodo di prova è terminato. Abbonati per continuare.')),
        C('a', { href:'#payment', className:'px-4 py-2 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 text-sm' }, 'Abbonati — €1.99/mese')
      )
    );
    if (subscription.status==='trial' && subscription.trial_ends_at) {
      const days = getDaysLeft();
      return C('div', { className:'bg-blue-50 border border-blue-200 rounded-2xl p-3 mb-6 flex items-center justify-between' },
        C('p', { className:'text-sm text-blue-700' }, 'Trial gratuito: '+days+' giorn'+(days!==1?'i':'o')+' rimanent'+(days!==1?'i':'e')),
        C('a', { href:'#payment', className:'text-sm text-blue-600 underline' }, 'Upgrade')
      );
    }
    if (subscription.status==='active') return C('div', { className:'bg-green-50 border border-green-200 rounded-2xl p-3 mb-6' }, C('p', { className:'text-sm text-green-700' }, '✅ Abbonamento attivo'));
    return null;
  };

  const renderMessages = () => {
    if (!userPhone) return C('div', { className:'bg-white rounded-3xl shadow-sm border border-gray-100 p-12 text-center' }, C('p', { className:'text-gray-500' }, 'Inserisci il tuo numero per vedere i messaggi.'));
    if (subscription.expired) return C('div', { className:'bg-white rounded-3xl shadow-sm border border-gray-100 p-12 text-center' }, C('p', { className:'text-gray-500' }, 'Messaggi bloccati. Abbonati per continuare.'));
    if (messagesLoading) return C('div', { className:'bg-white rounded-3xl shadow-sm border border-gray-100 p-12 text-center' }, C('p', { className:'text-gray-400 animate-pulse' }, 'Caricamento...'));
    if (messages.length===0) return C('div', { className:'bg-white rounded-3xl shadow-sm border border-gray-100 p-12 text-center' }, C('p', { className:'text-gray-500' }, status==='connected' ? 'Nessun messaggio. Invia una vCard a Note to Self!' : 'Connetti WhatsApp per iniziare.'));
    return C('div', { className:'space-y-3' }, ...messages.map(msg =>
      C('div', { key:msg.id, className:'bg-white rounded-2xl shadow-sm border border-gray-100 p-5' },
        C('div', { className:'flex items-start justify-between gap-4' },
          C('div', { className:'flex-1 min-w-0' },
            C('div', { className:'flex items-center gap-2 mb-1' },
              C('span', { className:'font-medium text-gray-900 truncate' }, (msg.recipient_name||msg.recipient_number||'?') + (msg.recipient_name && msg.recipient_number ? ' ('+msg.recipient_number+')' : '')),
              C('span', { className:'px-2 py-0.5 rounded-full text-xs font-medium '+(statusColors[msg.status]||'bg-gray-100 text-gray-600') }, msg.status)
            ),
            C('p', { className:'text-sm text-gray-700 mb-1 font-medium' }, trunc(msg.parsed_message||'',100)),
            msg.caption && msg.caption !== msg.parsed_message ? C('p', { className:'text-xs text-gray-400 mb-1' }, 'Originale: '+trunc(msg.caption,60)) : null,
            C('p', { className:'text-xs text-gray-400' }, '📅 '+fmt(msg.scheduled_at))
          ),
          C('div', { className:'flex gap-2 flex-shrink-0' },
            msg.status==='pending' ? C('button', { onClick:()=>handleCancel(msg.id), className:'px-3 py-1.5 text-xs font-medium rounded-lg border border-orange-200 text-orange-700 hover:bg-orange-50' }, 'Annulla') : null,
            C('button', { onClick:()=>handleDelete(msg.id), className:'px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-700 hover:bg-red-50' }, 'Elimina')
          )
        )
      )
    ));
  };

  return C('div', { className:'min-h-screen bg-gray-50' },
    C('header', { className:'bg-white border-b border-gray-200 sticky top-0 z-10' },
      C('div', { className:'max-w-5xl mx-auto px-4 h-16 flex items-center justify-between' },
        C('h1', { className:'text-xl font-bold text-gray-900' }, 'SchedWhats'),
        C('div', { className:'flex items-center gap-3' },
          userPhone ? C('span', { className:'text-xs text-gray-400 hidden sm:block' }, userPhone) : null,
          C('span', { className:'px-3 py-1.5 rounded-full text-sm font-medium border '+(connColors[status]||'') }, status),
          // P5: pulsante logout
          userPhone ? C('button', {
            onClick: handleLogout,
            className:'px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50'
          }, 'Logout') : null
        )
      )
    ),
    C('main', { className:'max-w-5xl mx-auto px-4 py-8' },
      renderBanner(),
      renderPhonePrompt(),
      C('div', { className:'grid grid-cols-1 lg:grid-cols-3 gap-8' },
        C('div', { className:'lg:col-span-1' },
          C('div', { className:'bg-white rounded-3xl shadow-sm border border-gray-100 p-8' },
            C('h2', { className:'text-xl font-semibold text-gray-900 mb-6' }, 'Connetti WhatsApp'),
            status==='connected'
              ? C('div', { className:'text-center py-8' },
                  C('div', { className:'text-5xl mb-4' }, '✅'),
                  C('h3', { className:'text-lg font-semibold text-green-700 mb-4' }, 'Connesso!'),
                  C('button', { onClick:handleDisconnect, className:'px-4 py-2 text-sm border rounded-xl hover:bg-gray-50' }, 'Disconnetti')
                )
              : C('div', { className:'space-y-5' },
                  qrCode ? C('div', { className:'border-2 border-green-100 rounded-2xl p-6 text-center' },
                    C('p', { className:'text-sm text-gray-500 mb-4' }, 'Scannerizza con WhatsApp'),
                    C('img', { src:qrCode, alt:'QR Code', className:'w-56 h-56 mx-auto rounded-xl' }),
                    C('p', { className:'text-xs text-green-600 mt-2 animate-pulse' }, 'Auto-refresh ogni 20s...')
                  ) : null,
                  pairingCode ? C('div', { className:'bg-green-50 border border-green-200 rounded-2xl p-6 text-center' },
                    C('p', { className:'text-sm text-gray-600 mb-3' }, 'Codice pairing:'),
                    C('div', { className:'text-3xl font-bold text-green-700 font-mono tracking-widest' }, pairingCode)
                  ) : null,
                  error ? C('div', { className:'bg-red-50 border border-red-200 rounded-xl p-4 text-center text-sm text-red-600' }, error) : null,
                  C('button', { onClick:handleGetCode, disabled:isLoading, className:'w-full h-14 text-lg font-semibold rounded-2xl bg-green-600 text-white hover:bg-green-700 disabled:opacity-50' },
                    isLoading ? 'Generazione...' : qrCode ? 'Aggiorna QR' : 'Ottieni Codice'
                  )
                )
          ),
          C('div', { className:'mt-6 bg-white rounded-3xl shadow-sm border border-gray-100 p-6' },
            C('h3', { className:'font-semibold text-gray-900 mb-3' }, 'Come funziona'),
            C('ol', { className:'text-sm text-gray-500 space-y-1 list-decimal list-inside' },
              C('li', null, 'Clicca Ottieni Codice'),
              C('li', null, 'Scannerizza il QR con WhatsApp'),
              C('li', null, 'In Note to Self: invia una vCard, poi scrivi "ciao fra 5 minuti"'),
              C('li', null, 'Il messaggio viene schedulato automaticamente!')
            )
          )
        ),
        C('div', { className:'lg:col-span-2' },
          C('div', { className:'flex items-center justify-between mb-6' },
            C('h2', { className:'text-xl font-semibold text-gray-900' }, 'Messaggi Schedulati'),
            C('span', { className:'text-xs text-gray-400' }, messages.length+' messagg'+(messages.length!==1?'i':'io'))
          ),
          renderMessages()
        )
      )
    )
  );
  }
