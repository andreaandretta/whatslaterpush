/**
 * @jest-environment jsdom
 *
 * DocumentScanner — il flusso a schermate: foto → ritaglio → pagine → PDF.
 * jsdom non ha canvas: la parte che disegna (app/lib/scan/browser) è finta qui e
 * ha la sua logica pura testata altrove; qui conta che i bottoni facciano la cosa
 * giusta, che il PDF esca come File e che non si perdano pagine per un tasto Esc.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const fakeCanvas = (w: number, h: number) => ({ width: w, height: h }) as unknown as HTMLCanvasElement;

jest.mock('../app/lib/scan/browser', () => ({
  loadPhotoCanvas: jest.fn(async () => fakeCanvas(400, 300)),
  guessQuad: jest.fn((c: any) => [
    { x: 24, y: 18 }, { x: c.width - 24, y: 18 }, { x: c.width - 24, y: c.height - 18 }, { x: 24, y: c.height - 18 },
  ]),
  rotateCanvas90: jest.fn((c: any) => fakeCanvas(c.height, c.width)),
  releaseCanvas: jest.fn(),
  renderPage: jest.fn(async () => ({ blob: new Blob(['jpeg'], { type: 'image/jpeg' }), width: 1200, height: 1700 })),
  blobToScanPage: jest.fn(async (p: any) => ({ jpeg: new Uint8Array([0xff, 0xd8]), width: p.width, height: p.height })),
  nextFrame: jest.fn(async () => {}),
}));

jest.mock('../app/lib/scan/pdf', () => ({
  ...jest.requireActual('../app/lib/scan/pdf'),
  buildScanPdf: jest.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
}));

import { DocumentScanner } from '../components/schedule/DocumentScanner';
import * as browser from '../app/lib/scan/browser';
import * as pdf from '../app/lib/scan/pdf';

const photo = () => new File(['jpg'], 'IMG_0001.jpg', { type: 'image/jpeg' });

beforeEach(() => {
  jest.clearAllMocks();
  (URL as any).createObjectURL = jest.fn(() => 'blob:page');
  (URL as any).revokeObjectURL = jest.fn();
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as any);
});
afterEach(() => { jest.restoreAllMocks(); });

async function openEditor(props: Partial<React.ComponentProps<typeof DocumentScanner>> = {}) {
  const onCancel = props.onCancel ?? jest.fn();
  const onDone = props.onDone ?? jest.fn();
  render(<DocumentScanner initialPhoto={photo()} onCancel={onCancel} onDone={onDone} />);
  await screen.findByRole('heading', { name: 'Ritaglia la pagina 1' });
  return { onCancel, onDone };
}

async function confirmCrop() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Conferma ritaglio/i })); });
  await screen.findByRole('heading', { name: '1 pagina' });
}

describe('DocumentScanner', () => {
  test('the editor shows the photo with 4 draggable corners and the Rifai / Ruota / filter controls', async () => {
    await openEditor();
    expect(screen.getAllByRole('button', { name: /^Angolo / })).toHaveLength(4);
    expect(screen.getByRole('button', { name: /Rifai la foto/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ruota/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Documento' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Originale' })).toHaveAttribute('aria-checked', 'false');
    // Il focus entra nello scanner (titolo), non resta sulla pagina sotto.
    expect(screen.getByRole('heading', { name: 'Ritaglia la pagina 1' })).toHaveFocus();
    // La fotocamera per "Rifai" / "Aggiungi pagina" è quella posteriore.
    expect(screen.getByTestId('scanner-camera-input')).toHaveAttribute('capture', 'environment');
  });

  test('Ruota turns the photo and the corners with it', async () => {
    await openEditor();
    fireEvent.click(screen.getByRole('button', { name: /Ruota/i }));
    expect(browser.rotateCanvas90).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Ritaglia la pagina 1' })).toBeInTheDocument();
  });

  test('confirm → page list → Fatto hands over ONE PDF File named "Scansione GG-MM-AAAA HH.MM.pdf"', async () => {
    const { onDone } = await openEditor();
    fireEvent.click(screen.getByRole('radio', { name: 'Originale' }));
    await confirmCrop();
    expect((browser.renderPage as jest.Mock).mock.calls[0][2]).toBe('original');
    expect(screen.getByRole('img', { name: 'Pagina 1' })).toHaveAttribute('src', 'blob:page');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Fatto$/i })); });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const file = (onDone as jest.Mock).mock.calls[0][0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('application/pdf');
    expect(file.name).toMatch(/^Scansione \d{2}-\d{2}-\d{4} \d{2}\.\d{2}\.pdf$/);
    expect((pdf.buildScanPdf as jest.Mock).mock.calls[0][0]).toHaveLength(1);
  });

  test('"Aggiungi pagina" takes another photo into the same editor; pages can be deleted', async () => {
    const { onDone } = await openEditor();
    await confirmCrop();
    await act(async () => {
      fireEvent.change(screen.getByTestId('scanner-camera-input'), { target: { files: [photo()] } });
    });
    await screen.findByRole('heading', { name: 'Ritaglia la pagina 2' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Conferma ritaglio/i })); });
    await screen.findByRole('heading', { name: '2 pagine' });

    fireEvent.click(screen.getByRole('button', { name: 'Elimina pagina 2' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:page');
    expect(screen.getByRole('heading', { name: '1 pagina' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Elimina pagina 1' }));
    expect(screen.getByRole('button', { name: /^Fatto$/i })).toBeDisabled();
    expect(onDone).not.toHaveBeenCalled();
  });

  test('crossed corners are refused with a clear message instead of a mangled page', async () => {
    await openEditor();
    const tl = screen.getByRole('button', { name: /Angolo in alto a sinistra/ });
    for (let i = 0; i < 19; i++) fireEvent.keyDown(tl, { key: 'ArrowRight', shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: /Conferma ritaglio/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/angoli si incrociano/i);
    expect(browser.renderPage).not.toHaveBeenCalled();
  });

  test('Escape with no pages yet closes right away', async () => {
    const confirm = jest.spyOn(window, 'confirm');
    const { onCancel } = await openEditor();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  test('Escape with pages asks before throwing them away', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { onCancel } = await openEditor();
    await confirmCrop();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // Safari non mette il focus sui bottoni toccati, e in 'loading'/'working' l'unico
  // bottone è disattivato: il focus finiva su <body> o sulla modale DIETRO lo
  // scanner, e Esc/Tab (gestiti solo dentro lo scanner) non funzionavano più.
  test('Escape funziona anche col focus fuori dallo scanner (Safari dopo un tap)', async () => {
    const { onCancel } = await openEditor();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('Esc dentro lo scanner non arriva alla modale sotto (chiude solo lo scanner)', async () => {
    const below = jest.fn();
    window.addEventListener('keydown', below);
    const { onCancel } = await openEditor();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    window.removeEventListener('keydown', below);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(below).not.toHaveBeenCalled();
  });

  test('Tab in caricamento (nessun bottone attivo) resta nello scanner', async () => {
    (browser.loadPhotoCanvas as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
    const outside = document.createElement('button');
    outside.textContent = 'controllo della modale sotto';
    document.body.appendChild(outside);
    render(<DocumentScanner initialPhoto={photo()} onCancel={() => {}} onDone={() => {}} />);
    const heading = await screen.findByRole('heading', { name: 'Scansiona documento' });
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => { document.activeElement!.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(heading).toHaveFocus();
    outside.remove();
  });

  test('Tab con il focus finito fuori (su body) torna dentro lo scanner', async () => {
    await openEditor();
    (document.activeElement as HTMLElement | null)?.blur();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => { document.body.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  // Upload del PDF fallito (rete, 5xx, sessione scaduta, file troppo grande): prima
  // lo scanner era già smontato e le pagine perse. Ora resta sulle pagine con l'errore.
  test('upload fallito: le pagine restano e "Fatto" riprova', async () => {
    const onDone = jest.fn()
      .mockResolvedValueOnce('Errore di rete')
      .mockResolvedValueOnce(null);
    await openEditor({ onDone });
    await confirmCrop();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Fatto$/i })); });
    await screen.findByRole('heading', { name: '1 pagina' });
    expect(screen.getByRole('alert')).toHaveTextContent(/Errore di rete/);
    expect(screen.getByRole('img', { name: 'Pagina 1' })).toBeInTheDocument();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Fatto$/i })); });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(2));
    expect((onDone.mock.calls[1][0] as File).type).toBe('application/pdf');
  });

  test('unmounting revokes every thumbnail URL', async () => {
    const { unmount } = render(<DocumentScanner initialPhoto={photo()} onCancel={() => {}} onDone={() => {}} />);
    await screen.findByRole('heading', { name: 'Ritaglia la pagina 1' });
    await confirmCrop();
    (URL.revokeObjectURL as jest.Mock).mockClear();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:page');
  });
});
