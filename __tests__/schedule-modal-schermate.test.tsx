/**
 * @jest-environment jsdom
 *
 * ScheduleModal — gruppo "schermate" (audit 25 set 2026): Duplica con
 * allegato, testi d'errore italiani, modifica che non sposta/perde niente,
 * avviso quando WhatsApp è scollegato.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ScheduleModal from '../components/ScheduleModal';

const contact = { number: '393331234567', name: 'Mario Rossi' };
const okFetch = () => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
const failFetch = (status: number, body: unknown) => jest.fn().mockResolvedValue({ ok: false, status, json: async () => body });
const base = { open: true, onClose: () => {}, onBack: () => {}, contact, onScheduled: () => {} };

function saturdayIn5Days(): Date {
  const d = new Date(Date.now() + 5 * 24 * 3600 * 1000);
  d.setHours(18, 0, 0, 0);
  return d;
}

beforeEach(() => {
  (global as any).fetch = jest.fn();
});

describe('Duplica', () => {
  test('keeps the attachment and POSTs it — an attachment-only message can be sent', async () => {
    (global as any).fetch = okFetch();
    const initialMedia = { media_type: 'document' as const, media_url: '393331112222/uuid-orari.pdf', media_filename: 'orari.pdf', bytes: 0 };
    render(<ScheduleModal {...base} initialMessage="" initialMedia={initialMedia} />);
    expect(screen.getByText('orari.pdf')).toBeInTheDocument();
    const send = screen.getByRole('button', { name: /Invia/i });
    expect(send).not.toBeDisabled();
    fireEvent.click(send);
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (global as any).fetch.mock.calls[0];
    expect(url).toBe('/api/messages');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.media_url).toBe('393331112222/uuid-orari.pdf');
    expect(body.media_type).toBe('document');
  });

  test('when the original file was already cleaned up, the modal says so', () => {
    render(<ScheduleModal {...base} initialMessage="Orari" mediaUnavailable />);
    expect(screen.getByTestId('media-unavailable')).toHaveTextContent('non è più disponibile');
  });
});

describe('errori del server', () => {
  test.each([
    [429, { error: 'queue_full', message: 'Hai troppi messaggi in coda. Aspetta che ne venga inviato qualcuno.', pending: 21, limit: 21 }, 'Hai troppi messaggi in coda. Aspetta che ne venga inviato qualcuno.'],
    [400, { error: 'recipient_not_on_whatsapp', message: 'WhatsApp non conosce questo numero.' }, 'WhatsApp non conosce questo numero.'],
    [400, { error: 'invalid_media_url' }, "L'allegato non è più disponibile: toglilo e caricalo di nuovo."],
    [500, { error: 'duplicate key value violates unique constraint' }, 'Qualcosa non è andato dal nostro lato — riprova tra poco.'],
  ])('HTTP %s shows Italian text, never "Errore: <code>"', async (status, body, expected) => {
    (global as any).fetch = failFetch(status as number, body);
    render(<ScheduleModal {...base} />);
    fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: 'Ciao' } });
    fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
    await waitFor(() => expect(screen.getByText(expected as string)).toBeInTheDocument());
    expect(screen.queryByText(/^Errore:/)).not.toBeInTheDocument();
  });
});

describe('Modifica', () => {
  test('starts from the message time: a text-only edit does not move a Saturday message to today', async () => {
    (global as any).fetch = okFetch();
    const sat = saturdayIn5Days();
    render(<ScheduleModal {...base} initialMessage="Convocazione" editMsgId="msg-1" initialScheduledAt={sat.toISOString()} />);
    fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: 'Convocazione ore 18' } });
    fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse((global as any).fetch.mock.calls[0][1].body);
    expect(new Date(body.scheduled_at).getTime()).toBe(sat.getTime());
  });

  test('a weekly message keeps its recurrence (no recurrence_rule:null in the PATCH)', async () => {
    (global as any).fetch = okFetch();
    const sat = saturdayIn5Days();
    const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    const rule = `FREQ=WEEKLY;BYDAY=${days[sat.getDay()]}`;
    render(<ScheduleModal {...base} initialMessage="Allenamento" editMsgId="msg-1" initialScheduledAt={sat.toISOString()} initialRecurrenceRule={rule} />);
    fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse((global as any).fetch.mock.calls[0][1].body)).not.toHaveProperty('recurrence_rule');
  });

  test('a stored rule the modal cannot represent is left untouched', async () => {
    (global as any).fetch = okFetch();
    render(<ScheduleModal {...base} initialMessage="x" editMsgId="msg-1" initialScheduledAt={saturdayIn5Days().toISOString()} initialRecurrenceRule="FREQ=WEEKLY;INTERVAL=2;BYDAY=SA" />);
    fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse((global as any).fetch.mock.calls[0][1].body)).not.toHaveProperty('recurrence_rule');
  });
});

describe('WhatsApp scollegato', () => {
  test('the modal says the message waits for a reconnect instead of promising it leaves', () => {
    render(<ScheduleModal {...base} connected={false} />);
    expect(screen.getByTestId('disconnected-warning')).toHaveTextContent('ricollegalo prima');
    expect(screen.queryByText(/parte appena si riconnette/)).not.toBeInTheDocument();
  });

  test('connected (default): the usual microcopy', () => {
    render(<ScheduleModal {...base} />);
    expect(screen.queryByTestId('disconnected-warning')).not.toBeInTheDocument();
  });
});
