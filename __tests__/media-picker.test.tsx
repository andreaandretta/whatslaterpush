/**
 * @jest-environment jsdom
 *
 * MediaPicker — the upload must die with the picker. ScheduleModal stays mounted
 * between contacts: without the abort, a slow upload started for Mario resolved
 * into the modal reopened for Luigi and attached Mario's file to Luigi's message.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MediaPicker } from '../components/schedule/MediaPicker';

afterEach(() => { jest.restoreAllMocks(); });

function fileInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input[type="file"]');
  if (!el) throw new Error('file input not found');
  return el as HTMLInputElement;
}

describe('MediaPicker', () => {
  test('closing the picker aborts the upload and never calls onAttached', async () => {
    let resolveUpload: (v: any) => void = () => {};
    let seenSignal: AbortSignal | undefined;
    (global as any).fetch = jest.fn((_url: string, opts: any) => {
      seenSignal = opts?.signal;
      return new Promise((res) => { resolveUpload = res; });
    });
    const onAttached = jest.fn();
    const onClose = jest.fn();
    const { container, rerender } = render(<MediaPicker open={true} onClose={onClose} onAttached={onAttached} />);

    const file = new File(['x'], 'orari-mario.pdf', { type: 'application/pdf' });
    await act(async () => { fireEvent.change(fileInput(container), { target: { files: [file] } }); });
    expect(screen.getByText(/Caricamento/i)).toBeInTheDocument();

    rerender(<MediaPicker open={false} onClose={onClose} onAttached={onAttached} />);
    expect(seenSignal?.aborted).toBe(true);

    await act(async () => {
      resolveUpload({ ok: true, status: 200, json: async () => ({ media_url: 'u', media_type: 'document', media_filename: 'orari-mario.pdf', bytes: 1 }) });
      await Promise.resolve(); await Promise.resolve();
    });
    expect(onAttached).not.toHaveBeenCalled();
  });

  test('a successful upload attaches the file and closes', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ media_url: 'https://x/y.pdf', media_type: 'document', media_filename: 'y.pdf', bytes: 2048 }),
    });
    const onAttached = jest.fn();
    const onClose = jest.fn();
    const { container } = render(<MediaPicker open={true} onClose={onClose} onAttached={onAttached} />);
    await act(async () => {
      fireEvent.change(fileInput(container), { target: { files: [new File(['x'], 'y.pdf', { type: 'application/pdf' })] } });
    });
    await waitFor(() => expect(onAttached).toHaveBeenCalledTimes(1));
    expect(onAttached.mock.calls[0][0]).toMatchObject({ media_filename: 'y.pdf', media_type: 'document' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('reopening after an error starts from the grid, not from the old error', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('Errore di rete'));
    const { container, rerender } = render(<MediaPicker open={true} onClose={() => {}} onAttached={() => {}} />);
    await act(async () => {
      fireEvent.change(fileInput(container), { target: { files: [new File(['x'], 'y.pdf', { type: 'application/pdf' })] } });
    });
    await waitFor(() => expect(screen.getByText(/Errore di rete/i)).toBeInTheDocument());
    rerender(<MediaPicker open={false} onClose={() => {}} onAttached={() => {}} />);
    rerender(<MediaPicker open={true} onClose={() => {}} onAttached={() => {}} />);
    expect(screen.queryByText(/Errore di rete/i)).not.toBeInTheDocument();
  });

  // 22 set 2026: foto grandi → Vercel risponde 413 in testo semplice ("Request
  // Entity Too Large"); res.json() esplodeva con "Unexpected token 'R'".
  test('a platform 413 with a non-JSON body shows a clear message instead of crashing', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false, status: 413,
      json: () => Promise.reject(new SyntaxError("Unexpected token 'R', \"Request En\"... is not valid JSON")),
    });
    const onAttached = jest.fn();
    const { container } = render(<MediaPicker open={true} onClose={() => {}} onAttached={onAttached} />);
    await act(async () => {
      fireEvent.change(fileInput(container), { target: { files: [new File(['x'], 'y.pdf', { type: 'application/pdf' })] } });
    });
    await waitFor(() => expect(screen.getByText(/troppo grande/i)).toBeInTheDocument());
    expect(onAttached).not.toHaveBeenCalled();
  });

  test('files above the Vercel body limit go through the signed URL and a direct PUT to Storage', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    (global as any).fetch = jest.fn((url: string, opts: any) => {
      calls.push({ url: String(url), method: opts?.method });
      if (String(url) === '/api/messages/upload/sign') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({
          signed_url: 'https://x.supabase.co/storage/v1/object/upload/sign/message-media/p?token=t',
          media_url: '39333/uuid-big.pdf', media_type: 'document', media_filename: 'big.pdf',
        }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    const onAttached = jest.fn();
    const { container } = render(<MediaPicker open={true} onClose={() => {}} onAttached={onAttached} />);
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' });
    await act(async () => { fireEvent.change(fileInput(container), { target: { files: [big] } }); });
    await waitFor(() => expect(onAttached).toHaveBeenCalledTimes(1));
    expect(calls.map((c) => c.url)).toEqual(['/api/messages/upload/sign', 'https://x.supabase.co/storage/v1/object/upload/sign/message-media/p?token=t']);
    expect(calls[1].method).toBe('PUT');
    expect(onAttached.mock.calls[0][0]).toMatchObject({ media_url: '39333/uuid-big.pdf', media_type: 'document', bytes: 6 * 1024 * 1024 });
  });

  test('small files still use the multipart route', async () => {
    const urls: string[] = [];
    (global as any).fetch = jest.fn((url: string) => { urls.push(String(url)); return Promise.resolve({ ok: true, status: 200, json: async () => ({ media_url: 'p', media_type: 'document', media_filename: 's.pdf', bytes: 3 }) }); });
    const { container } = render(<MediaPicker open={true} onClose={() => {}} onAttached={() => {}} />);
    await act(async () => { fireEvent.change(fileInput(container), { target: { files: [new File(['abc'], 's.pdf', { type: 'application/pdf' })] } }); });
    await waitFor(() => expect(urls).toEqual(['/api/messages/upload']));
  });
});
