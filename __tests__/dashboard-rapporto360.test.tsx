/**
 * @jest-environment jsdom
 *
 * Dashboard — correzioni rapide del rapporto 360 (2 ott 2026):
 * A8 il pulsante verde principale ha il testo scuro, A12/M3 il contatore dice
 * "Oggi partono N messaggi" ed è vero anche nei primi giorni (niente "limite
 * 50" con la ✓), e la dashboard vuota non parla di "clienti".
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
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

const resp = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function mockFetch(messages: unknown[], plan: { subscription_plan: string; billing_enabled: boolean } = { subscription_plan: 'beta', billing_enabled: false }) {
  (global as any).fetch = jest.fn(async (url: string, init?: any): Promise<any> => {
    const method = init?.method || 'GET';
    if (url === '/api/auth/me') return resp({ phone: '393331112222', instanceName: 'X' });
    if (url === '/api/messages' && method === 'GET') {
      return resp({ messages, ...plan, raw_plan: 'free', connection_status: 'open', total_scheduled_lifetime: 5 });
    }
    return resp({});
  });
}

// Oggi, tra un'ora o poco meno, comunque oggi (in coda).
function todayPending(id: string) {
  const d = new Date();
  d.setHours(23, 30, 0, 0);
  return { id, recipient_name: 'Mario', recipient_number: '393334445566', parsed_message: 'Allenamento', scheduled_at: d.toISOString(), status: 'pending' };
}

async function renderPage() {
  await act(async () => { render(<DashboardPage />); });
}

describe('contatore del giorno', () => {
  test('"Oggi parte 1 messaggio", con il tetto vero dei primi giorni e senza "schedulato" né ✓', async () => {
    mockFetch([todayPending('a')]);
    await renderPage();
    const counter = await screen.findByTestId('daily-counter');
    expect(counter).toHaveTextContent('Oggi parte 1 messaggio');
    expect(counter).toHaveTextContent('(fino a 50 al giorno, meno nei primi giorni)');
    expect(counter.textContent).not.toMatch(/schedulato|✓|limite 50/);
  });

  // Revisione: la rampa parte da 5, col Free (3 al giorno) "meno" non è vero.
  test('Free (3 al giorno): niente "meno nei primi giorni"', async () => {
    mockFetch([todayPending('a')], { subscription_plan: 'free', billing_enabled: true });
    await renderPage();
    const counter = await screen.findByTestId('daily-counter');
    expect(counter).toHaveTextContent('(fino a 3 al giorno)');
    expect(counter.textContent).not.toMatch(/primi giorni/);
  });

  // Revisione: la parentesi era grigio scuro a 12px (3,6:1), sotto il minimo.
  test('la parentesi si legge: grigio chiaro a 13px, non gray-500 a 12px', async () => {
    mockFetch([todayPending('a')]);
    await renderPage();
    const note = (await screen.findByTestId('daily-counter')).querySelector('span')!;
    expect(note.className).toMatch(/text-\[#AEBAC1\]/);
    expect(note.className).toMatch(/text-\[13px\]/);
    expect(note.className).not.toMatch(/text-gray-500|text-xs/);
  });

  test('plurale: "Oggi partono 2 messaggi"', async () => {
    mockFetch([todayPending('a'), todayPending('b')]);
    await renderPage();
    expect(await screen.findByTestId('daily-counter')).toHaveTextContent('Oggi partono 2 messaggi');
  });
});

describe('pulsante principale e dashboard vuota', () => {
  test('il pulsante verde "Manda messaggio" ha il testo scuro', async () => {
    mockFetch([]);
    await renderPage();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Manda messaggio/ }).length).toBeGreaterThan(0));
    for (const btn of screen.getAllByRole('button', { name: /Manda messaggio/ })) {
      expect(btn.className).toMatch(/text-\[#0B141A\]/);
      expect(btn.className).not.toMatch(/\btext-white\b/);
    }
  });

  test('la dashboard vuota non parla di "clienti"', async () => {
    mockFetch([]);
    await renderPage();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Manda messaggio/ }).length).toBeGreaterThan(0));
    expect(document.body.textContent).not.toMatch(/client/i);
  });
});
