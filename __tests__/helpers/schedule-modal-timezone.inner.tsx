/**
 * @jest-environment jsdom
 *
 * ScheduleModal con il telefono NON in ora italiana (fase 1b, gruppo
 * "schermate2"). Il server calcola le ricorrenze sul calendario di Roma: la
 * modale deve costruire BYDAY/BYMONTHDAY dal giorno di Roma e mostrare gli
 * orari in ora italiana, dicendolo.
 */
// Gira SOLO con TZ=Europe/Lisbon, lanciato da __tests__/schedule-modal-timezone.test.ts
// (process.env.TZ dentro jest non cambia il fuso: serve un processo a parte).

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ScheduleModal from '../../components/ScheduleModal';

const contact = { number: '393331234567', name: 'Mario Rossi' };
const base = { open: true, onClose: () => {}, onBack: () => {}, contact, onScheduled: () => {} };

// Un lunedì 23:30 a Lisbona = martedì 00:30 a Roma (ora legale o solare:
// Lisbona è sempre un'ora indietro).
function mondayLisbon2330(): Date {
  const d = new Date(Date.now() + 3 * 86400_000);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  d.setHours(23, 30, 0, 0);
  return d;
}

beforeEach(() => {
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
});

test('the test really runs outside Rome', () => {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Lisbon');
});

test('weekly rule uses the Rome weekday (TU), not the phone weekday (MO), and times are shown in Italian time', async () => {
  const at = mondayLisbon2330();
  render(<ScheduleModal {...base} initialMessage="Allenamento" editMsgId="msg-1" initialScheduledAt={at.toISOString()} />);

  expect(screen.getByTestId('rome-time-note')).toHaveTextContent('Orari in ora italiana');
  // CTA e selettore: 00:30 (Roma), non 23:30 (Lisbona).
  expect(screen.getByRole('button', { name: /Modifica orario/ })).toHaveTextContent('00:30');
  expect(screen.getByRole('button', { name: /Invia/i })).toHaveTextContent('0:30');

  fireEvent.click(screen.getByRole('button', { name: /Opzioni avanzate/ }));
  fireEvent.click(screen.getByRole('button', { name: /Ripeti/ }));
  const sheet = screen.getAllByRole('dialog').pop()!;
  fireEvent.click(within(sheet).getByText('Ogni martedì'));
  fireEvent.click(within(sheet).getByRole('button', { name: /Conferma/ }));

  fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
  await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
  const body = JSON.parse((global as any).fetch.mock.calls[0][1].body);
  expect(body.recurrence_rule).toBe('FREQ=WEEKLY;BYDAY=TU');
  // Stesso istante di prima: nessuno spostamento di un'ora.
  expect(new Date(body.scheduled_at).getTime()).toBe(at.getTime());
});

test('the courtesy hint uses Rome hours: 23:30 in Lisbon is 00:30 in Italy', () => {
  render(<ScheduleModal {...base} initialMessage="Ciao" editMsgId="msg-1" initialScheduledAt={mondayLisbon2330().toISOString()} />);
  expect(screen.getByText(/Alle 0:30 chi riceve potrebbe dormire/)).toBeInTheDocument();
});
