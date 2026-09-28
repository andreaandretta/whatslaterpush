/**
 * @jest-environment jsdom
 *
 * ScheduleModal — gruppo "schermate2" (fase 1b): una modifica solo-testo non
 * sposta più l'orario (né l'ancora della ricorrenza), i segnaposto dei
 * template bloccano l'invio finché non si compilano, "Riattiva" su un orario
 * passato riapre la modale e rimette in coda.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ScheduleModal from '../components/ScheduleModal';

const contact = { number: '393331234567', name: 'Mario Rossi' };
const okFetch = () => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
const base = { open: true, onClose: () => {}, onBack: () => {}, contact, onScheduled: () => {} };

// Il cron ha spostato un venerdì 18:00 (settimanale) a sabato 08:03 per il
// limite dei numeri nuovi: la riga ora è sabato 08:03, la regola resta BYDAY=FR.
function cronShiftedSaturday(): Date {
  const d = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
  d.setHours(8, 3, 27, 0);
  return d;
}

beforeEach(() => {
  (global as any).fetch = jest.fn();
});

const lastBody = () => JSON.parse((global as any).fetch.mock.calls[0][1].body);

describe('Modifica solo-testo', () => {
  test('does not send scheduled_at: the anchor (18:00) and the cron reason stay intact', async () => {
    (global as any).fetch = okFetch();
    const sat = cronShiftedSaturday();
    render(<ScheduleModal {...base} initialMessage="Allenamento" editMsgId="msg-1" initialScheduledAt={sat.toISOString()} initialRecurrenceRule="FREQ=WEEKLY;BYDAY=FR" />);
    fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: 'Allenamento alle 18' } });
    fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    const body = lastBody();
    expect(body.message).toBe('Allenamento alle 18');
    expect(body).not.toHaveProperty('scheduled_at');
    expect(body).not.toHaveProperty('recurrence_rule');
  });

  test('changing the date does send scheduled_at', async () => {
    (global as any).fetch = okFetch();
    const sat = cronShiftedSaturday();
    render(<ScheduleModal {...base} initialMessage="Allenamento" editMsgId="msg-1" initialScheduledAt={sat.toISOString()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Domani' }));
    fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    const body = lastBody();
    expect(body).toHaveProperty('scheduled_at');
    const d = new Date(body.scheduled_at);
    expect(d.getHours()).toBe(8);
    expect(d.getMinutes()).toBe(3);
  });

  test('a message whose time already passed is re-timed (the modal proposes a new time) and sends it', async () => {
    (global as any).fetch = okFetch();
    const past = new Date(Date.now() - 2 * 86400_000).toISOString();
    render(<ScheduleModal {...base} initialMessage="Guida" editMsgId="msg-1" initialScheduledAt={past} />);
    fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    expect(new Date(lastBody().scheduled_at).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('"Riattiva" con orario passato → "Scegli un nuovo orario"', () => {
  test('resumeOnSave also puts the message back in the queue (status pending)', async () => {
    (global as any).fetch = okFetch();
    const past = new Date(Date.now() - 2 * 86400_000).toISOString();
    render(<ScheduleModal {...base} initialMessage="Guida" editMsgId="msg-1" initialScheduledAt={past} resumeOnSave />);
    fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    expect(lastBody()).toMatchObject({ id: 'msg-1', status: 'pending' });
  });
});

describe('segnaposto dei template', () => {
  const SEED = '🏃 Convocazione partita {giorno} ore {orario} — campo {luogo}. Ciao {nome}!';

  test('the CTA is disabled and the missing fields are listed', () => {
    render(<ScheduleModal {...base} initialMessage={SEED} />);
    expect(screen.getByRole('button', { name: /Invia/i })).toBeDisabled();
    const box = screen.getByTestId('unfilled-placeholders');
    expect(box).toHaveTextContent('Completa i campi tra parentesi: {giorno}, {orario}, {luogo}');
    // {nome} si compila da solo: non è nella lista.
    expect(box).not.toHaveTextContent('{nome}');
  });

  test('once the fields are written the CTA comes back', () => {
    render(<ScheduleModal {...base} initialMessage={SEED} />);
    fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: '🏃 Convocazione partita sabato ore 18 — campo Comunale. Ciao {nome}!' } });
    expect(screen.queryByTestId('unfilled-placeholders')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invia/i })).not.toBeDisabled();
  });
});
