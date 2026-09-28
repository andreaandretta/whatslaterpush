/**
 * @jest-environment jsdom
 *
 * Aggiornamento del service worker dopo un deploy. Prima: skipWaiting +
 * clientsClaim + reload incondizionato su controllerchange → pochi secondi dopo
 * l'apertura la pagina si ricaricava da sola, anche a metà di un messaggio o di
 * un upload. E un'app iOS ripresa dal background non cercava mai la versione nuova.
 */
import React, { useState } from 'react';
import { render, act, fireEvent, screen } from '@testing-library/react';
import { startSwUpdates, UPDATE_CHECK_MIN_MS } from '../app/lib/sw-update';
import { useModalHistory, openModalLayerCount, __resetModalHistoryForTests } from '../app/lib/use-modal-history';

class FakeWorker extends EventTarget {
  state = 'installed';
  postMessage = jest.fn();
}

let visibility: DocumentVisibilityState = 'visible';
let clock = 0;
const reload = jest.fn();

function setVisibility(v: DocumentVisibilityState) {
  visibility = v;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

const stops: Array<() => void> = [];

async function setup({ controlled = true, waiting = false }: { controlled?: boolean; waiting?: boolean } = {}) {
  const sw = new EventTarget() as EventTarget & Record<string, any>;
  const reg = new EventTarget() as EventTarget & Record<string, any>;
  reg.waiting = waiting ? new FakeWorker() : null;
  reg.installing = null;
  reg.update = jest.fn().mockResolvedValue(undefined);
  sw.controller = controlled ? {} : null;
  sw.register = jest.fn().mockResolvedValue(reg);
  const stop = startSwUpdates({ sw: sw as any, doc: document, openLayers: openModalLayerCount, reload, now: () => clock });
  stops.push(stop);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return { sw, reg, stop };
}

function FakeModal() {
  const [open, setOpen] = useState(true);
  useModalHistory(open, () => setOpen(false));
  return open ? <button onClick={() => setOpen(false)}>chiudi</button> : null;
}

async function closeModal() {
  fireEvent.click(screen.getByText('chiudi'));
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

beforeAll(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

beforeEach(() => {
  visibility = 'visible';
  clock = 1_000_000;
  reload.mockClear();
  __resetModalHistoryForTests();
  window.history.replaceState({}, '');
});

afterEach(() => {
  while (stops.length) stops.pop()!();
});

describe('aggiornamento del service worker', () => {
  test('registra /sw.js', async () => {
    const { sw } = await setup();
    expect(sw.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  test('una versione nuova in attesa NON si attiva mentre l\'utente usa l\'app', async () => {
    const { reg } = await setup({ waiting: true });
    expect(reg.waiting.postMessage).not.toHaveBeenCalled();
  });

  test('si attiva quando l\'app va in background e nessuna modale è aperta', async () => {
    const { reg } = await setup({ waiting: true });
    setVisibility('hidden');
    expect(reg.waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  test('con una modale aperta (messaggio o upload in corso) non si attiva nemmeno in background', async () => {
    render(<FakeModal />);
    const { reg } = await setup({ waiting: true });
    setVisibility('hidden');
    expect(reg.waiting.postMessage).not.toHaveBeenCalled();
    setVisibility('visible');
    await closeModal();
    setVisibility('hidden');
    expect(reg.waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  test('controllerchange con una modale aperta: niente reload subito, lo fa al primo momento sicuro', async () => {
    render(<FakeModal />);
    const { sw } = await setup();
    act(() => { sw.dispatchEvent(new Event('controllerchange')); });
    expect(reload).not.toHaveBeenCalled();
    setVisibility('hidden');
    expect(reload).not.toHaveBeenCalled(); // modale ancora aperta
    setVisibility('visible');
    await closeModal();
    setVisibility('hidden');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('controllerchange senza modali aperte: ricarica una volta sola', async () => {
    const { sw } = await setup();
    act(() => { sw.dispatchEvent(new Event('controllerchange')); });
    act(() => { sw.dispatchEvent(new Event('controllerchange')); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('prima installazione (pagina non ancora controllata): nessun reload', async () => {
    const { sw } = await setup({ controlled: false });
    act(() => { sw.dispatchEvent(new Event('controllerchange')); });
    expect(reload).not.toHaveBeenCalled();
  });

  test('app ripresa dal background: cerca la versione nuova, al massimo ogni qualche minuto', async () => {
    const { reg } = await setup();
    clock += UPDATE_CHECK_MIN_MS;
    setVisibility('hidden');
    setVisibility('visible');
    expect(reg.update).toHaveBeenCalledTimes(1);
    clock += 30_000;
    setVisibility('hidden');
    setVisibility('visible');
    expect(reg.update).toHaveBeenCalledTimes(1);
    clock += UPDATE_CHECK_MIN_MS;
    setVisibility('hidden');
    setVisibility('visible');
    expect(reg.update).toHaveBeenCalledTimes(2);
  });

  test('versione installata mentre l\'app è già in background: si attiva subito', async () => {
    const { reg } = await setup();
    setVisibility('hidden');
    const nw = new FakeWorker();
    nw.state = 'installing';
    reg.installing = nw;
    act(() => { reg.dispatchEvent(new Event('updatefound')); });
    nw.state = 'installed';
    reg.waiting = nw;
    act(() => { nw.dispatchEvent(new Event('statechange')); });
    expect(nw.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  test('dopo lo stop non reagisce più', async () => {
    const { sw, stop } = await setup();
    stop();
    act(() => { sw.dispatchEvent(new Event('controllerchange')); });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('next.config.js', () => {
  test('la versione nuova del SW aspetta (skipWaiting spento): la attiviamo noi al momento giusto', () => {
    jest.isolateModules(() => {
      const captured: any[] = [];
      jest.doMock('@ducanh2912/next-pwa', () => ({ __esModule: true, default: (opts: any) => { captured.push(opts); return (c: any) => c; } }));
      jest.doMock('@sentry/nextjs', () => ({ withSentryConfig: (c: any) => c }));
      require('../next.config.js');
      expect(captured).toHaveLength(1);
      expect(captured[0].workboxOptions.skipWaiting).toBe(false);
      // /api resta fuori dalla cache del SW (dati per-utente).
      expect(captured[0].workboxOptions.runtimeCaching[0].handler).toBe('NetworkOnly');
    });
  });
});
