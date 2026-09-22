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
});
