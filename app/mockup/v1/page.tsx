'use client';

import React from 'react';
import {
  ArrowRight, Calendar, CheckCircle2, LogOut, Mail, Trash2,
} from 'lucide-react';

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

function formatScheduled(scheduledAt: string): { date: string; time: string } {
  const target = new Date(scheduledAt);
  const hh = target.getHours().toString().padStart(2, '0');
  const mm = target.getMinutes().toString().padStart(2, '0');
  const dd = target.getDate().toString().padStart(2, '0');
  const mo = (target.getMonth() + 1).toString().padStart(2, '0');
  return { date: `${dd}/${mo}`, time: `${hh}:${mm}` };
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

export default function MockupV1Page() {
  return (
    <div className="min-h-screen bg-background text-text-primary font-sans pb-16">
      <MockNavbar />

      {/* Status strip */}
      <div className="max-w-4xl mx-auto px-4 pt-20 pb-3">
        <p className="text-sm text-text-secondary flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-primary" />
          Connesso +{SAMPLE_PHONE} · Piano Trial · {SAMPLE_TRIAL_DAYS} giorni rimanenti
        </p>
      </div>

      {/* CTA Card */}
      <div className="max-w-4xl mx-auto px-4 mb-6">
        <button className="w-full bg-primary text-white rounded-2xl p-6 flex items-center justify-between shadow-lg hover:bg-primary-hover transition-colors">
          <span className="text-xl font-bold flex items-center gap-3">
            <Mail className="w-6 h-6" />
            Manda messaggio
          </span>
          <ArrowRight className="w-6 h-6" />
        </button>
      </div>

      {/* Daily cap badge */}
      <div className="max-w-4xl mx-auto px-4 mb-6">
        <div className="flex items-center justify-between rounded-xl px-4 py-3 border border-gray-200 bg-white">
          <p className="text-sm text-text-primary">
            Hai schedulato <strong>{SAMPLE_MESSAGES_TODAY}</strong> messaggi oggi ✓
            <span className="text-text-secondary">
              {' '}— Limite Trial: {SAMPLE_DAILY_LIMIT}/giorno
            </span>
          </p>
          <a href="#" className="text-xs font-semibold text-primary hover:underline shrink-0 ml-3">
            Sblocca 20 con Personal →
          </a>
        </div>
      </div>

      {/* Messages section */}
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-text-primary">Messaggi programmati</h2>
          <span className="text-sm text-text-secondary bg-white px-3 py-1 rounded-full border border-gray-100">
            {SAMPLE_MESSAGES.length} messaggi
          </span>
        </div>
        <div className="space-y-2">
          {SAMPLE_MESSAGES.map((msg) => {
            const sched = formatScheduled(msg.scheduled_at);
            return (
              <div
                key={msg.id}
                className="flex items-center gap-3 p-3 rounded-xl bg-white border border-gray-100 shadow-sm"
              >
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0">
                  {msg.recipient_name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-text-primary truncate">
                      {msg.recipient_name}
                    </div>
                    <div className="text-xs shrink-0 text-text-secondary">{sched.date}</div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-text-secondary truncate">
                      {msg.parsed_message.substring(0, 60)}
                    </div>
                    <div className="text-xs text-text-secondary flex items-center gap-1.5 shrink-0">
                      <span>{sched.time}</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    </div>
                  </div>
                </div>
                <button
                  className="p-2 text-gray-400 hover:text-red-400 transition-colors"
                  aria-label="Annulla invio"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pricing context-aware */}
      <div className="max-w-4xl mx-auto px-4 mt-8">
        <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between">
          <span className="text-sm text-text-primary">Sei sul piano Trial</span>
          <a href="#" className="text-primary text-sm font-semibold">
            Vedi piani disponibili →
          </a>
        </div>
      </div>
    </div>
  );
}
