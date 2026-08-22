/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CalendarSyncCard from '../app/components/CalendarSyncCard';

// GET /api/calendar payload shapes (mirror app/api/calendar/route.ts)
const DISABLED_PAYLOAD = { enabled: false };
const DISCONNECTED_PAYLOAD = {
  enabled: true,
  connected: false,
  email: null,
  calendar_id: null,
  reminder_offset_minutes: null,
  message_template: null,
  sync_enabled: null,
  last_synced_at: null,
  last_sync_error: null,
};
const CONNECTED_PAYLOAD = {
  enabled: true,
  connected: true,
  email: 'mario@gmail.com',
  calendar_id: 'primary',
  reminder_offset_minutes: 60,
  message_template: null,
  sync_enabled: true,
  last_synced_at: '2026-08-22T10:00:00Z',
  last_sync_error: null,
};

function mockGet(payload: unknown, ok = true) {
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  });
}

describe('CalendarSyncCard — visibility', () => {
  test('renders nothing when the feature flag is off (enabled:false)', async () => {
    mockGet(DISABLED_PAYLOAD);
    const { container } = render(<CalendarSyncCard />);
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledWith('/api/calendar'));
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/Promemoria da Google Calendar/i)).not.toBeInTheDocument();
  });

  test('renders nothing when the GET fails (network error)', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('net down'));
    const { container } = render(<CalendarSyncCard />);
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing on a non-ok response (e.g. 401)', async () => {
    mockGet({ error: 'Unauthorized' }, false);
    const { container } = render(<CalendarSyncCard />);
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});

describe('CalendarSyncCard — disconnected', () => {
  test('shows explainer + connect CTA', async () => {
    mockGet(DISCONNECTED_PAYLOAD);
    render(<CalendarSyncCard />);
    expect(await screen.findByText(/Promemoria da Google Calendar/i)).toBeInTheDocument();
    expect(screen.getByText(/numero del cliente nel titolo dell'evento/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Collega Google Calendar/i })).toBeInTheDocument();
    // No settings while disconnected
    expect(screen.queryByLabelText(/Quando inviare il promemoria/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Scollega/i)).not.toBeInTheDocument();
  });
});

describe('CalendarSyncCard — connected settings', () => {
  test('renders email + settings and PATCHes on offset change', async () => {
    mockGet(CONNECTED_PAYLOAD);
    render(<CalendarSyncCard />);
    expect(await screen.findByText('mario@gmail.com')).toBeInTheDocument();

    const select = screen.getByLabelText(/Quando inviare il promemoria/i) as HTMLSelectElement;
    expect(select.value).toBe('60');

    fireEvent.change(select, { target: { value: '120' } });

    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(2));
    const [url, opts] = (global as any).fetch.mock.calls[1];
    expect(url).toBe('/api/calendar');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ reminder_offset_minutes: 120 });
    // Optimistic update sticks on success
    expect(select.value).toBe('120');
  });

  test('template textarea uses the default as placeholder and PATCHes on blur', async () => {
    mockGet(CONNECTED_PAYLOAD);
    render(<CalendarSyncCard />);
    await screen.findByText('mario@gmail.com');

    const textarea = screen.getByLabelText(/Testo del promemoria/i) as HTMLTextAreaElement;
    expect(textarea.placeholder).toMatch(/Ciao \{nome\}/);
    expect(textarea.value).toBe(''); // null template → empty = "use default"

    fireEvent.change(textarea, { target: { value: 'Ciao {nome}, ci vediamo {data} alle {ora}!' } });
    // No PATCH mid-typing
    expect((global as any).fetch).toHaveBeenCalledTimes(1);

    fireEvent.blur(textarea);
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(2));
    const [, opts] = (global as any).fetch.mock.calls[1];
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({
      message_template: 'Ciao {nome}, ci vediamo {data} alle {ora}!',
    });
  });

  test('blur without changes does NOT fire a PATCH', async () => {
    mockGet({ ...CONNECTED_PAYLOAD, message_template: 'Testo custom' });
    render(<CalendarSyncCard />);
    await screen.findByText('mario@gmail.com');

    const textarea = screen.getByLabelText(/Testo del promemoria/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Testo custom');
    fireEvent.blur(textarea);
    expect((global as any).fetch).toHaveBeenCalledTimes(1); // only the mount GET
  });

  test('toggle Attivo PATCHes enabled:false and rolls back on failure', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => CONNECTED_PAYLOAD })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    (global as any).fetch = fetchMock;
    const onShowToast = jest.fn();

    render(<CalendarSyncCard onShowToast={onShowToast} />);
    await screen.findByText('mario@gmail.com');

    const toggle = screen.getByRole('switch', { name: /Promemoria attivi/i });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);
    // Optimistic flip…
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, opts] = fetchMock.mock.calls[1];
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ enabled: false });

    // …rolled back on the 500
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(onShowToast).toHaveBeenCalledWith('Non sono riuscito a salvare — riprova.');
  });

  test('Scollega asks confirm() then DELETEs and falls back to the connect CTA', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => CONNECTED_PAYLOAD })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    (global as any).fetch = fetchMock;
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(<CalendarSyncCard />);
    await screen.findByText('mario@gmail.com');

    fireEvent.click(screen.getByRole('button', { name: /Scollega/i }));
    expect(confirmSpy).toHaveBeenCalled();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, opts] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/calendar');
    expect(opts.method).toBe('DELETE');

    // Card flips back to the disconnected CTA state
    expect(await screen.findByRole('button', { name: /Collega Google Calendar/i })).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  test('confirm() declined → no DELETE', async () => {
    mockGet(CONNECTED_PAYLOAD);
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);

    render(<CalendarSyncCard />);
    await screen.findByText('mario@gmail.com');

    fireEvent.click(screen.getByRole('button', { name: /Scollega/i }));
    expect((global as any).fetch).toHaveBeenCalledTimes(1); // only the mount GET
    confirmSpy.mockRestore();
  });
});

describe('CalendarSyncCard — reauth banner', () => {
  test('last_sync_error=reauth_required shows the banner + Ricollega CTA', async () => {
    mockGet({ ...CONNECTED_PAYLOAD, last_sync_error: 'reauth_required' });
    render(<CalendarSyncCard />);
    await screen.findByText('mario@gmail.com');

    expect(screen.getByText(/Accesso a Google scaduto/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ricollega/i })).toBeInTheDocument();
  });

  test('no banner on a healthy connection', async () => {
    mockGet(CONNECTED_PAYLOAD);
    render(<CalendarSyncCard />);
    await screen.findByText('mario@gmail.com');

    expect(screen.queryByText(/Accesso a Google scaduto/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ricollega/i })).not.toBeInTheDocument();
  });
});
