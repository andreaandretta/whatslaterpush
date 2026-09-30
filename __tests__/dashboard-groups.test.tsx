/**
 * @jest-environment jsdom
 *
 * Dashboard — gruppi e porta finta: una sola GET /api/feedback per apertura
 * (senza risposta utile nessuna scheda e nessun crash), la scheda sparisce dopo
 * la risposta, e il toast dopo l'eliminazione di un gruppo usa il suo nome.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('../app/components/CalendarSyncCard', () => () => null);
jest.mock('../app/components/InstallPrompt', () => () => null);
jest.mock('../app/components/InstallAppButton', () => () => null);
jest.mock('../app/components/PricingSection', () => () => null);
jest.mock('../app/components/FAQSection', () => () => null);
jest.mock('../app/lib/contacts-client-cache', () => ({ prefetchContacts: jest.fn(), setContactsCacheOwner: jest.fn() }));
jest.mock('../components/ContactPickerModal', () => (p: any) => (p.open ? <div data-testid="contact-picker" /> : null));

import DashboardPage from '../app/dashboard/page';

const JID = '120363000000000001@g.us';

function payload(messages: unknown[]) {
  return { messages, subscription_plan: 'beta', raw_plan: 'free', billing_enabled: false, connection_status: 'open', total_scheduled_lifetime: 5 };
}
const resp = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function mockFetch(messages: unknown[], handlers: Record<string, (init: any) => { status: number; body: unknown }> = {}) {
  const fn = jest.fn(async (url: string, init?: any): Promise<any> => {
    const method = init?.method || 'GET';
    const key = `${method} ${url}`;
    if (url === '/api/auth/me') return resp({ phone: '393331112222', instanceName: 'X' });
    if (handlers[key]) {
      const r = handlers[key](init);
      return resp(r.body, r.status);
    }
    if (url === '/api/messages' && method === 'GET') return resp(payload(messages));
    return resp({});
  });
  (global as any).fetch = fn;
  return fn;
}

async function renderPage() {
  await act(async () => { render(<DashboardPage />); });
}

const callsTo = (fn: jest.Mock, url: string, method = 'GET') =>
  fn.mock.calls.filter((c: any[]) => c[0] === url && (c[1]?.method || 'GET') === method);

const group = (over: Record<string, unknown> = {}) => ({
  id: 'g1', recipient_name: 'Under 12 – Genitori', recipient_number: JID, parsed_message: 'Allenamento alle 17',
  scheduled_at: new Date(Date.now() + 2 * 86400_000).toISOString(), status: 'pending', ...over,
});

afterEach(() => {
  jest.restoreAllMocks();
  try { window.localStorage.clear(); } catch { /* jsdom */ }
});

describe('porta finta dalla dashboard', () => {
  test('/api/feedback che risponde {}: nessuna scheda, nessun crash, una sola chiamata', async () => {
    const fetchFn = mockFetch([group()]);
    await renderPage();
    expect(await screen.findByText('Under 12 – Genitori')).toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchFn, '/api/feedback')).toHaveLength(1));
    expect(screen.queryByTestId('fake-door-calendar')).not.toBeInTheDocument();
  });

  test('/api/feedback in errore: nessuna scheda e la lista resta', async () => {
    const fetchFn = mockFetch([group()], { 'GET /api/feedback': () => ({ status: 500, body: {} }) });
    await renderPage();
    expect(await screen.findByText('Under 12 – Genitori')).toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchFn, '/api/feedback')).toHaveLength(1));
    expect(screen.queryByTestId('fake-door-calendar')).not.toBeInTheDocument();
  });

  test('attiva e senza risposta: la scheda compare; dopo la risposta sparisce e non torna', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    try {
      const fetchFn = mockFetch([group()], {
        'GET /api/feedback': () => ({ status: 200, body: { calendar_photo: { active: true, answered: false } } }),
        'POST /api/feedback': () => ({ status: 200, body: { ok: true } }),
      });
      await renderPage();
      await screen.findByTestId('fake-door-calendar');
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Meno di 10' })); });
      expect(JSON.parse(callsTo(fetchFn, '/api/feedback', 'POST')[0][1].body)).toEqual({ feature: 'calendar_photo', answer: 'lt10' });
      expect(screen.getByText('Grazie! Ci aiuta a decidere.')).toBeInTheDocument();
      await act(async () => { jest.advanceTimersByTime(2600); });
      expect(screen.queryByTestId('fake-door-calendar')).not.toBeInTheDocument();
      // Il giro delle 30 s rilegge i messaggi, non /api/feedback: la scheda non torna.
      await act(async () => { jest.advanceTimersByTime(31_000); });
      expect(screen.queryByTestId('fake-door-calendar')).not.toBeInTheDocument();
      expect(callsTo(fetchFn, '/api/feedback')).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('toast dopo l\'eliminazione di un gruppo', () => {
  test.each([
    ['col nome', group(), 'Eliminato — Under 12 – Genitori'],
    ['senza nome', group({ recipient_name: undefined }), 'Eliminato — Gruppo senza nome'],
  ])('%s', async (_label, row, expected) => {
    mockFetch([row], { 'DELETE /api/messages': () => ({ status: 200, body: { success: true } }) });
    await renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Azioni messaggio' }))[0]);
    await act(async () => { fireEvent.click(screen.getByText('Elimina')); });
    expect(await screen.findByText(expected as string)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('120363');
  });

  test('persona senza nome: toast come prima, col numero senza "+" (regressione)', async () => {
    const person = group({ recipient_name: null, recipient_number: '393331234567' });
    mockFetch([person], { 'DELETE /api/messages': () => ({ status: 200, body: { success: true } }) });
    await renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Azioni messaggio' }))[0]);
    await act(async () => { fireEvent.click(screen.getByText('Elimina')); });
    expect(await screen.findByText('Eliminato — 393331234567')).toBeInTheDocument();
  });
});
