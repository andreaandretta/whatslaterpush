/**
 * @jest-environment jsdom
 *
 * ScheduleModal verso un gruppo WhatsApp: titolo e "Gruppo · N persone",
 * niente {nome}, avviso omonimi, avviso da gruppo quando WhatsApp è
 * scollegato, mai il JID a schermo e mai manual_entry nel POST.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ScheduleModal from '../components/ScheduleModal';
import { clearContactsSnapshots, setGroupsSnapshot } from '../app/lib/contacts-client-cache';

const JID = '120363000000000001@g.us';
const group = { number: JID, name: 'Under 12 – Genitori', kind: 'group' as const, size: 19, hint: null };
const base = { open: true, onClose: () => {}, onBack: () => {}, onScheduled: () => {} };
const okFetch = () => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

const textarea = () => screen.getByPlaceholderText(/Scrivi il messaggio/i);
const sendButton = () => screen.getByRole('button', { name: /Invia/i });

beforeEach(() => {
  (global as any).fetch = jest.fn();
  try { sessionStorage.clear(); } catch { /* jsdom */ }
});
afterEach(() => {
  jest.restoreAllMocks();
  clearContactsSnapshots();
});

describe('ScheduleModal — gruppo', () => {
  test('titolo, "Gruppo · 19 persone" e il suggerimento "un solo messaggio"', () => {
    render(<ScheduleModal {...base} contact={group} />);
    expect(screen.getByText('Messaggio per Under 12 – Genitori')).toBeInTheDocument();
    expect(screen.getByTestId('group-subtitle')).toHaveTextContent('Gruppo · 19 persone');
    expect(screen.getByTestId('group-hint')).toHaveTextContent('Parte un solo messaggio nel gruppo, dal tuo numero.');
    expect(screen.queryByTestId('group-homonym-warning')).not.toBeInTheDocument();
  });

  test('omonimi: il distintivo nel sottotitolo e l\'avviso ambra', () => {
    render(<ScheduleModal {...base} contact={{ ...group, hint: 'creato a set 2024' }} />);
    expect(screen.getByTestId('group-subtitle')).toHaveTextContent('Gruppo · 19 persone · creato a set 2024');
    expect(screen.getByTestId('group-homonym-warning')).toHaveTextContent('Hai più gruppi con questo nome: controlla che sia quello giusto.');
  });

  test('niente chip {nome}; scrivendo {nome} compare l\'avviso e il pulsante si spegne', () => {
    render(<ScheduleModal {...base} contact={group} />);
    expect(screen.queryByText(/nome contatto/)).not.toBeInTheDocument();
    fireEvent.change(textarea(), { target: { value: 'Ciao a tutti' } });
    expect(sendButton()).not.toBeDisabled();
    fireEvent.change(textarea(), { target: { value: 'Ciao {nome}, domani allenamento' } });
    expect(screen.getByTestId('group-nome-warning')).toHaveTextContent('{nome} non si usa nei gruppi');
    expect(screen.queryByText(/Anteprima per/)).not.toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  test('una persona tiene il chip {nome} e l\'anteprima (regressione)', () => {
    render(<ScheduleModal {...base} contact={{ number: '393331234567', name: 'Mario Rossi' }} />);
    expect(screen.getByText(/nome contatto/)).toBeInTheDocument();
    fireEvent.change(textarea(), { target: { value: 'Ciao {nome}' } });
    expect(screen.getByText(/Anteprima per Mario/)).toBeInTheDocument();
    expect(screen.queryByTestId('group-nome-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('group-subtitle')).not.toBeInTheDocument();
  });

  test('WhatsApp scollegato: testo da gruppo (non "resta in coda") e pulsante attivo', () => {
    render(<ScheduleModal {...base} contact={group} connected={false} />);
    expect(screen.getByTestId('group-disconnected-warning')).toHaveTextContent('Per programmare in un gruppo WhatsApp deve essere collegato: ricollegalo e riprova.');
    expect(screen.queryByTestId('disconnected-warning')).not.toBeInTheDocument();
    expect(screen.queryByText(/resta in coda/)).not.toBeInTheDocument();
    fireEvent.change(textarea(), { target: { value: 'Ciao a tutti' } });
    expect(sendButton()).not.toBeDisabled();
  });

  test('in modifica con solo il JID: "Gruppo" senza numero di persone, mai il JID', () => {
    render(<ScheduleModal {...base} contact={{ number: JID }} editMsgId="m1" initialMessage="Allenamento" />);
    expect(screen.getByText('Messaggio per Gruppo senza nome')).toBeInTheDocument();
    expect(screen.getByTestId('group-subtitle')).toHaveTextContent(/^Gruppo$/);
    expect(document.body.innerHTML).not.toContain('@g.us');
    expect(document.body.innerHTML).not.toContain('120363');
  });

  test('in modifica con il JID, numero di persone e distintivo dallo snapshot dei gruppi', () => {
    setGroupsSnapshot([{ jid: JID, name: 'Genitori', size: 22, can_send: true, hint: 'nella community «Polisportiva»' }]);
    render(<ScheduleModal {...base} contact={{ number: JID, name: 'Genitori' }} editMsgId="m1" initialMessage="Allenamento" />);
    expect(screen.getByTestId('group-subtitle')).toHaveTextContent('Gruppo · 22 persone · nella community «Polisportiva»');
    expect(screen.getByTestId('group-homonym-warning')).toBeInTheDocument();
  });

  test('il POST non manda mai manual_entry per un gruppo', async () => {
    (global as any).fetch = okFetch();
    render(<ScheduleModal {...base} contact={{ ...group, manualEntry: true }} />);
    fireEvent.change(textarea(), { target: { value: 'Ciao a tutti' } });
    fireEvent.click(sendButton());
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (global as any).fetch.mock.calls[0];
    expect(url).toBe('/api/messages');
    const body = JSON.parse(init.body);
    expect(body.recipient_number).toBe(JID);
    expect(body).not.toHaveProperty('manual_entry');
  });

  test.each([
    [400, { error: 'recipient_not_group_member', message: 'Non fai parte di questo gruppo (o ne sei uscito): scegline uno dalla lista.' }, 'Non fai parte di questo gruppo (o ne sei uscito): scegline uno dalla lista.'],
    [409, { error: 'whatsapp_disconnected' }, 'WhatsApp è scollegato: ricollegalo per scrivere in un gruppo.'],
    [503, { error: 'group_check_unavailable' }, 'Non riesco a controllare il gruppo adesso: riprova tra un minuto.'],
  ])('HTTP %s dal server: si mostra il testo in italiano', async (status, body, expected) => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status, json: async () => body });
    render(<ScheduleModal {...base} contact={group} />);
    fireEvent.change(textarea(), { target: { value: 'Ciao a tutti' } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(screen.getByText(expected as string)).toBeInTheDocument());
  });
});
