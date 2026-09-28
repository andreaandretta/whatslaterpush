/**
 * @jest-environment jsdom
 *
 * Lista messaggi (gruppo "schermate", audit 25 set 2026): ciò che l'utente
 * vede e può fare su righe in errore, spostate dal sistema o non confermate.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import MessagesSection, { type ScheduledMessage } from '../app/components/MessagesSection';

const EXISTS_FALSE = 'HTTP 400: {"status":400,"error":"Bad Request","response":{"message":[{"jid":"393331234567@s.whatsapp.net","exists":false,"number":"393331234567"}]}}';
const MEDIA_400 = 'HTTP 400: {"status":400,"error":"Bad Request","response":{"message":["Error: Invalid media"]}}';

function msg(over: Partial<ScheduledMessage>): ScheduledMessage {
  return {
    id: 'm1', recipient_name: 'Mario Rossi', recipient_number: '393331234567', parsed_message: 'Ciao Mario',
    scheduled_at: new Date(Date.now() + 3 * 3600 * 1000).toISOString(), status: 'pending', ...over,
  };
}

function setup(messages: ScheduledMessage[], over: Record<string, unknown> = {}) {
  const props = {
    onDelete: jest.fn(), onDuplicate: jest.fn(), onEdit: jest.fn(), onPauseToggle: jest.fn(),
    onRetry: jest.fn(), onSnooze: jest.fn(), onShowToast: jest.fn(), onChooseOtherContact: jest.fn(),
    connected: true, ...over,
  };
  render(<MessagesSection {...(props as any)} messages={messages} />);
  return props;
}

const openSheet = () => fireEvent.click(screen.getAllByRole('button', { name: 'Azioni messaggio' })[0]);

describe('failed "Numero non su WhatsApp": il menu ⋮ dice la stessa cosa della card', () => {
  test('the actions sheet does not offer "Riprova invio" (the server would re-fail it)', () => {
    setup([msg({ status: 'failed', error_message: EXISTS_FALSE })]);
    openSheet();
    expect(screen.queryByText('Riprova invio')).not.toBeInTheDocument();
    expect(screen.getByText('Elimina')).toBeInTheDocument();
  });

  test('the card offers "Scegli un altro contatto" and hands over the message', () => {
    const p = setup([msg({ status: 'failed', error_message: EXISTS_FALSE })]);
    fireEvent.click(screen.getByRole('button', { name: /Scegli un altro contatto/ }));
    expect(p.onChooseOtherContact).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
    expect(screen.queryByText('Ricollega WhatsApp')).not.toBeInTheDocument();
  });

  test('the hint blames the "codice interno" only when the digits look like a LID', () => {
    setup([msg({ status: 'failed', error_message: EXISTS_FALSE, recipient_number: '34661234562716' })]);
    expect(screen.getByTestId('invalid-number-hint')).toHaveTextContent('codice interno');
  });

  test('for a normal-looking number the hint says the number may be wrong', () => {
    setup([msg({ status: 'failed', error_message: EXISTS_FALSE })]);
    const hint = screen.getByTestId('invalid-number-hint');
    expect(hint).not.toHaveTextContent('codice interno');
    expect(hint).toHaveTextContent('sbagliato');
  });

  test('a retryable failure still offers "Riprova invio" in the sheet', () => {
    setup([msg({ status: 'failed', error_message: 'HTTP 500: boom' })]);
    openSheet();
    expect(screen.getByText('Riprova invio')).toBeInTheDocument();
  });
});

describe('failed with a rejected attachment', () => {
  test('says so, hides Riprova, and "Cambia allegato" reopens the message (Duplica)', () => {
    const p = setup([msg({ status: 'failed', error_message: MEDIA_400, media_type: 'video', media_url: '39/x.mov', media_filename: 'x.mov' })]);
    expect(screen.getByText('Allegato non accettato da WhatsApp — cambia file')).toBeInTheDocument();
    expect(screen.queryByText('Numero non su WhatsApp')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Riprova' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Cambia allegato/ }));
    expect(p.onDuplicate).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
  });

  test('the same 400 on a text-only message keeps Riprova (not "Numero non su WhatsApp")', () => {
    setup([msg({ status: 'failed', error_message: MEDIA_400 })]);
    expect(screen.queryByText('Numero non su WhatsApp')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument();
  });
});

describe('Elimina', () => {
  test('does not toast "Eliminato" before the server answers (the dashboard toasts on success)', () => {
    const p = setup([msg({ status: 'failed', error_message: 'HTTP 500: boom' })]);
    openSheet();
    fireEvent.click(screen.getByText('Elimina'));
    expect(p.onDelete).toHaveBeenCalledWith('m1');
    expect(p.onShowToast).not.toHaveBeenCalled();
  });
});

describe('righe in coda spostate dal sistema', () => {
  test('a warm-up shift shows the reason in Italian, never the raw text', () => {
    setup([msg({ error_message: 'Limite giornaliero raggiunto (5/5) nei primi giorni dal collegamento — riprogrammato a domattina' })]);
    expect(screen.getByTestId('pending-reason')).toHaveTextContent('Spostato a domattina: nei primi giorni dal collegamento');
    expect(screen.queryByText(/5\/5/)).not.toBeInTheDocument();
  });

  test('a disconnect shift says WhatsApp is disconnected', () => {
    setup([msg({ error_message: 'Istanza disconnessa per 12× 5min, riprogrammato a domani' })]);
    expect(screen.getByTestId('pending-reason')).toHaveTextContent('Spostato a domani: WhatsApp scollegato');
  });

  test('an ordinary pending row has no reason line', () => {
    setup([msg({})]);
    expect(screen.queryByTestId('pending-reason')).not.toBeInTheDocument();
  });
});

describe('invio non confermato ("Da verificare")', () => {
  const past = new Date(Date.now() - 2 * 3600 * 1000).toISOString();

  test('a sent row with the timeout marker and no Evolution id shows "Da verificare", not ✓', () => {
    setup([msg({ status: 'sent', scheduled_at: past, error_message: 'send_timeout_indeterminate: nessuna conferma da Evolution entro 8s', evolution_message_id: null })]);
    fireEvent.click(screen.getByRole('button', { name: /Inviati/ }));
    expect(screen.getByTestId('status-unverified')).toHaveTextContent('Da verificare');
    expect(screen.queryByTestId('status-sent')).not.toBeInTheDocument();
  });

  test('a normal sent row keeps the ✓ even with an old reason in error_message', () => {
    setup([msg({ status: 'sent', scheduled_at: past, error_message: 'Istanza disconnessa, retry 2/12 fra 5 min', evolution_message_id: 'ABC' })]);
    fireEvent.click(screen.getByRole('button', { name: /Inviati/ }));
    expect(screen.queryByTestId('status-unverified')).not.toBeInTheDocument();
    expect(screen.getByTestId('status-sent')).toBeInTheDocument();
  });
});

describe('Posticipa dal menu', () => {
  test('on a message 5 days away every preset lands after its current time', () => {
    const sched = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    sched.setHours(18, 0, 0, 0);
    const p = setup([msg({ scheduled_at: sched.toISOString() })]);
    openSheet();
    const labels = ['+1 ora', '+1 giorno'];
    for (const label of labels) {
      openSheet();
      fireEvent.click(screen.getByRole('button', { name: label }));
    }
    expect(p.onSnooze).toHaveBeenCalledTimes(labels.length);
    for (const call of (p.onSnooze as jest.Mock).mock.calls) {
      expect(new Date(call[1]).getTime()).toBeGreaterThan(sched.getTime());
    }
    openSheet();
    expect(screen.queryByRole('button', { name: 'Stasera 20:00' })).not.toBeInTheDocument();
    const sheet = screen.getByText('Posticipa').parentElement!.parentElement!;
    expect(within(sheet).queryByText('Domani stessa ora')).not.toBeInTheDocument();
  });
});
