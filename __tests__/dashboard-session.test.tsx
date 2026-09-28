/**
 * @jest-environment jsdom
 *
 * Caricamento sessione della dashboard (fase 1b). Prima QUALSIASI errore di
 * /api/auth/me (rete assente, 5xx, pagina HTML di un captive portal) mandava a
 * /connect: l'utente vedeva "Passo 1 — il tuo numero", lo reinseriva, e init
 * scollegava un WhatsApp funzionante. Ora solo un 401 vero porta a /connect;
 * il resto mostra "connessione assente" e riprova.
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
jest.mock('../app/lib/contacts-client-cache', () => ({ prefetchContacts: jest.fn(), setContactsCacheOwner: jest.fn() }));
jest.mock('../components/ContactPickerModal', () => () => null);

import DashboardPage from '../app/dashboard/page';

const resp = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const messagesPayload = { messages: [], subscription_plan: 'beta', raw_plan: 'free', billing_enabled: false, connection_status: 'open', total_scheduled_lifetime: 1 };

const mockHrefSet: string[] = [];
// jsdom non naviga (e window.location non è ridefinibile): si registra solo
// dove la pagina vorrebbe andare.
jest.mock('../app/lib/session-load', () => ({
  ...jest.requireActual('../app/lib/session-load'),
  goTo: (url: string) => { mockHrefSet.push(url); },
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockHrefSet.length = 0;
});
afterEach(() => {
  jest.useRealTimers();
});

function mockMe(sequence: Array<() => any>) {
  let i = 0;
  const fn = jest.fn(async (url: string) => {
    if (url === '/api/auth/me') {
      const step = sequence[Math.min(i, sequence.length - 1)];
      i++;
      return step();
    }
    if (url === '/api/messages') return resp(messagesPayload);
    return resp({});
  });
  (global as any).fetch = fn;
  return fn;
}

async function renderPage() {
  await act(async () => { render(<DashboardPage />); });
}

test('401 → /connect (sessione davvero scaduta)', async () => {
  mockMe([() => resp({ error: 'Unauthorized' }, 401)]);
  await renderPage();
  expect(mockHrefSet).toEqual(['/connect']);
});

test('rete assente all\'apertura → resta sulla dashboard, dice che riprova, poi entra', async () => {
  const fn = mockMe([
    () => { throw new TypeError('Load failed'); },
    () => resp({ phone: '393331112222', instanceName: 'X' }),
  ]);
  await renderPage();
  expect(mockHrefSet).toEqual([]);
  expect(screen.getByText(/Connessione assente/)).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(5000); });
  await act(async () => { await Promise.resolve(); });
  expect(fn.mock.calls.filter((c) => c[0] === '/api/auth/me').length).toBeGreaterThanOrEqual(2);
  expect(mockHrefSet).toEqual([]);
  expect(screen.queryByText(/Connessione assente/)).not.toBeInTheDocument();
});

test('5xx o pagina HTML (captive portal) → nessun redirect a /connect', async () => {
  mockMe([
    () => resp({}, 503),
    () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }),
  ]);
  await renderPage();
  await act(async () => { jest.advanceTimersByTime(5000); });
  await act(async () => { await Promise.resolve(); });
  expect(mockHrefSet).toEqual([]);
  expect(screen.getByText(/Connessione assente/)).toBeInTheDocument();
});
