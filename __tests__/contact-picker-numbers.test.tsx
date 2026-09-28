/**
 * @jest-environment jsdom
 *
 * ContactPickerModal — numeri scritti a mano e ricerca (audit 25 set 2026).
 * Prod: "3466…2716" (un 346 con una cifra in più) salvato a mano e letto da
 * WhatsApp come Spagna, programmato 4 volte, fallito exists:false ogni volta.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ContactPickerModal from '../components/ContactPickerModal';
import { clearContactsSnapshots } from '../app/lib/contacts-client-cache';

function mockFetchContacts(contacts: any[], recents: any[] = []) {
  const body = { contacts, recents };
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  });
}

afterEach(() => {
  jest.restoreAllMocks();
  clearContactsSnapshots();
});

async function openManual(onSelect = jest.fn()) {
  mockFetchContacts([{ number: '393401111111', name: 'Mario Rossi', pushName: 'Mariolino' }]);
  render(<ContactPickerModal open={true} onClose={() => {}} onSelect={onSelect} />);
  await waitFor(() => expect(screen.getByText('Mario Rossi')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Nuovo contatto'));
  return onSelect;
}

function typeNumber(value: string) {
  fireEvent.change(screen.getByLabelText('Numero'), { target: { value } });
  fireEvent.click(screen.getByText('Continua'));
}

describe('Nuovo contatto — lettura del numero', () => {
  test('cellulare italiano con una cifra in più: errore in italiano, nessun invio', async () => {
    const onSelect = await openManual();
    typeNumber('347 12345 678');
    expect(await screen.findByRole('alert')).toHaveTextContent(/cifra in più/);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('numero estero senza prefisso: rifiutato con il suggerimento del +', async () => {
    const onSelect = await openManual();
    typeNumber('447911123456');
    expect(await screen.findByRole('alert')).toHaveTextContent(/prefisso/);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('italiano: prosegue subito, segnato come scritto a mano', async () => {
    const onSelect = await openManual();
    fireEvent.change(screen.getByPlaceholderText('Nome (opzionale)'), { target: { value: 'Anna' } });
    typeNumber('347 123 4567');
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ number: '393471234567', name: 'Anna', manualEntry: true }));
  });

  test('estero col +: mostra paese e formato, prosegue solo dopo "Sì, è giusto"', async () => {
    const onSelect = await openManual();
    typeNumber('+34 712 345 678');
    expect(await screen.findByText(/Spagna · \+34 712 34 56 78 — è giusto\?/)).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Sì, è giusto'));
    expect(onSelect).toHaveBeenCalledWith({ number: '34712345678', name: undefined, manualEntry: true });
  });

  test('"Correggi" torna al campo senza proseguire', async () => {
    const onSelect = await openManual();
    typeNumber('0041 79 123 45 67');
    expect(await screen.findByText(/Svizzera/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Correggi'));
    expect(screen.queryByText(/Svizzera/)).not.toBeInTheDocument();
    expect(screen.getByText('Continua')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('Ricerca', () => {
  test('un numero incollato con +39 e spazi trova il contatto', async () => {
    mockFetchContacts([{ number: '393471234567', name: 'Giulia' }, { number: '393401111111', name: 'Mario' }]);
    render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Giulia')).toBeInTheDocument());
    const search = screen.getByPlaceholderText(/Cerca contatto/i);
    fireEvent.change(search, { target: { value: '+39 347 123 4567' } });
    expect(screen.getByText('Giulia')).toBeInTheDocument();
    expect(screen.queryByText('Mario')).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: '347 123 4567' } });
    expect(screen.getByText('Giulia')).toBeInTheDocument();
  });

  test('trova anche per nome WhatsApp (pushName)', async () => {
    mockFetchContacts([{ number: '393471234567', name: 'Giulia B.', pushName: 'Giuly' }, { number: '393401111111', name: 'Mario' }]);
    render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Mario')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Cerca contatto/i), { target: { value: 'giuly' } });
    expect(screen.getByText('Giulia B.')).toBeInTheDocument();
    expect(screen.queryByText('Mario')).not.toBeInTheDocument();
  });

  test('nessun risultato: "Scrivi il numero" apre Nuovo contatto già compilato', async () => {
    mockFetchContacts([{ number: '393401111111', name: 'Mario' }]);
    render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Mario')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Cerca contatto/i), { target: { value: '348 765 4321' } });
    fireEvent.click(screen.getByText('Scrivi il numero'));
    expect(screen.getByLabelText('Numero')).toHaveValue('348 765 4321');
  });
});
