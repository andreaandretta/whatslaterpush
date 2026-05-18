/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ScheduleModal from '../components/ScheduleModal';

const contact = { number: '393331234567', name: 'Mario Rossi' };

describe('ScheduleModal (new WhatsApp UI)', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  test('renders nothing when closed', () => {
    const { container } = render(
      <ScheduleModal open={false} onClose={() => {}} onBack={() => {}} contact={contact} onScheduled={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders header title and body title with contact name', () => {
    render(
      <ScheduleModal open={true} onClose={() => {}} onBack={() => {}} contact={contact} onScheduled={() => {}} />
    );
    expect(screen.getByText(/Programma un messaggio/i)).toBeInTheDocument();
    expect(screen.getByText(/Messaggio per Mario Rossi/i)).toBeInTheDocument();
  });

  test('shows description, message, approval toggle, reminder row, and FAB', () => {
    render(
      <ScheduleModal open={true} onClose={() => {}} onBack={() => {}} contact={contact} onScheduled={() => {}} />
    );
    expect(screen.getByPlaceholderText(/Descrizione/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Scrivi il messaggio/i)).toBeInTheDocument();
    expect(screen.getByText(/Richiedi approvazione per l'invio/i)).toBeInTheDocument();
    expect(screen.getByText(/^Promemoria$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invia/i })).toBeInTheDocument();
  });

  test('FAB is disabled when message is empty', () => {
    render(
      <ScheduleModal open={true} onClose={() => {}} onBack={() => {}} contact={contact} onScheduled={() => {}} />
    );
    expect(screen.getByRole('button', { name: /Invia/i })).toBeDisabled();
  });

  test('FAB enabled and submits POST /api/messages when message is set', async () => {
    const onScheduled = jest.fn();
    const onClose = jest.fn();
    (global as any).fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({}),
    });

    render(
      <ScheduleModal open={true} onClose={onClose} onBack={() => {}} contact={contact} onScheduled={onScheduled} />
    );
    fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), {
      target: { value: 'Ciao' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Invia/i }));

    await waitFor(() => expect((global as any).fetch).toHaveBeenCalled());
    const [url, opts] = (global as any).fetch.mock.calls[0];
    expect(url).toBe('/api/messages');
    const body = JSON.parse(opts.body);
    expect(body.recipient_number).toBe('393331234567');
    expect(body.recipient_name).toBe('Mario Rossi');
    expect(body.message).toBe('Ciao');
    expect(typeof body.scheduled_at).toBe('string');
    expect(body).not.toHaveProperty('description');
    expect(body).not.toHaveProperty('reminder');
    expect(body).not.toHaveProperty('approval');

    await waitFor(() => expect(onScheduled).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  test('back arrow calls onBack', () => {
    const onBack = jest.fn();
    render(
      <ScheduleModal open={true} onClose={() => {}} onBack={onBack} contact={contact} onScheduled={() => {}} />
    );
    fireEvent.click(screen.getByLabelText(/Indietro/i));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('X close button calls onClose', () => {
    const onClose = jest.fn();
    render(
      <ScheduleModal open={true} onClose={onClose} onBack={() => {}} contact={contact} onScheduled={() => {}} />
    );
    fireEvent.click(screen.getByLabelText(/Chiudi/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('falls back to formatted phone when name missing', () => {
    render(
      <ScheduleModal
        open={true}
        onClose={() => {}}
        onBack={() => {}}
        contact={{ number: '393331234567' }}
        onScheduled={() => {}}
      />
    );
    expect(screen.getByText(/Messaggio per \+393331234567/i)).toBeInTheDocument();
  });
});
