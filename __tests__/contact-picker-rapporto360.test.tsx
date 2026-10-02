/**
 * @jest-environment jsdom
 *
 * ContactPickerModal — correzioni rapide del rapporto 360 (2 ott 2026):
 * A1 campi a 16px (niente zoom di Safari) e ricerca senza maiuscola/correttore,
 * A6 il numero stesso come "nome" vale come nessun nome (un "118" scelto
 * apposta resta), un solo formato del numero, A7 il titolo conta i
 * risultati della ricerca, A8 testo scuro sui pulsanti verdi, A13 l'errore
 * "Scrivi il numero." sparisce appena si scrive.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ContactPickerModal from '../components/ContactPickerModal';
import { clearContactsSnapshots } from '../app/lib/contacts-client-cache';

// Rubrica per /api/contacts, gruppi spenti per /api/groups.
function mockFetchContacts(contacts: any[], recents: any[] = []) {
  const res = (body: unknown) => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  });
  (global as any).fetch = jest.fn((url: string) => Promise.resolve(
    String(url).startsWith('/api/groups') ? res({ enabled: false, connected: false, groups: [] })
      : String(url).startsWith('/api/labels') ? res({ labels: [] })
        : res({ contacts, recents }),
  ));
}

afterEach(() => {
  jest.restoreAllMocks();
  clearContactsSnapshots();
});

const MARIO = { number: '393401111111', name: 'Mario Rossi' };
const ANNA = { number: '393402222222', name: 'Anna Bianchi' };
const DIGITS = { number: '393331234567', name: '393331234567' };

async function openPicker(contacts: any[] = [MARIO, ANNA], onSelect = jest.fn()) {
  mockFetchContacts(contacts);
  render(<ContactPickerModal open onClose={() => {}} onSelect={onSelect} />);
  await waitFor(() => expect(screen.getByText(/Contatti su WhatsApp/)).toBeInTheDocument());
  return onSelect;
}

describe('A1 — campi a 16px', () => {
  test('ricerca: text-base, senza maiuscola automatica né correttore, tasto "cerca"', async () => {
    await openPicker();
    const search = screen.getByPlaceholderText('Cerca contatto…');
    expect(search.className).toMatch(/\btext-base\b/);
    expect(search.className).not.toMatch(/\btext-sm\b/);
    expect(search).toHaveAttribute('autocapitalize', 'none');
    expect(search).toHaveAttribute('autocorrect', 'off');
    expect(search).toHaveAttribute('spellcheck', 'false');
    expect(search).toHaveAttribute('enterkeyhint', 'search');
  });

  test('Nuovo contatto: Nome e Numero a 16px, Numero con tastiera numerica', async () => {
    await openPicker();
    fireEvent.click(screen.getByText('Nuovo contatto'));
    const name = screen.getByPlaceholderText('Nome (opzionale)');
    const number = screen.getByLabelText('Numero');
    expect(name.className).toMatch(/\btext-base\b/);
    expect(number.className).toMatch(/\btext-base\b/);
    expect(number).toHaveAttribute('inputmode', 'tel');
  });
});

describe('A6 — il numero come nome', () => {
  test('la riga mostra il numero leggibile e la scelta parte senza nome', async () => {
    const onSelect = await openPicker([DIGITS, MARIO]);
    expect(screen.queryByText('393331234567')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('+39 333 123 4567'));
    expect(onSelect).toHaveBeenCalledWith({ number: '393331234567', name: undefined });
  });

  // Revisione: il server tiene "118" (isNoRealName), il selettore non lo butta.
  test('un nome di cifre scelto apposta ("118") resta, col numero sotto', async () => {
    const onSelect = await openPicker([{ number: '393401111111', name: '118', pushName: 'Marco' }]);
    expect(screen.getByText('118')).toBeInTheDocument();
    expect(screen.getByText('+39 340 111 1111')).toBeInTheDocument();
    fireEvent.click(screen.getByText('118'));
    expect(onSelect).toHaveBeenCalledWith({ number: '393401111111', name: '118' });
  });

  test('un numero fisso si legge come nella finestra e nella lista: "+39 081 555 1234"', async () => {
    await openPicker([{ number: '390815551234', name: '' }]);
    expect(screen.getByText('+39 081 555 1234')).toBeInTheDocument();
  });
});

describe('A7 — "Contatti su WhatsApp (N)" coerente con la ricerca', () => {
  test('conta i risultati e sparisce quando sono 0', async () => {
    await openPicker([MARIO, ANNA]);
    expect(screen.getByText('Contatti su WhatsApp (2)')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Cerca contatto…'), { target: { value: 'anna' } });
    expect(screen.getByText('Contatti su WhatsApp (1)')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Cerca contatto…'), { target: { value: 'zzz' } });
    expect(screen.queryByText(/Contatti su WhatsApp/)).not.toBeInTheDocument();
    expect(screen.getByText(/Nessun risultato per/)).toBeInTheDocument();
  });
});

describe('A8 — testo scuro sui pulsanti verdi', () => {
  test('"Continua" e "Scrivi il numero": #0B141A, non bianco', async () => {
    await openPicker();
    fireEvent.change(screen.getByPlaceholderText('Cerca contatto…'), { target: { value: 'zzz' } });
    const write = screen.getByRole('button', { name: 'Scrivi il numero' });
    expect(write.className).toMatch(/text-\[#0B141A\]/);
    expect(write.className).not.toMatch(/text-white/);
    fireEvent.click(write);
    const cont = screen.getByRole('button', { name: 'Continua' });
    expect(cont.className).toMatch(/text-\[#0B141A\]/);
    expect(cont.className).not.toMatch(/text-white/);
  });
});

describe('A13 — "Scrivi il numero." sparisce mentre si scrive', () => {
  test('Continua a vuoto → errore; si scrive una cifra → l\'errore va via', async () => {
    await openPicker();
    fireEvent.click(screen.getByText('Nuovo contatto'));
    fireEvent.click(screen.getByRole('button', { name: 'Continua' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Scrivi il numero.'));
    expect(screen.getByLabelText('Numero')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(screen.getByLabelText('Numero'), { target: { value: '3' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Numero')).not.toHaveAttribute('aria-invalid');
  });
});
