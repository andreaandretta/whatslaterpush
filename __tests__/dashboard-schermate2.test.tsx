/**
 * @jest-environment jsdom
 *
 * Dashboard — gruppo "schermate2" (fase 1b): "Riattiva" su un messaggio in
 * pausa con l'orario già passato chiede "Invia ora" / "Scegli un nuovo orario";
 * "Elimina" su un promemoria ricorrente manda la scelta al server.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
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

const bodiesOf = (fn: jest.Mock, method: string) =>
  fn.mock.calls.filter((c: any[]) => c[1]?.method === method).map((c: any[]) => JSON.parse(c[1].body));

const lastFriday = new Date(Date.now() - 4 * 86400_000).toISOString();

describe('Riattiva un messaggio in pausa con l\'orario passato', () => {
  const paused = { id: 'p1', recipient_name: 'Luca', recipient_number: '393334445566', parsed_message: 'Domani alle 9 hai la guida', scheduled_at: lastFriday, status: 'paused' };

  test('asks "Invia ora" / "Scegli un nuovo orario" instead of re-queueing the old time', async () => {
    const fetchFn = mockFetch([paused]);
    await renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Azioni messaggio' }))[0]);
    await act(async () => { fireEvent.click(screen.getByText('Riprendi invio')); });
    const dialog = await screen.findByTestId('time-passed-dialog');
    expect(dialog).toHaveTextContent('già passato');
    expect(within(dialog).getByRole('button', { name: 'Invia ora' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Scegli un nuovo orario' })).toBeInTheDocument();
    // Nessun "riattiva col vecchio orario" partito.
    expect(bodiesOf(fetchFn, 'PATCH')).toEqual([]);
    expect(screen.queryByText('Messaggio riattivato')).not.toBeInTheDocument();
  });

  test('"Invia ora" re-queues it a couple of minutes from now', async () => {
    const fetchFn = mockFetch([paused], { 'PATCH /api/messages': () => ({ status: 200, body: { message: { id: 'p1' } } }) });
    await renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Azioni messaggio' }))[0]);
    await act(async () => { fireEvent.click(screen.getByText('Riprendi invio')); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Invia ora' })); });
    const [body] = bodiesOf(fetchFn, 'PATCH');
    expect(body.id).toBe('p1');
    expect(body.status).toBe('pending');
    // Vale solo per questa volta: una serie non si ri-ancora all'orario di adesso.
    expect(body.keep_recurrence_anchor).toBe(true);
    const at = new Date(body.scheduled_at).getTime();
    expect(at).toBeGreaterThanOrEqual(Date.now() + 60_000);
    expect(at).toBeLessThan(Date.now() + 5 * 60_000);
    await waitFor(() => expect(screen.getByText(/Riattivato — parte tra un paio di minuti/)).toBeInTheDocument());
  });

  test('"Scegli un nuovo orario" opens the edit modal, and saving puts it back in the queue', async () => {
    const fetchFn = mockFetch([paused], { 'PATCH /api/messages': () => ({ status: 200, body: { message: { id: 'p1' } } }) });
    await renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Azioni messaggio' }))[0]);
    await act(async () => { fireEvent.click(screen.getByText('Riprendi invio')); });
    fireEvent.click(await screen.findByRole('button', { name: 'Scegli un nuovo orario' }));
    expect(await screen.findByText('Modifica messaggio')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Invia' })); });
    await waitFor(() => expect(bodiesOf(fetchFn, 'PATCH')).toHaveLength(1));
    const [body] = bodiesOf(fetchFn, 'PATCH');
    expect(body).toMatchObject({ id: 'p1', status: 'pending' });
    expect(new Date(body.scheduled_at).getTime()).toBeGreaterThan(Date.now());
  });

  test('if the server says time_passed (clock skew), the same choice appears and the row stays paused', async () => {
    const soon = { ...paused, scheduled_at: new Date(Date.now() + 10 * 60_000).toISOString() };
    mockFetch([soon], {
      'PATCH /api/messages': () => ({ status: 409, body: { error: 'time_passed', message: 'L\'orario di questo messaggio è già passato: scegli se inviarlo ora o a un nuovo orario.' } }),
    });
    await renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Azioni messaggio' }))[0]);
    await act(async () => { fireEvent.click(screen.getByText('Riprendi invio')); });
    expect(await screen.findByTestId('time-passed-dialog')).toBeInTheDocument();
    expect(screen.queryByText('Messaggio riattivato')).not.toBeInTheDocument();
  });
});

describe('Elimina su un promemoria ricorrente', () => {
  const weekly = { id: 'w1', recipient_name: 'Genitori', recipient_number: '393334445566', parsed_message: 'Catechismo alle 17', scheduled_at: new Date(Date.now() + 2 * 86400_000).toISOString(), status: 'pending', recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU' };

  test('"Solo questa volta" sends scope=occurrence and says when the next one leaves', async () => {
    const next = new Date(Date.now() + 9 * 86400_000);
    next.setHours(17, 0, 0, 0);
    const fetchFn = mockFetch([weekly], { 'DELETE /api/messages': () => ({ status: 200, body: { success: true, skipped_to: next.toISOString() } }) });
    await renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Azioni messaggio' }))[0]);
    fireEvent.click(screen.getByText('Elimina'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Solo questa volta' })); });
    expect(bodiesOf(fetchFn, 'DELETE')).toEqual([{ id: 'w1', scope: 'occurrence' }]);
    await waitFor(() => expect(screen.getByText(/Saltato questa volta — il prossimo parte .*17:00/)).toBeInTheDocument());
  });

  test('"Tutta la serie" sends scope=series and says the series stopped', async () => {
    const fetchFn = mockFetch([weekly], { 'DELETE /api/messages': () => ({ status: 200, body: { success: true } }) });
    await renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Azioni messaggio' }))[0]);
    fireEvent.click(screen.getByText('Elimina'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tutta la serie' })); });
    expect(bodiesOf(fetchFn, 'DELETE')).toEqual([{ id: 'w1', scope: 'series' }]);
    await waitFor(() => expect(screen.getByText('Promemoria ricorrente interrotto — Genitori')).toBeInTheDocument());
  });
});
