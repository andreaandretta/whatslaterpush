/**
 * @jest-environment jsdom
 *
 * Dashboard (gruppo "schermate"): i flussi reali dietro ai bottoni.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
// Pezzi della pagina non coinvolti: stub per tenere il test sul flusso.
jest.mock('../app/components/CalendarSyncCard', () => () => null);
jest.mock('../app/components/InstallPrompt', () => () => null);
jest.mock('../app/components/InstallAppButton', () => () => null);
jest.mock('../app/components/PricingSection', () => () => null);
jest.mock('../app/components/FAQSection', () => () => null);
jest.mock('../app/lib/contacts-client-cache', () => ({ prefetchContacts: jest.fn(), setContactsCacheOwner: jest.fn() }));
jest.mock('../components/ContactPickerModal', () => (p: any) => (p.open ? <div data-testid="contact-picker" /> : null));

import DashboardPage from '../app/dashboard/page';

const past = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
const EXISTS_FALSE = 'HTTP 400: {"status":400,"error":"Bad Request","response":{"message":[{"jid":"393334445566@s.whatsapp.net","exists":false,"number":"393334445566"}]}}';

function payload(messages: unknown[], connection_status = 'open') {
  return { messages, subscription_plan: 'beta', raw_plan: 'free', billing_enabled: false, connection_status, total_scheduled_lifetime: 5 };
}

// jsdom non ha Response: basta la forma che la pagina usa.
const resp = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function mockFetch(messages: unknown[], handlers: Record<string, (init: any) => { status: number; body: unknown }> = {}, connection = 'open') {
  const fn = jest.fn(async (url: string, init?: any): Promise<any> => {
    const method = init?.method || 'GET';
    const key = `${method} ${url}`;
    if (url === '/api/auth/me') return resp({ phone: '393331112222', instanceName: 'X' });
    if (handlers[key]) {
      const r = handlers[key](init);
      return resp(r.body, r.status);
    }
    if (url === '/api/messages' && method === 'GET') return resp(payload(messages, connection));
    return resp({});
  });
  (global as any).fetch = fn;
  return fn;
}

async function renderPage() {
  await act(async () => { render(<DashboardPage />); });
}

describe('Elimina su una card rossa', () => {
  test('the "Eliminato" toast appears only after the server confirmed', async () => {
    const failed = { id: 'f1', recipient_name: 'Mario', recipient_number: '393334445566', parsed_message: 'Ciao', scheduled_at: past, status: 'failed', error_message: EXISTS_FALSE };
    let resolveDelete: (v: any) => void = () => {};
    const fetchFn = mockFetch([failed]);
    const base = fetchFn.getMockImplementation()!;
    fetchFn.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'DELETE') return new Promise((r) => { resolveDelete = r; });
      return base(url, init);
    });
    await renderPage();
    await waitFor(() => expect(screen.getByText('Non inviati')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'Azioni messaggio' })[0]);
    fireEvent.click(screen.getByText('Elimina'));
    expect(screen.queryByText(/Eliminato/)).not.toBeInTheDocument();
    await act(async () => { resolveDelete(resp({ success: true })); });
    await waitFor(() => expect(screen.getByText('Eliminato — Mario')).toBeInTheDocument());
  });
});

describe('Duplica', () => {
  test('a sent message with a PDF reopens WITH the PDF', async () => {
    const sent = { id: 's1', recipient_name: 'Genitori', recipient_number: '393334445566', parsed_message: 'Orari', scheduled_at: past, status: 'sent', media_type: 'document', media_url: '393331112222/uuid-orari.pdf', media_filename: 'orari.pdf' };
    mockFetch([sent]);
    await renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Inviati/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Azioni messaggio' })[0]);
    fireEvent.click(screen.getByText('Duplica'));
    expect(await screen.findByText(/Messaggio per Genitori/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('orari.pdf');
  });
});

describe('Numero non su WhatsApp', () => {
  test('"Scegli un altro contatto" opens the picker (no retry)', async () => {
    const failed = { id: 'f1', recipient_name: 'Mario', recipient_number: '393334445566', parsed_message: 'Ciao', scheduled_at: past, status: 'failed', error_message: EXISTS_FALSE };
    mockFetch([failed]);
    await renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Scegli un altro contatto/ }));
    expect(screen.getByTestId('contact-picker')).toBeInTheDocument();
  });
});

describe('Posticipa su un messaggio in pausa', () => {
  test('the toast says it stays paused (it used to say "Posticipato" and the message never left)', async () => {
    const sched = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    sched.setHours(18, 0, 0, 0);
    const paused = { id: 'p1', recipient_name: 'Mario', recipient_number: '393334445566', parsed_message: 'Ciao', scheduled_at: sched.toISOString(), status: 'paused' };
    const fetchFn = mockFetch([paused], { 'PATCH /api/messages': () => ({ status: 200, body: { message: { id: 'p1' } } }) });
    await renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Azioni messaggio' }))[0]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+1 ora' })); });
    const patch = fetchFn.mock.calls.find((c: any[]) => c[1]?.method === 'PATCH');
    const body = JSON.parse(patch![1].body);
    expect(new Date(body.scheduled_at).getTime()).toBe(sched.getTime() + 3600_000);
    await waitFor(() => expect(screen.getByText(/resta in pausa finché non lo riprendi/)).toBeInTheDocument());
  });
});

describe('WhatsApp scollegato', () => {
  test('in-page banner (pull-only) with the queue explanation and Ricollega', async () => {
    const pending = { id: 'p1', recipient_name: 'Mario', recipient_number: '393334445566', parsed_message: 'Ciao', scheduled_at: new Date(Date.now() + 3600_000).toISOString(), status: 'pending' };
    mockFetch([pending], {}, 'close');
    await renderPage();
    const banner = await screen.findByTestId('disconnected-banner');
    expect(banner).toHaveTextContent('WhatsApp scollegato — i messaggi in coda partiranno quando lo ricolleghi');
    expect(banner.querySelector('a[href="/connect"]')).toHaveTextContent('Ricollega');
  });
});
