/**
 * @jest-environment jsdom
 *
 * Pagine pubbliche — rapporto del 30 settembre 2026:
 * A2 la FAQ non promette messaggi "alla squadra" né "a decine di persone"
 *    (un promemoria per persona; i gruppi sono in prova, non per tutti);
 * M1 "Continua" sta subito sotto il campo del numero, non in fondo alla pagina;
 * M3 le promesse tornano tra loro (niente "20-30" contro "50", rampa dei primi
 *    giorni detta, telefono spento oltre 2 settimane, "3 al giorno per sempre"
 *    solo con il billing acceso);
 * M4 niente "clienti" per allenatori, catechisti e capi scout.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import FAQSection from '../app/components/FAQSection';
import BetaPricingNotice from '../app/components/BetaPricingNotice';
import HeroSection from '../app/components/HeroSection';
import StatsBar from '../app/components/StatsBar';
import StepNumero from '../app/components/connect/StepNumero';
import StepCodice from '../app/components/connect/StepCodice';
import ComeProteggiamo from '../app/come-proteggiamo-il-tuo-numero/page';

describe('A2 + M3 — domande frequenti', () => {
  test('niente "alla squadra" né "decine di persone": una persona per promemoria, gruppi in prova', () => {
    const { container } = render(<FAQSection billingEnabled={false} />);
    const text = container.textContent || '';
    expect(text).not.toMatch(/alla squadra/);
    expect(text).not.toMatch(/decine di persone/);
    expect(text).toMatch(/ogni lunedì alle 7 a Marco, papà di Luca/);
    expect(text).toMatch(/Ogni promemoria va a una persona/);
    expect(text).toMatch(/I gruppi WhatsApp sono in prova e non ancora aperti a tutti/);
    expect(text).toMatch(/a tante persone \(un promemoria per ciascuna\)/);
  });

  test('ban: niente "20-30" contro i 50 della beta; si dice che si parte da 5 al giorno', () => {
    const { container } = render(<FAQSection billingEnabled={false} />);
    const text = container.textContent || '';
    expect(text).not.toMatch(/20-30/);
    expect(text).toMatch(/si parte da 5 messaggi al giorno/);
  });

  test('telefono spento: dopo 2 settimane WhatsApp scollega', () => {
    const { container } = render(<FAQSection billingEnabled={false} />);
    expect(container.textContent).toMatch(/più di 2 settimane, WhatsApp scollega WhatsLater e va ricollegato/);
    expect(container.textContent).not.toMatch(/linked devices/);
  });

  // Revisione: frase senza ripetizioni e domanda senza inglese tecnico.
  test('"collegato come WhatsApp Web" detto una volta; niente "scheduling nativo"', () => {
    const { container } = render(<FAQSection billingEnabled={false} />);
    const text = container.textContent || '';
    expect(text).toMatch(/WhatsLater è collegato al tuo WhatsApp come WhatsApp Web, tra i dispositivi collegati: funziona anche col telefono spento\./);
    expect(text).not.toMatch(/come dispositivo collegato, come/);
    expect(text).not.toMatch(/scheduling/i);
    expect(text).toMatch(/In cosa è diverso da WhatsApp Business o dalla programmazione dei messaggi di WhatsApp\?/);
  });

  test('Ripeti: si dice dove si trova oggi (sotto giorno e ora, più giorni insieme)', () => {
    const { container } = render(<FAQSection billingEnabled={false} />);
    expect(container.textContent).toMatch(/tocca "Ripeti", subito sotto il giorno e l'ora/);
    expect(container.textContent).toMatch(/anche più giorni insieme, per esempio lunedì e giovedì/);
    expect(container.textContent).not.toMatch(/Opzioni avanzate/);
  });

  test('le risposte aperte non vengono tagliate (altezza massima più ampia di 24rem)', () => {
    const { container } = render(<FAQSection billingEnabled={false} />);
    const open = container.querySelector('.pb-5');
    expect(open?.className).toMatch(/max-h-\[40rem\]/);
  });
});

describe('M3 — beta: 50 al giorno, ma nei primi giorni meno', () => {
  test('la lista della beta dice "Fino a 50" e la rampa', () => {
    render(<BetaPricingNotice />);
    expect(screen.getByText(/Fino a 50 messaggi al giorno \(nei primi giorni meno, per proteggere il numero appena collegato\)/)).toBeInTheDocument();
    expect(screen.queryByText('50 messaggi programmati al giorno')).not.toBeInTheDocument();
  });

  test('"Dal tuo numero", senza "personale" (va bene anche Business o fisso)', () => {
    render(<StatsBar />);
    expect(screen.getByText('Dal tuo numero')).toBeInTheDocument();
    expect(screen.queryByText(/numero personale/)).not.toBeInTheDocument();
  });
});

describe('M4 — niente "clienti"', () => {
  test('hero: "dal numero che le famiglie conoscono già"', () => {
    const { container } = render(<HeroSection />);
    expect(container.textContent).toMatch(/dal numero che le famiglie conoscono già/);
    expect(container.textContent).not.toMatch(/client/i);
  });
});

describe('M4 — pagina "Come proteggiamo il tuo numero"', () => {
  test('nessun "clienti": le famiglie, le persone a cui scrivi', () => {
    const { container } = render(<ComeProteggiamo />);
    const text = container.textContent || '';
    expect(text).not.toMatch(/client/i);
    expect(text).toMatch(/il numero che le famiglie conoscono già/);
    expect(text).toMatch(/avvisa le persone a cui scrivi, non te/);
  });
});

describe('metadati (titolo e descrizione per Google e per la condivisione)', () => {
  function loadLayoutMetadata(billing: string | undefined) {
    const prev = process.env.BILLING_ENABLED;
    if (billing === undefined) delete process.env.BILLING_ENABLED;
    else process.env.BILLING_ENABLED = billing;
    let meta: any;
    jest.isolateModules(() => {
      jest.doMock('next/font/google', () => ({
        Inter: () => ({ variable: 'font-inter', className: 'inter' }),
        Space_Grotesk: () => ({ variable: 'font-sg', className: 'sg' }),
      }));
      jest.doMock('../app/globals.css', () => ({}), { virtual: true });
      jest.doMock('../app/components/ServiceWorkerRegistrar', () => () => null);
      meta = require('../app/layout').metadata;
    });
    if (prev === undefined) delete process.env.BILLING_ENABLED;
    else process.env.BILLING_ENABLED = prev;
    return meta;
  }

  test('titolo e anteprima parlano di famiglie, non di clienti', () => {
    const meta = loadLayoutMetadata('false');
    expect(meta.title).toBe('WhatsLater - Promemoria WhatsApp dal numero che le famiglie conoscono già');
    expect(meta.openGraph.title).toBe(meta.title);
    expect(String(meta.title)).not.toMatch(/client/i);
  });

  test('beta (BILLING_ENABLED=false): "Gratis durante la beta", non "3 al giorno, per sempre"', () => {
    const meta = loadLayoutMetadata('false');
    expect(meta.description).toMatch(/Gratis durante la beta\.$/);
    expect(meta.description).not.toMatch(/3 al giorno/);
    expect(meta.openGraph.description).toBe(meta.description);
  });

  test('billing acceso: torna il piano gratuito da 3 al giorno', () => {
    const meta = loadLayoutMetadata(undefined);
    expect(meta.description).toMatch(/Gratis: 3 al giorno, per sempre\.$/);
  });
});

describe('M1 — "Continua" sotto il campo del numero', () => {
  test('il pulsante segue subito il campo, prima della riga "Niente SMS", e non è spinto in fondo', () => {
    const { container } = render(<StepNumero onSubmit={jest.fn()} />);
    const input = screen.getByPlaceholderText('333 123 4567');
    const button = screen.getByRole('button', { name: /continua/i });
    const trust = screen.getByText(/Niente SMS/);
    expect(input.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(trust) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const cta = screen.getByTestId('numero-cta');
    expect(cta).toContainElement(button);
    expect(cta.className).not.toMatch(/\bmt-auto\b/);
    expect(container.innerHTML).not.toMatch(/\bmin-h-screen\b/);
    expect(container.innerHTML).toMatch(/min-h-\[100svh\]/);
    expect(input).toHaveAttribute('inputmode', 'tel');
  });

  test('anche il riquadro degli errori sta nello stesso blocco, sopra il pulsante', () => {
    render(<StepNumero onSubmit={jest.fn()} error={{ kind: 'generic', title: 'Controlla e riprova', message: 'Qualcosa non va.', cooldownSec: 0 }} />);
    const cta = screen.getByTestId('numero-cta');
    expect(cta).toHaveTextContent('Controlla e riprova');
  });
});

// Revisione: 'resize' della parte visibile scatta anche con lo zoom a due dita.
describe('M1 — "Continua" portato in vista solo con la tastiera del numero', () => {
  let vv: EventTarget & { height: number; offsetTop: number; scale: number };
  let scrollSpy: jest.Mock;
  const origScroll = (HTMLElement.prototype as any).scrollIntoView;
  const origRect = HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    vv = Object.assign(new EventTarget(), { height: 400, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
    scrollSpy = jest.fn();
    (HTMLElement.prototype as any).scrollIntoView = scrollSpy;
    // Il pulsante sta sotto la parte visibile (finisce a 600 px, se ne vedono 400).
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { top: 550, bottom: 600, left: 0, right: 300, width: 300, height: 50, x: 0, y: 550, toJSON() {} } as DOMRect;
    };
  });

  afterEach(() => {
    delete (window as any).visualViewport;
    (HTMLElement.prototype as any).scrollIntoView = origScroll;
    HTMLElement.prototype.getBoundingClientRect = origRect;
  });

  const resize = () => vv.dispatchEvent(new Event('resize'));

  test('campo numero attivo e niente zoom → il pulsante viene portato in vista', () => {
    render(<StepNumero onSubmit={jest.fn()} />);
    const input = screen.getByPlaceholderText('333 123 4567');
    input.focus();
    resize();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  test('zoom a due dita (campo non attivo) → la pagina non salta', () => {
    render(<StepNumero onSubmit={jest.fn()} />);
    (document.activeElement as HTMLElement | null)?.blur();
    vv.scale = 2;
    resize();
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  test('zoom con il campo attivo → la pagina non salta', () => {
    render(<StepNumero onSubmit={jest.fn()} />);
    screen.getByPlaceholderText('333 123 4567').focus();
    vv.scale = 1.8;
    resize();
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});

// Revisione: bianco su verde = 1,98:1. Nel flusso di accesso, testo scuro come nell'app.
describe('flusso di accesso: testo scuro sui pulsanti verdi', () => {
  test('"Continua" attivo ha il testo #0B141A', () => {
    render(<StepNumero onSubmit={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('333 123 4567'), { target: { value: '333 123 4567' } });
    const button = screen.getByRole('button', { name: /continua/i });
    expect(button).toBeEnabled();
    expect(button.className).toMatch(/text-\[#0B141A\]/);
    expect(button.className).not.toMatch(/\btext-white\b/);
  });

  test('"Copia" del codice ha il testo #0B141A', () => {
    render(<StepCodice code="ABCD1234" expiresAt={null} phoneNumber="393331234567" onBack={() => {}} onRegenerate={() => {}} />);
    const copy = screen.getByRole('button', { name: /Copia/ });
    expect(copy.className).toMatch(/text-\[#0B141A\]/);
    expect(copy.className).not.toMatch(/\btext-white\b/);
  });
});
