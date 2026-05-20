'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Calendar, CheckCircle2, LogOut, Mail, Plus,
} from 'lucide-react';

const SAMPLE_PHONE = '393481234567';
const SAMPLE_PLAN_LABEL = 'Trial';
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
  {
    id: '3',
    recipient_name: 'Maria Tutor',
    recipient_number: '393333333333',
    parsed_message: 'Buongiorno, lezione di stasera confermata ore 18:00. A presto.',
    scheduled_at: '2026-05-21T16:00:00Z',
    status: 'pending',
  },
  {
    id: '4',
    recipient_name: 'Squadra Allenamento',
    recipient_number: '393334444444',
    parsed_message: 'Allenamento spostato a giovedì stessa ora. Confermate presenza.',
    scheduled_at: '2026-05-23T17:00:00Z',
    status: 'pending',
  },
  {
    id: '5',
    recipient_name: 'Giuseppe Elettricista',
    recipient_number: '393335555555',
    parsed_message: 'Domani 9:00 cantiere via Garibaldi. Porta scala estensibile.',
    scheduled_at: '2026-05-22T07:00:00Z',
    status: 'pending',
  },
];

function formatScheduledDate(target: Date): string {
  const now = new Date('2026-05-21T08:00:00Z');
  const hh = target.getHours().toString().padStart(2, '0');
  const mm = target.getMinutes().toString().padStart(2, '0');
  const time = `${hh}:${mm}`;

  const sameDay = target.toDateString() === now.toDateString();
  if (sameDay) return `Oggi ${time}`;

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (target.toDateString() === tomorrow.toDateString()) return `Domani ${time}`;

  const targetMidnight = new Date(target);
  targetMidnight.setHours(0, 0, 0, 0);
  const nowMidnight = new Date(now);
  nowMidnight.setHours(0, 0, 0, 0);
  const diffDays = Math.floor(
    (targetMidnight.getTime() - nowMidnight.getTime()) / 86400000,
  );
  if (diffDays > 0 && diffDays < 7) {
    const days = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
    return `${days[target.getDay()]} ${time}`;
  }

  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const dd = target.getDate();
  return `${dd} ${months[target.getMonth()]} ${time}`;
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

export default function MockupV4Page() {
  return (
    <Suspense fallback={null}>
      <MockupV4Content />
    </Suspense>
  );
}

function MockupV4Content() {
  const searchParams = useSearchParams();
  const empty = searchParams?.get('empty') === 'true';
  const messages = empty ? [] : SAMPLE_MESSAGES;

  return (
    <div className="min-h-screen bg-background text-text-primary font-sans pb-32">
      <MockNavbar />

      {/* Status strip — condensed */}
      <div className="max-w-4xl mx-auto px-4 pt-20 pb-3 flex items-center justify-between flex-wrap gap-2 border-b border-gray-100">
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
          <span className="text-text-secondary">Connesso +{SAMPLE_PHONE}</span>
          <span className="text-gray-300">·</span>
          <span className="text-text-secondary">
            {SAMPLE_PLAN_LABEL} {SAMPLE_TRIAL_DAYS}gg
          </span>
          <span className="text-gray-300">·</span>
          <span className="text-text-primary font-medium">
            Hai schedulato {SAMPLE_MESSAGES_TODAY} messaggi oggi ✓
          </span>
          <span className="text-gray-400 text-xs">
            (limite {SAMPLE_DAILY_LIMIT})
          </span>
        </div>
        <a href="#" className="text-primary text-xs font-semibold shrink-0">
          Sblocca 20 con Personal →
        </a>
      </div>

      {empty ? (
        /* Empty state — guided onboarding */
        <div className="max-w-4xl mx-auto px-4 py-12 text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Calendar className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold mb-2 text-text-primary">
            Nessun messaggio programmato
          </h2>
          <p className="text-text-secondary mb-6 max-w-md mx-auto">
            Programma il tuo primo messaggio. Esempio: &ldquo;Convocazione allenamento di
            sabato&rdquo; da inviare domani mattina alle 9.
          </p>
          <button className="bg-primary text-white px-6 py-3 rounded-xl font-semibold inline-flex items-center gap-2 hover:bg-primary-hover transition-colors">
            <Mail className="w-4 h-4" />
            Inizia adesso
          </button>
        </div>
      ) : (
        /* Protagonist list — dense */
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-bold text-text-primary">Prossimi messaggi</h2>
            <span className="text-xs text-text-secondary">
              {messages.length} programmati
            </span>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100">
            {messages.map((msg) => {
              const date = new Date(msg.scheduled_at);
              const dateLabel = formatScheduledDate(date);
              return (
                <div
                  key={msg.id}
                  className="flex items-start gap-3 p-4 hover:bg-gray-50 transition-colors first:rounded-t-2xl last:rounded-b-2xl"
                >
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
                    {msg.recipient_name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-semibold text-sm truncate text-text-primary">
                        {msg.recipient_name}
                      </p>
                      <span className="text-xs text-text-secondary shrink-0 font-medium">
                        {dateLabel}
                      </span>
                    </div>
                    <p className="text-sm text-text-secondary mt-1 line-clamp-2">
                      {msg.parsed_message}
                    </p>
                  </div>
                  <button
                    className="text-gray-300 hover:text-red-500 shrink-0 text-xs pt-1 transition-colors"
                    aria-label="Annulla"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pricing context-aware */}
      <div className="max-w-4xl mx-auto px-4 mt-8 pt-6 border-t border-gray-100 text-center">
        <p className="text-sm text-text-secondary">
          Sei sul piano {SAMPLE_PLAN_LABEL} ·{' '}
          <a href="#" className="text-primary font-semibold">
            Vedi piani disponibili →
          </a>
        </p>
      </div>

      {/* FAB — only when there are messages (empty state has inline CTA) */}
      {!empty && (
        <>
          {/* Desktop / tablet: pill FAB with label */}
          <button className="hidden sm:flex fixed bottom-6 right-6 bg-primary text-white rounded-full shadow-2xl px-6 py-4 items-center gap-2 font-semibold hover:scale-105 transition-transform z-30">
            <Mail className="w-5 h-5" />
            Manda messaggio
          </button>
          {/* Mobile: round FAB with plus icon */}
          <button
            className="sm:hidden fixed bottom-6 right-6 w-14 h-14 bg-primary text-white rounded-full shadow-2xl flex items-center justify-center hover:scale-105 transition-transform z-30"
            aria-label="Manda messaggio"
          >
            <Plus className="w-6 h-6" />
          </button>
        </>
      )}
    </div>
  );
}
