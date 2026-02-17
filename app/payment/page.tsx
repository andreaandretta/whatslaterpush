// @ts-nocheck
"use client";

import { useState } from 'react';

export default function PaymentPage() {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePayment = async () => {
    setLoading(true);
    const res = await fetch('/api/payment/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    setLoading(false);
  };

  return (
    <div style={{padding: '40px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif'}}>
      <h1>Attiva SchedWhats Pro</h1>
      <p>Trial scaduto? Nessun problema.</p>
      <h2>€1.99/mese</h2>
      <ul>
        <li>Messaggi illimitati</li>
        <li>Supporto prioritario</li>
        <li>Cancellazione quando vuoi</li>
      </ul>
      
      <input
        type="tel"
        placeholder="Il tuo numero WhatsApp (es. 393331234567)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        style={{width: '100%', padding: '10px', margin: '10px 0'}}
      />
      
      <button 
        onClick={handlePayment}
        disabled={loading || phone.length < 10}
        style={{
          width: '100%', 
          padding: '15px', 
          background: loading ? '#ccc' : '#25D366',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer'
        }}
      >
        {loading ? 'Attendi...' : 'Paga con Carta'}
      </button>
    </div>
  );
}
