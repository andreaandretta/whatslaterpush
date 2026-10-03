/**
 * @jest-environment jsdom
 *
 * Rapporto 360, B6/T24: il pulsante principale della dashboard ha una scritta.
 * Prima su telefono era un cerchio con l'aeroplanino ("invia adesso?"); ora una
 * pillola "+ Programma" alta 56px, testo 16px scuro sul verde, con un nome per
 * i lettori di schermo che contiene la scritta a vista. Piè di pagina leggibile.
 */
import React from 'react';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
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

function mockFetch(messages: unknown[]) {
  (global as any).fetch = jest.fn(async (url: string, init?: any): Promise<any> => {
    const method = init?.method || 'GET';
    if (url === '/api/auth/me') return resp({ phone: '393331112222', instanceName: 'X' });
    if (url === '/api/messages' && method === 'GET') {
      return resp({ messages, subscription_plan: 'beta', billing_enabled: false, raw_plan: 'free', connection_status: 'open', total_scheduled_lifetime: 5 });
    }
    return resp({});
  });
}

async function renderPage() {
  await act(async () => { render(<DashboardPage />); });
}

describe('pulsante "+ Programma"', () => {
  test('su telefono: pillola con la scritta "Programma", alta 56px, testo 16px scuro', async () => {
    mockFetch([]);
    await renderPage();
    const fab = await screen.findByTestId('mobile-fab');
    const btn = within(fab).getByRole('button', { name: 'Programma un messaggio' });
    expect(btn).toHaveTextContent('Programma');
    expect(btn).toHaveClass('h-14', 'text-base', 'text-[#0B141A]', 'bg-primary', 'rounded-full');
    // Niente più aeroplanino ("invia adesso"): il segno più.
    expect(btn.querySelector('svg.lucide-send')).toBeNull();
    expect(btn.querySelector('svg.lucide-plus')).toBeInTheDocument();
  });

  test('il nome per i lettori di schermo contiene la scritta a vista, anche da computer', async () => {
    mockFetch([]);
    await renderPage();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Programma un messaggio/ })).toHaveLength(2));
    for (const btn of screen.getAllByRole('button', { name: /Programma un messaggio/ })) {
      const name = btn.getAttribute('aria-label') || btn.textContent || '';
      expect(name).toContain((btn.textContent || '').trim());
    }
  });

  test('tocco → si apre la scelta del contatto', async () => {
    mockFetch([]);
    await renderPage();
    const fab = await screen.findByTestId('mobile-fab');
    fireEvent.click(within(fab).getByRole('button', { name: 'Programma un messaggio' }));
    expect(screen.getByTestId('contact-picker')).toBeInTheDocument();
  });

  test('la dashboard vuota rimanda a «Programma», non al "bottone verde"', async () => {
    mockFetch([]);
    await renderPage();
    await screen.findByTestId('mobile-fab');
    expect(document.body.textContent).toMatch(/«Programma»/);
    expect(document.body.textContent).not.toMatch(/bottone verde|Manda messaggio/);
  });
});

describe('piè di pagina', () => {
  test('12px #8696A0 (6,1:1), non 11px gray-600 (2,46:1), e non finisce sotto la pillola', async () => {
    mockFetch([]);
    await renderPage();
    const line = await screen.findByText(/I tuoi messaggi sono cifrati/);
    expect(line).toHaveClass('text-xs', 'text-[#8696A0]');
    expect(line.className).not.toMatch(/text-\[11px\]|text-gray-600/);
    expect(line.closest('footer')).toHaveClass('pb-24', 'sm:pb-3');
  });
});
