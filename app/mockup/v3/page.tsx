'use client';

import React from 'react';
import { Calendar, LogOut, Mail } from 'lucide-react';

export const dynamic = 'force-static';

const SAMPLE_PHONE = '393481234567';
const SAMPLE_TRIAL_DAYS = 4;
const SAMPLE_MESSAGES_TODAY = 2;
const SAMPLE_DAILY_LIMIT = 3;
const SAMPLE_MESSAGES = [
  {
    id: '1',
    recipient_name: 'Capitano U12',
    recipient_number: '393331111111',
    parsed_message:
      'Convocazione partita oggi 15:00 al campo Bovisa. Ritrovo 14:30 davanti agli spogliatoi.',
    scheduled_at: '2026-05-22T07:00:00Z',
    status: 'pending',
  },
  {
    id: '2',
    recipient_name: 'Mario Idraulico',
    recipient_number: '393332222222',
    parsed_message:
      'Ciao Mario, oggi siamo al cantiere di Via Roma alle 8. Porta la chiave inglese 12 mm.',
    scheduled_at: '2026-05-25T05:30:00Z',
    status: 'pending',
  },
];

function formatScheduled(scheduledAt: string): string {
  const target = new Date(scheduledAt);
  const hh = target.getHours().toString().padStart(2, '0');
  const mm = target.getMinutes().toString().padStart(2, '0');
  const dd = target.getDate().toString().padStart(2, '0');
  const mo = (target.getMonth() + 1).toString().padStart(2, '0');
  return `${dd}/${mo} ${hh}:${mm}`;
}

function MockNavbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200 px-4 md:px-6 py-3">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-lg tracking-tight text-text-primary">
          <Calendar className="w-5 h-5 text-primary" />
          <span>WhatsLater</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            Connesso
          </span>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-gray-200 hover:bg-gray-50 transition-colors text-text-primary">
            <LogOut className="w-3.5 h-3.5" /> Disconnetti
          </button>
        </div>
      </div>
    </nav>
  );
}

export default function MockupV3Page() {
  return (
    <div className="min-h-screen bg-background text-text-primary font-sans pb-16">
      <MockNavbar />

      {/* Status mini-strip */}
      <div className="max-w-4xl mx-auto px-4 pt-20 pb-2">
        <p className="text-xs text-text-secondary">
          ✓ Connesso · +{SAMPLE_PHONE} · Trial {SAMPLE_TRIAL_DAYS}gg
        </p>
      </div>

      {/* Hero CTA */}
      <div className="max-w-4xl mx-auto px-4 mb-8">
        <div className="bg-gradient-to-br from-primary to-primary-hover text-white rounded-3xl p-12 shadow-2xl text-center">
          <Mail className="w-12 h-12 mx-auto mb-4 opacity-90" />
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">
            Programma il prossimo messaggio
          </h2>
          <p className="text-white/80 mb-6 max-w-md mx-auto">
            Scegli il contatto, l&apos;orario, il testo. WhatsLater lo invia dal tuo numero al
            momento giusto.
          </p>
          <button className="bg-white text-primary px-8 py-3 rounded-xl font-bold text-lg shadow-lg hover:scale-105 transition-transform">
            Inizia adesso →
          </button>
        </div>
      </div>

      {/* Daily cap inline */}
      <p className="max-w-4xl mx-auto px-4 text-sm text-center text-text-secondary mb-6">
        Oggi hai schedulato {SAMPLE_MESSAGES_TODAY} messaggi ✓ (limite Free:{' '}
        {SAMPLE_DAILY_LIMIT}) ·
        <a href="#" className="text-primary font-semibold ml-1">
          Sblocca 20 con Personal →
        </a>
      </p>

      {/* Lista messaggi snella */}
      <div className="max-w-4xl mx-auto px-4">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
          Prossimi messaggi
        </h3>
        {SAMPLE_MESSAGES.map((msg) => (
          <div
            key={msg.id}
            className="flex items-start gap-3 py-3 border-b border-gray-100"
          >
            <Calendar className="w-4 h-4 mt-1 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-primary">
                <span className="font-semibold">{formatScheduled(msg.scheduled_at)}</span>
                {' · '}
                {msg.recipient_name}
              </p>
              <p className="text-sm text-text-secondary mt-0.5 truncate">
                &ldquo;{msg.parsed_message.slice(0, 60)}...&rdquo;
              </p>
            </div>
            <button
              className="text-text-secondary hover:text-red-500 text-xs shrink-0"
              aria-label="Annulla invio"
            >
              [X]
            </button>
          </div>
        ))}
      </div>

      {/* Pricing minimo */}
      <div className="max-w-4xl mx-auto px-4 mt-12 pt-6 border-t border-gray-100 text-center">
        <p className="text-sm text-text-secondary">
          Piano: Trial ·{' '}
          <a href="#" className="text-primary">
            Vedi opzioni
          </a>
        </p>
      </div>
    </div>
  );
}
