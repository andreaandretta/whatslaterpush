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

  test('shows message, FAB; advanced options collapsed by default with silent summary', () => {
    render(
      <ScheduleModal open={true} onClose={() => {}} onBack={() => {}} contact={contact} onScheduled={() => {}} />
    );
    expect(screen.queryByPlaceholderText(/Descrizione/i)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Scrivi il messaggio/i)).toBeInTheDocument();
    expect(screen.getByText(/Opzioni avanzate/i)).toBeInTheDocument();
    expect(screen.getByText(/Nessuna notifica · invio automatico/i)).toBeInTheDocument();
    expect(screen.queryByText(/Richiedi approvazione per l'invio/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Promemoria$/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invia/i })).toBeInTheDocument();
  });

  test('expanding "Opzioni avanzate" does NOT reveal the flagged-off approval/reminder toggles', () => {
    // Task 11: "Richiedi approvazione" and "Promemoria" are gated behind
    // ADVANCED_APPROVAL_REMINDER_ENABLED (off) until implemented end-to-end,
    // so they must not appear even when advanced options are expanded.
    render(
      <ScheduleModal open={true} onClose={() => {}} onBack={() => {}} contact={contact} onScheduled={() => {}} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Opzioni avanzate/i }));
    expect(screen.queryByText(/Richiedi approvazione per l'invio/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Promemoria$/i)).not.toBeInTheDocument();
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
      ok: true,   // handleSubmit now checks res.ok (Task 10); real Response derives it from status
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

  // ── Salva come mio template: opt-in PRIMA dell'invio, niente popup dopo ──
  describe('salva come mio template (opt-in, nessun popup post-invio)', () => {
    // >= 20 caratteri: col vecchio comportamento faceva scattare il popup.
    const LONG = "Ciao, ti ricordo l'allenamento di domani alle 18 al campo.";
    const okFetch = () =>
      jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const box = () => screen.getByRole('checkbox', { name: /Salva come mio template/i });

    // Revisione 21 set: la modale non aspetta più il salvataggio del template.
    test('casella accesa + POST template che non risponde mai: la modale chiude lo stesso, subito', async () => {
      const onScheduled = jest.fn();
      const onClose = jest.fn();
      (global as any).fetch = jest.fn((url: string) => url === '/api/templates/personal'
        ? new Promise(() => {}) // appesa per sempre
        : Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
      render(
        <ScheduleModal open={true} onClose={onClose} onBack={() => {}} contact={contact} onScheduled={onScheduled} />
      );
      fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: LONG } });
      fireEvent.click(box());
      fireEvent.click(screen.getByRole('button', { name: /Invia/i }));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(onScheduled).toHaveBeenCalledTimes(1);
      const urls = (global as any).fetch.mock.calls.map((c: any[]) => c[0]);
      expect(urls).toEqual(['/api/messages', '/api/templates/personal']);
      expect((global as any).fetch.mock.calls[1][1].keepalive).toBe(true);
    });

    test('senza testo la casella è disattivata: niente template fantasma', () => {
      render(
        <ScheduleModal open={true} onClose={() => {}} onBack={() => {}} contact={contact} onScheduled={() => {}} />
      );
      expect(box()).toBeDisabled();
      expect(screen.getByText(/Scrivi un testo per salvarlo come template/i)).toBeInTheDocument();
      fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: 'Ciao' } });
      expect(box()).not.toBeDisabled();
    });

    test('casella spenta di default, nessun campo titolo', () => {
      render(
        <ScheduleModal open={true} onClose={() => {}} onBack={() => {}} contact={contact} onScheduled={() => {}} />
      );
      expect(box()).not.toBeChecked();
      expect(screen.queryByLabelText(/Titolo template/i)).not.toBeInTheDocument();
    });

    test('messaggio lungo + casella spenta: nessun popup, nessuna POST template, chiude subito', async () => {
      const onScheduled = jest.fn();
      const onClose = jest.fn();
      (global as any).fetch = okFetch();
      render(
        <ScheduleModal open={true} onClose={onClose} onBack={() => {}} contact={contact} onScheduled={onScheduled} />
      );
      fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: LONG } });
      fireEvent.click(screen.getByRole('button', { name: /Invia/i }));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(onScheduled).toHaveBeenCalledTimes(1);
      expect((global as any).fetch).toHaveBeenCalledTimes(1);
      expect((global as any).fetch.mock.calls[0][0]).toBe('/api/messages');
      expect(screen.queryByText(/Vuoi salvare questo come tuo template/i)).not.toBeInTheDocument();
    });

    test('casella accesa: titolo precompilato "Per {nome}", POST /api/templates/personal dopo l\'invio, poi chiude', async () => {
      const onScheduled = jest.fn();
      const onClose = jest.fn();
      (global as any).fetch = okFetch();
      render(
        <ScheduleModal open={true} onClose={onClose} onBack={() => {}} contact={contact} onScheduled={onScheduled} />
      );
      fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: LONG } });
      fireEvent.click(box());
      expect((screen.getByLabelText(/Titolo template/i) as HTMLInputElement).value).toBe('Per Mario Rossi');
      fireEvent.click(screen.getByRole('button', { name: /Invia/i }));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      const calls = (global as any).fetch.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toBe('/api/messages');
      expect(calls[1][0]).toBe('/api/templates/personal');
      expect(calls[1][1].method).toBe('POST');
      expect(JSON.parse(calls[1][1].body)).toEqual({
        title: 'Per Mario Rossi',
        body: LONG,
        source_template_id: null,
      });
      expect(onScheduled).toHaveBeenCalledTimes(1);
    });

    test('senza nome contatto il default è "Mio template"; il titolo modificato viene rispettato', async () => {
      const onClose = jest.fn();
      (global as any).fetch = okFetch();
      render(
        <ScheduleModal open={true} onClose={onClose} onBack={() => {}} contact={{ number: '393331234567' }} onScheduled={() => {}} />
      );
      fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: LONG } });
      fireEvent.click(box());
      const title = screen.getByLabelText(/Titolo template/i) as HTMLInputElement;
      expect(title.value).toBe('Mio template');
      fireEvent.change(title, { target: { value: 'Promemoria allenamento' } });
      fireEvent.click(screen.getByRole('button', { name: /Invia/i }));

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(JSON.parse((global as any).fetch.mock.calls[1][1].body).title).toBe('Promemoria allenamento');
    });

    test('titolo svuotato → torna al default invece di mandare un titolo vuoto', async () => {
      const onClose = jest.fn();
      (global as any).fetch = okFetch();
      render(
        <ScheduleModal open={true} onClose={onClose} onBack={() => {}} contact={contact} onScheduled={() => {}} />
      );
      fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: LONG } });
      fireEvent.click(box());
      fireEvent.change(screen.getByLabelText(/Titolo template/i), { target: { value: '   ' } });
      fireEvent.click(screen.getByRole('button', { name: /Invia/i }));

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(JSON.parse((global as any).fetch.mock.calls[1][1].body).title).toBe('Per Mario Rossi');
    });

    test('errore di rete sul salvataggio template: best-effort, la modale chiude lo stesso', async () => {
      const onScheduled = jest.fn();
      const onClose = jest.fn();
      (global as any).fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockRejectedValueOnce(new Error('network'));
      render(
        <ScheduleModal open={true} onClose={onClose} onBack={() => {}} contact={contact} onScheduled={onScheduled} />
      );
      fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: LONG } });
      fireEvent.click(box());
      fireEvent.click(screen.getByRole('button', { name: /Invia/i }));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(onScheduled).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/Errore di rete/i)).not.toBeInTheDocument();
    });

    test('invio fallito: nessuna POST template e la modale resta aperta', async () => {
      const onClose = jest.fn();
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_datetime' }),
      });
      render(
        <ScheduleModal open={true} onClose={onClose} onBack={() => {}} contact={contact} onScheduled={() => {}} />
      );
      fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: LONG } });
      fireEvent.click(box());
      fireEvent.click(screen.getByRole('button', { name: /Invia/i }));

      await waitFor(() => expect(screen.getByText(/Data\/ora non valida/i)).toBeInTheDocument());
      expect((global as any).fetch).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
    });

    test('in modifica (editMsgId) la casella non compare e il PATCH non salva template', async () => {
      const onClose = jest.fn();
      (global as any).fetch = okFetch();
      render(
        <ScheduleModal open={true} onClose={onClose} onBack={() => {}} contact={contact} onScheduled={() => {}} initialMessage={LONG} editMsgId="msg-1" />
      );
      expect(screen.queryByRole('checkbox', { name: /Salva come mio template/i })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect((global as any).fetch).toHaveBeenCalledTimes(1);
      expect((global as any).fetch.mock.calls[0][1].method).toBe('PATCH');
    });

    test('la casella si azzera a ogni apertura', () => {
      const props = { onClose: () => {}, onBack: () => {}, contact, onScheduled: () => {} };
      const { rerender } = render(<ScheduleModal open={true} {...props} />);
      // la casella è attiva solo con un testo (niente template fantasma)
      fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: LONG } });
      fireEvent.click(box());
      expect(box()).toBeChecked();
      rerender(<ScheduleModal open={false} {...props} />);
      rerender(<ScheduleModal open={true} {...props} />);
      expect(box()).not.toBeChecked();
      expect(screen.queryByLabelText(/Titolo template/i)).not.toBeInTheDocument();
    });
  });

  // ── Graffetta sempre a vista accanto al campo messaggio ──
  describe('graffetta allegato a vista (stile WhatsApp)', () => {
    test('bottone "Allega" visibile senza aprire le opzioni avanzate; apre il MediaPicker', () => {
      render(
        <ScheduleModal open={true} onClose={() => {}} onBack={() => {}} contact={contact} onScheduled={() => {}} />
      );
      const clip = screen.getByRole('button', { name: 'Allega' });
      expect(clip).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: /Allega media/i })).not.toBeInTheDocument();
      fireEvent.click(clip);
      expect(screen.getByRole('dialog', { name: /Allega media/i })).toBeInTheDocument();
    });

    test('la riga "Allega media" non sta più dentro Opzioni avanzate', () => {
      render(
        <ScheduleModal open={true} onClose={() => {}} onBack={() => {}} contact={contact} onScheduled={() => {}} />
      );
      fireEvent.click(screen.getByRole('button', { name: /Opzioni avanzate/i }));
      expect(screen.getByText(/^Ripeti$/)).toBeInTheDocument();
      expect(screen.getByText(/^Template$/)).toBeInTheDocument();
      expect(screen.queryByText(/Allega media/i)).not.toBeInTheDocument();
    });

    test('in modifica la graffetta è nascosta (il PATCH non accetta media)', () => {
      render(
        <ScheduleModal open={true} onClose={() => {}} onBack={() => {}} contact={contact} onScheduled={() => {}} initialMessage="Ciao" editMsgId="msg-1" />
      );
      expect(screen.queryByRole('button', { name: 'Allega' })).not.toBeInTheDocument();
    });

    test('allegato dalla graffetta: chip sopra il campo, invio solo-media consentito, campi media nel POST', async () => {
      (global as any).fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ media_url: 'u/1/f.pdf', media_type: 'document', media_filename: 'f.pdf', bytes: 2048 }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
      const { container } = render(
        <ScheduleModal open={true} onClose={() => {}} onBack={() => {}} contact={contact} onScheduled={() => {}} />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Allega' }));
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [new File(['x'], 'f.pdf', { type: 'application/pdf' })] } });

      await waitFor(() => expect(screen.getByText('f.pdf')).toBeInTheDocument());
      expect(screen.getByLabelText(/Rimuovi media/i)).toBeInTheDocument();
      expect((global as any).fetch.mock.calls[0][0]).toBe('/api/messages/upload');

      fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
      await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(2));
      const body = JSON.parse((global as any).fetch.mock.calls[1][1].body);
      expect(body.media_type).toBe('document');
      expect(body.media_url).toBe('u/1/f.pdf');
      expect(body.media_filename).toBe('f.pdf');
    });
  });
});
