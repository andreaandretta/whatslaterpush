/**
 * @jest-environment jsdom
 *
 * Lista messaggi — gruppo "schermate2" (fase 1b): le righe ricorrenti si
 * riconoscono (↻ ogni …) e "Elimina" chiede "Solo questa volta" o "Tutta la
 * serie"; una riga messa in pausa dall'utente non mostra più il vecchio motivo
 * del cron.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import MessagesSection, { type ScheduledMessage } from '../app/components/MessagesSection';

function msg(over: Partial<ScheduledMessage>): ScheduledMessage {
  return {
    id: 'm1', recipient_name: 'Genitori catechismo', recipient_number: '393331234567', parsed_message: 'Catechismo alle 17',
    scheduled_at: new Date(Date.now() + 3 * 3600 * 1000).toISOString(), status: 'pending', ...over,
  };
}

function setup(messages: ScheduledMessage[]) {
  const props = {
    onDelete: jest.fn(), onDuplicate: jest.fn(), onEdit: jest.fn(), onPauseToggle: jest.fn(),
    onRetry: jest.fn(), onSnooze: jest.fn(), onShowToast: jest.fn(), onChooseOtherContact: jest.fn(),
    connected: true,
  };
  render(<MessagesSection {...(props as any)} messages={messages} />);
  return props;
}

const openSheet = () => fireEvent.click(screen.getAllByRole('button', { name: 'Azioni messaggio' })[0]);

describe('righe ricorrenti', () => {
  test('a weekly row shows "↻ ogni martedì"', () => {
    setup([msg({ recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU' })]);
    expect(screen.getByTestId('recurrence-tag')).toHaveTextContent('↻ ogni martedì');
  });

  test('a one-shot row has no tag', () => {
    setup([msg({})]);
    expect(screen.queryByTestId('recurrence-tag')).not.toBeInTheDocument();
  });

  test('a failed occurrence of a series also shows the tag', () => {
    setup([msg({ status: 'failed', error_message: 'HTTP 500: boom', recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=5' })]);
    expect(screen.getByTestId('recurrence-tag')).toHaveTextContent('↻ il 5 di ogni mese');
  });
});

describe('Elimina su una riga ricorrente', () => {
  test('asks first; "Solo questa volta" deletes only this occurrence', () => {
    const p = setup([msg({ recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU' })]);
    openSheet();
    fireEvent.click(screen.getByText('Elimina'));
    expect(p.onDelete).not.toHaveBeenCalled();
    const dialog = screen.getByTestId('recurring-delete-dialog');
    expect(dialog).toHaveTextContent('ogni martedì');
    fireEvent.click(screen.getByRole('button', { name: 'Solo questa volta' }));
    expect(p.onDelete).toHaveBeenCalledWith('m1', 'occurrence');
    expect(screen.queryByTestId('recurring-delete-dialog')).not.toBeInTheDocument();
  });

  test('"Tutta la serie" stops the series', () => {
    const p = setup([msg({ recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU' })]);
    openSheet();
    fireEvent.click(screen.getByText('Elimina'));
    fireEvent.click(screen.getByRole('button', { name: 'Tutta la serie' }));
    expect(p.onDelete).toHaveBeenCalledWith('m1', 'series');
  });

  test('"Annulla" does nothing', () => {
    const p = setup([msg({ recurrence_rule: 'FREQ=DAILY' })]);
    openSheet();
    fireEvent.click(screen.getByText('Elimina'));
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(p.onDelete).not.toHaveBeenCalled();
  });

  test('a one-shot row is deleted straight away, as before', () => {
    const p = setup([msg({})]);
    openSheet();
    fireEvent.click(screen.getByText('Elimina'));
    expect(p.onDelete).toHaveBeenCalledWith('m1');
  });
});

describe('riga in pausa: niente motivi vecchi del cron', () => {
  test('a paused row left with "HTTP 500" does not say "Nuovo tentativo a breve"', () => {
    setup([msg({ status: 'paused', error_message: 'HTTP 500: Internal Server Error' })]);
    expect(screen.queryByTestId('pending-reason')).not.toBeInTheDocument();
  });

  test('a paused row moved for quota does not say "Spostato a domattina"', () => {
    setup([msg({ status: 'paused', error_message: 'Numeri nuovi: max 5 al giorno — riprogrammato a domattina' })]);
    expect(screen.queryByTestId('pending-reason')).not.toBeInTheDocument();
  });

  test('a real pause reason ("In pausa: ...") is still shown', () => {
    setup([msg({ status: 'paused', error_message: 'In pausa: ti eri disconnesso da WhatsLater. Riprendilo quando vuoi.' })]);
    expect(screen.getByTestId('pending-reason')).toHaveTextContent('ti eri disconnesso');
  });

  test('a pending row still shows the cron reason', () => {
    setup([msg({ status: 'pending', error_message: 'Numeri nuovi: max 5 al giorno — riprogrammato a domattina' })]);
    expect(screen.getByTestId('pending-reason')).toHaveTextContent('Spostato a domattina');
  });
});
