/**
 * @jest-environment jsdom
 *
 * Limiti dei primi giorni visibili (rapporto 360 B3/T7): la striscia in alto
 * dice il numero vero ("Oggi partono 2 messaggi (massimo 5 oggi) · nei primi
 * giorni…") e la
 * finestra del messaggio avvisa in giallo PRIMA di programmare quando il
 * giorno è pieno o il gruppo è troppo grande per i primi giorni.
 * Orologio fermo: sabato 3 ottobre 2026, 12:00 a Roma.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('../app/components/CalendarSyncCard', () => () => null);
jest.mock('../app/components/InstallPrompt', () => () => null);
jest.mock('../app/components/InstallAppButton', () => () => null);
jest.mock('../app/components/PricingSection', () => () => null);
jest.mock('../app/components/FAQSection', () => () => null);
jest.mock('../app/lib/contacts-client-cache', () => ({ prefetchContacts: jest.fn(), setContactsCacheOwner: jest.fn(), getGroupsSnapshot: () => null }));
jest.mock('../components/ContactPickerModal', () => (p: any) => (p.open ? <div data-testid="contact-picker" /> : null));

import DashboardPage from '../app/dashboard/page';
import ScheduleModal from '../components/ScheduleModal';
import type { TodayLimit } from '../app/lib/daily-limit';

const NOW = new Date('2026-10-03T10:00:00Z');
const PAIRED_YESTERDAY = '2026-10-02T09:00:00.000Z';

function todayLimit(over: Partial<TodayLimit> = {}): TodayLimit {
  return { limit: 5, plan_limit: 50, sent: 2, queued: 0, later: 0, later_days: 0, warmup: true, paired_at: PAIRED_YESTERDAY, day: '2026-10-03', ...over };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'] });
  jest.setSystemTime(NOW);
});
afterEach(() => { jest.useRealTimers(); });

// ── Striscia in alto ──

const resp = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function mockFetch(extra: Record<string, unknown>, plan = { subscription_plan: 'beta', billing_enabled: false }) {
  (global as any).fetch = jest.fn(async (url: string, init?: any): Promise<any> => {
    const method = init?.method || 'GET';
    if (url === '/api/auth/me') return resp({ phone: '393331112222', instanceName: 'X' });
    if (url === '/api/messages' && method === 'GET') {
      return resp({ messages: [], ...plan, raw_plan: 'free', connection_status: 'open', total_scheduled_lifetime: 5, ...extra });
    }
    return resp({});
  });
}

async function renderDashboard() {
  await act(async () => { render(<DashboardPage />); });
}

describe('striscia: il numero vero di oggi', () => {
  test('"Oggi partono 2 messaggi (massimo 5 oggi) · nei primi giorni … sale piano piano fino a 50"', async () => {
    mockFetch({ today_limit: todayLimit() });
    await renderDashboard();
    const counter = await screen.findByTestId('daily-counter');
    expect(counter).toHaveTextContent('Oggi partono 2 messaggi (massimo 5 oggi) · nei primi giorni dopo il collegamento il limite è più basso e sale piano piano fino a 50', { normalizeWhitespace: true });
    // Mai "2 di 5" (si leggeva "2 dei miei 5"), mai "sale ogni giorno" (5, 5, 10…).
    expect(counter.textContent).not.toMatch(/\d+ di \d+|ogni giorno|fino a 50 al giorno|schedulato|✓/);
    // Massimo e nota si leggono: grigio chiaro a 13px.
    for (const span of Array.from(counter.querySelectorAll('span'))) {
      expect(span.className).toMatch(/text-\[#AEBAC1\]/);
      expect(span.className).toMatch(/text-\[13px\]/);
    }
  });

  test('coda oltre il limite: "Oggi partono 5 messaggi, il massimo di oggi · altri 10 partiranno da domattina…"', async () => {
    mockFetch({ today_limit: todayLimit({ sent: 0, queued: 15, later: 10, later_days: 2 }) });
    await renderDashboard();
    expect(await screen.findByTestId('daily-counter')).toHaveTextContent(
      'Oggi partono 5 messaggi, il massimo di oggi · altri 10 partiranno da domattina, un po\' alla volta · nei primi giorni dopo il collegamento il limite è più basso e sale piano piano fino a 50',
      { normalizeWhitespace: true },
    );
  });

  test('piano Business nei primi giorni: la striscia compare lo stesso', async () => {
    mockFetch({ today_limit: todayLimit({ sent: 1 }) }, { subscription_plan: 'business', billing_enabled: true });
    await renderDashboard();
    expect(await screen.findByTestId('daily-counter')).toHaveTextContent('Oggi parte 1 messaggio (massimo 5 oggi)');
  });

  test('a regime: "Oggi partono 3 messaggi (fino a 50 al giorno)", senza la nota dei primi giorni', async () => {
    mockFetch({ today_limit: todayLimit({ limit: 50, sent: 3, warmup: false, paired_at: null }) });
    await renderDashboard();
    const counter = await screen.findByTestId('daily-counter');
    expect(counter).toHaveTextContent('Oggi partono 3 messaggi (fino a 50 al giorno)', { normalizeWhitespace: true });
    expect(counter.textContent).not.toMatch(/primi giorni/);
  });
});

// ── Finestra del messaggio ──

const contact = { number: '393331234567', name: 'Mario Rossi' };
const base = { open: true, onClose: () => {}, onBack: () => {}, contact, onScheduled: () => {} };
// Coda di oggi pomeriggio (le 12:30 proposte dalla modale vengono dopo le 12:05).
const queueAt = (n: number, iso = '2026-10-03T10:05:00Z') => Array.from({ length: n }, (_, k) => ({ id: 'q' + k, status: 'pending', scheduled_at: iso }));

describe('avviso giallo prima di programmare', () => {
  test('oggi già mandati 5 messaggi → "Questo partirà domattina: …" (prima quando, poi perché)', () => {
    render(<ScheduleModal {...base} todayLimit={todayLimit({ sent: 5 })} queue={[]} />);
    const w = screen.getByTestId('day-full-warning');
    expect(w).toHaveTextContent('Questo partirà domattina: oggi hai già mandato 5 messaggi, il limite dei primi giorni.');
    expect(w).toHaveAttribute('role', 'status');
    expect(w.className).toMatch(/bg-amber-900\/30/);
    // Si legge: 13px, a sinistra (prima 12px centrati su tre righe).
    expect(w.className).toMatch(/text-\[13px\]/);
    expect(w.className).not.toMatch(/text-xs|text-center/);
  });

  test('la coda di oggi arriva già al limite → "Oggi partono già 5 messaggi…"', () => {
    render(<ScheduleModal {...base} todayLimit={todayLimit({ sent: 2 })} queue={queueAt(3)} />);
    expect(screen.getByTestId('day-full-warning')).toHaveTextContent('Questo partirà domattina: oggi partono già 5 messaggi, il limite dei primi giorni.');
  });

  test('c\'è posto → nessun avviso', () => {
    render(<ScheduleModal {...base} todayLimit={todayLimit({ sent: 2 })} queue={queueAt(2)} />);
    expect(screen.queryByTestId('day-full-warning')).not.toBeInTheDocument();
  });

  test('in modifica il messaggio stesso non conta', () => {
    const queue = queueAt(3);
    render(<ScheduleModal {...base} todayLimit={todayLimit({ sent: 2 })} queue={queue} editMsgId="q0" initialMessage="Allenamento" initialScheduledAt="2026-10-03T10:05:00Z" />);
    expect(screen.queryByTestId('day-full-warning')).not.toBeInTheDocument();
  });

  test('senza il dato del server → nessun avviso (come prima)', () => {
    render(<ScheduleModal {...base} queue={queueAt(20)} />);
    expect(screen.queryByTestId('day-full-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('big-group-warmup-warning')).not.toBeInTheDocument();
  });

  test('gruppo da 60 nei primi giorni → avviso con il giorno in cui partirà', () => {
    const group = { number: '120363000000000001@g.us', name: 'Reparto', kind: 'group' as const, size: 60, hint: null };
    render(<ScheduleModal {...base} contact={group} todayLimit={todayLimit()} queue={[]} />);
    const w = screen.getByTestId('big-group-warmup-warning');
    expect(w).toHaveTextContent('Questo partirà venerdì 9 ottobre, verso le 8: nei primi giorni i gruppi con più di 50 persone aspettano.');
    expect(w.className).toMatch(/text-\[13px\]/);
    expect(w.className).not.toMatch(/text-xs|text-center/);
  });

  test('gruppo da 19 → nessun avviso sul gruppo', () => {
    const group = { number: '120363000000000001@g.us', name: 'Under 12', kind: 'group' as const, size: 19, hint: null };
    render(<ScheduleModal {...base} contact={group} todayLimit={todayLimit()} queue={[]} />);
    expect(screen.queryByTestId('big-group-warmup-warning')).not.toBeInTheDocument();
  });
});
