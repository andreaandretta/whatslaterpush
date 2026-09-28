/**
 * @jest-environment jsdom
 *
 * /connect riprende il pairing dopo un reload e non scollega un WhatsApp
 * già collegato (fase 1b).
 */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));
jest.mock('../app/components/connect/StepNumero', () => (p: any) => (
  <button type="button" onClick={() => p.onSubmit('393331234567')}>invia-numero</button>
));
jest.mock('../app/components/connect/StepCodice', () => (p: any) => <div data-testid="codice">{p.code}</div>);
jest.mock('../app/components/connect/StepPronto', () => () => <div data-testid="pronto" />);

import ConnectPage from '../app/connect/page';

const SID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const resp = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } });

beforeEach(() => {
  jest.useFakeTimers();
  mockReplace.mockClear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/connect');
});
afterEach(() => { jest.useRealTimers(); });

async function renderPage() {
  await act(async () => { render(<ConnectPage />); });
  await act(async () => { await Promise.resolve(); });
}

test('reload dopo aver inserito il codice sul telefono → la pagina riprende la sessione e porta alla dashboard', async () => {
  sessionStorage.setItem('wl_pairing_session', JSON.stringify({ sessionId: SID, phone: '393331234567' }));
  const fetchFn = jest.fn(async (url: string, init?: any) => {
    if (url === '/api/auth/check') {
      expect(JSON.parse(init.body)).toEqual({ sessionId: SID });
      return resp({ authenticated: true, redirect: '/dashboard' });
    }
    return resp({});
  });
  (global as any).fetch = fetchFn;
  await renderPage();
  expect(screen.getByTestId('pronto')).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(1600); });
  expect(mockReplace).toHaveBeenCalledWith('/dashboard');
  expect(sessionStorage.getItem('wl_pairing_session')).toBeNull();
});

test('reload con pairing ancora in corso → torna al codice corrente', async () => {
  sessionStorage.setItem('wl_pairing_session', JSON.stringify({ sessionId: SID, phone: '393331234567' }));
  (global as any).fetch = jest.fn(async () => resp({ authenticated: false, pairingCode: 'WXYZ-9876', pairingCodeUpdatedAt: new Date().toISOString(), connState: null }));
  await renderPage();
  expect(screen.getByTestId('codice')).toHaveTextContent('WXYZ-9876');
});

// Revisione 28 set 2026: il sessionId non sta più nell'indirizzo (cronologia,
// Sentry, PC condivisi). Un #s= rimasto da prima si toglie e si ignora.
test('un vecchio #s= nell\'URL viene tolto e ignorato → passo 1', async () => {
  window.history.replaceState(null, '', '/connect#s=' + SID);
  (global as any).fetch = jest.fn(async () => resp({ authenticated: true, redirect: '/dashboard' }));
  await renderPage();
  expect(screen.getByText('invia-numero')).toBeInTheDocument();
  expect(window.location.hash).toBe('');
  expect((global as any).fetch).not.toHaveBeenCalled();
});

test('sessione scaduta (410) al ripristino → passo 1 e memoria pulita', async () => {
  sessionStorage.setItem('wl_pairing_session', JSON.stringify({ sessionId: SID, phone: '393331234567' }));
  (global as any).fetch = jest.fn(async () => resp({ error: 'expired' }, 410));
  await renderPage();
  expect(screen.getByText('invia-numero')).toBeInTheDocument();
  expect(sessionStorage.getItem('wl_pairing_session')).toBeNull();
});

test('init riuscito → sessionId salvato solo in sessionStorage (mai nell\'indirizzo)', async () => {
  (global as any).fetch = jest.fn(async (url: string) => {
    if (url === '/api/auth/init') return resp({ sessionId: SID, instanceName: 'X', pairingCode: 'ABCD-1234' });
    return resp({ authenticated: false });
  });
  await renderPage();
  await act(async () => { fireEvent.click(screen.getByText('invia-numero')); });
  expect(screen.getByTestId('codice')).toHaveTextContent('ABCD-1234');
  expect(JSON.parse(sessionStorage.getItem('wl_pairing_session') || '{}').sessionId).toBe(SID);
  expect(window.location.hash).toBe('');
  expect(window.location.search).toBe('');
});

test('init risponde already_connected → dashboard, nessun codice', async () => {
  (global as any).fetch = jest.fn(async () => resp({ already_connected: true, redirect: '/dashboard' }));
  await renderPage();
  await act(async () => { fireEvent.click(screen.getByText('invia-numero')); });
  expect(mockReplace).toHaveBeenCalledWith('/dashboard');
  expect(screen.queryByTestId('codice')).not.toBeInTheDocument();
});
