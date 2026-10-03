/**
 * @jest-environment jsdom
 *
 * Finestre e tastiera su iPhone (rapporto 360 del 2 ott, B1: T2, T9, T10, T13,
 * e M6, M8, B5 del 30/9).
 * - Le finestre sono alte quanto la parte visibile dello schermo (visualViewport,
 *   --wl-vv-height): con la tastiera aperta la testata resta in cima e "Invia"
 *   subito sopra la tastiera.
 * - Finché una finestra è aperta: pagina sotto bloccata, niente "tira giù per
 *   ricaricare", barra della dashboard nascosta.
 * - Indietro chiude solo il foglio aperto (foglio azioni, "Vuoi uscire?",
 *   "L'orario è già passato", "Promemoria ricorrente").
 * - Fondo scuro sopra e sotto nella dashboard; pb-safe definita.
 */
import fs from 'fs';
import path from 'path';
import React, { useState } from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('../app/components/CalendarSyncCard', () => () => null);
jest.mock('../app/components/InstallPrompt', () => () => null);
jest.mock('../app/components/InstallAppButton', () => () => null);
jest.mock('../app/components/PricingSection', () => () => null);
jest.mock('../app/components/FAQSection', () => () => null);
jest.mock('../app/lib/contacts-client-cache', () => ({
  prefetchContacts: jest.fn(), setContactsCacheOwner: jest.fn(), getGroupsSnapshot: () => null,
}));
// Il selettore vero fa le sue chiamate: qui basta uno strato che si registra come lui.
jest.mock('../components/ContactPickerModal', () => {
  const { useModalHistory } = jest.requireActual('../app/lib/use-modal-history');
  return function PickerStub(p: any) {
    useModalHistory(p.open, p.onClose);
    return p.open ? <div data-testid="contact-picker" /> : null;
  };
});

import DashboardPage from '../app/dashboard/page';
import DashboardLayout, { viewport as dashboardViewport } from '../app/dashboard/layout';
import ScheduleModal from '../components/ScheduleModal';
import { MessageActionsSheet } from '../app/components/MessageActionsSheet';
import { LogoutDialog } from '../app/dashboard/LogoutDialog';
import MessagesSection, { type ScheduledMessage } from '../app/components/MessagesSection';
import { RecurrenceBottomSheet } from '../components/schedule/RecurrenceBottomSheet';
import { useModalHistory, openModalLayerCount, __resetModalHistoryForTests } from '../app/lib/use-modal-history';
import { VV_HEIGHT_VAR, VV_TOP_VAR } from '../app/lib/page-layer';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const html = () => document.documentElement;
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function pressBack() {
  await act(async () => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 20));
  });
}

// visualViewport finto: jsdom non ce l'ha. La finestra di jsdom è alta 768.
type FakeVV = EventTarget & { height: number; width: number; offsetTop: number; offsetLeft: number; scale: number };
function installVisualViewport(height = 768): FakeVV {
  const vv = Object.assign(new EventTarget(), { height, width: 1024, offsetTop: 0, offsetLeft: 0, scale: 1 }) as FakeVV;
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
  return vv;
}
function removeVisualViewport() {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
}

beforeEach(() => {
  __resetModalHistoryForTests();
  removeVisualViewport();
  window.history.replaceState({ __NA: true }, '');
});

afterEach(() => {
  __resetModalHistoryForTests();
  removeVisualViewport();
});

function Layer({ open, onBack, children }: { open: boolean; onBack: () => void; children?: React.ReactNode }) {
  useModalHistory(open, onBack);
  return open ? <div className="wl-viewport" data-testid="layer">{children}</div> : null;
}

describe('pagina sotto bloccata finché una finestra è aperta', () => {
  test('la prima finestra mette wl-layer-open sull\'<html>, la chiusura dell\'ultima lo toglie', async () => {
    function H() {
      const [open, setOpen] = useState(false);
      return (<>
        <button onClick={() => setOpen(true)}>apri</button>
        <button onClick={() => setOpen(false)}>chiudi</button>
        <Layer open={open} onBack={() => setOpen(false)} />
      </>);
    }
    render(<H />);
    expect(html()).not.toHaveClass('wl-layer-open');
    fireEvent.click(screen.getByText('apri'));
    await wait(10);
    expect(html()).toHaveClass('wl-layer-open');
    fireEvent.click(screen.getByText('chiudi'));
    await wait(10);
    expect(html()).not.toHaveClass('wl-layer-open');
  });

  test('selettore → finestra del messaggio nello stesso tocco: la pagina resta bloccata, senza sbloccarsi a metà', async () => {
    function H() {
      const [picker, setPicker] = useState(true);
      const [modal, setModal] = useState(false);
      return (<>
        <button onClick={() => { setPicker(false); setModal(true); }}>scegli</button>
        <Layer open={picker} onBack={() => setPicker(false)} />
        <Layer open={modal} onBack={() => setModal(false)} />
      </>);
    }
    render(<H />);
    await wait(10);
    const seen: boolean[] = [];
    const mo = new MutationObserver(() => seen.push(html().classList.contains('wl-layer-open')));
    mo.observe(html(), { attributes: true, attributeFilter: ['class'] });
    fireEvent.click(screen.getByText('scegli'));
    await wait(10);
    mo.disconnect();
    expect(html()).toHaveClass('wl-layer-open');
    expect(seen).not.toContain(false);
  });

  test('il CSS blocca lo scorrimento e il "tira giù per ricaricare" con una finestra aperta', () => {
    const css = read('app/globals.css');
    const rule = css.slice(css.indexOf('html.wl-layer-open,'));
    expect(rule).toMatch(/html\.wl-layer-open body\s*\{[^}]*overflow:\s*hidden;[^}]*overscroll-behavior:\s*none;/);
  });
});

describe('finestre legate alla parte visibile dello schermo (tastiera)', () => {
  test('con una finestra aperta --wl-vv-height/--wl-vv-top seguono visualViewport; chiusa, spariscono', async () => {
    const vv = installVisualViewport(768);
    function H() {
      const [open, setOpen] = useState(true);
      return (<>
        <button onClick={() => setOpen(false)}>chiudi</button>
        <Layer open={open} onBack={() => setOpen(false)} />
      </>);
    }
    render(<H />);
    await wait(10);
    expect(html().style.getPropertyValue(VV_HEIGHT_VAR)).toBe('768px');
    expect(html().style.getPropertyValue(VV_TOP_VAR)).toBe('0px');
    expect(html()).not.toHaveClass('wl-keyboard-open');

    // Si apre la tastiera: la parte visibile si accorcia e Safari la sposta in giù.
    vv.height = 420; vv.offsetTop = 180;
    await act(async () => { vv.dispatchEvent(new Event('resize')); vv.dispatchEvent(new Event('scroll')); });
    await wait(40);
    expect(html().style.getPropertyValue(VV_HEIGHT_VAR)).toBe('420px');
    expect(html().style.getPropertyValue(VV_TOP_VAR)).toBe('180px');
    expect(html()).toHaveClass('wl-keyboard-open');

    fireEvent.click(screen.getByText('chiudi'));
    await wait(10);
    expect(html().style.getPropertyValue(VV_HEIGHT_VAR)).toBe('');
    expect(html().style.getPropertyValue(VV_TOP_VAR)).toBe('');
    expect(html()).not.toHaveClass('wl-keyboard-open');
    // Finestra chiusa: la tastiera della pagina non tocca più niente.
    vv.height = 300;
    await act(async () => { vv.dispatchEvent(new Event('resize')); });
    await wait(40);
    expect(html().style.getPropertyValue(VV_HEIGHT_VAR)).toBe('');
  });

  test('aperta la tastiera, il campo in cui si scrive viene portato in vista dentro la finestra', async () => {
    const vv = installVisualViewport(768);
    const spy = jest.fn();
    const proto = window.HTMLElement.prototype as any;
    const original = proto.scrollIntoView;
    proto.scrollIntoView = spy;
    try {
      render(<Layer open onBack={() => {}}><textarea data-testid="campo" /></Layer>);
      await wait(10);
      (screen.getByTestId('campo') as HTMLTextAreaElement).focus();
      vv.height = 400;
      await act(async () => { vv.dispatchEvent(new Event('resize')); });
      await wait(120);
      expect(spy).toHaveBeenCalledWith({ block: 'nearest' });
      expect(spy.mock.instances[0]).toBe(screen.getByTestId('campo'));
    } finally {
      proto.scrollIntoView = original;
    }
  });

  test('con lo zoom (scala > 1) una parte visibile più piccola non vale come tastiera', async () => {
    const vv = installVisualViewport(768);
    render(<Layer open onBack={() => {}} />);
    await wait(10);
    vv.height = 400; vv.scale = 1.9;
    await act(async () => { vv.dispatchEvent(new Event('resize')); });
    await wait(40);
    expect(html().style.getPropertyValue(VV_HEIGHT_VAR)).toBe('400px');
    expect(html()).not.toHaveClass('wl-keyboard-open');
  });

  test('il CSS: .wl-viewport usa le variabili, con tutta l\'altezza come riserva', () => {
    const css = read('app/globals.css');
    const block = css.slice(css.indexOf('.wl-viewport {'), css.indexOf('}', css.indexOf('.wl-viewport {')));
    expect(block).toMatch(/position:\s*fixed/);
    expect(block).toMatch(/top:\s*var\(--wl-vv-top,\s*0px\)/);
    expect(block).toMatch(/height:\s*var\(--wl-vv-height,\s*100%\)/);
    expect(css).toMatch(/html\.wl-keyboard-open \.wl-hide-on-keyboard\s*\{\s*display:\s*none;/);
  });
});

describe('finestra del messaggio (ScheduleModal)', () => {
  const contact = { number: '393331234567', name: 'Mario Rossi' };
  const base = { open: true, onClose: () => {}, onBack: () => {}, contact, onScheduled: () => {} };

  beforeEach(() => { (global as any).fetch = jest.fn(); });

  test('legata alla parte visibile, testata fissa in cima con il margine per la tacca', () => {
    render(<ScheduleModal {...base} />);
    const modal = screen.getByTestId('schedule-modal');
    expect(modal).toHaveClass('wl-viewport');
    expect(modal.className).not.toMatch(/\binset-0\b/);
    const header = screen.getByTestId('schedule-modal-header');
    expect(header.className).toMatch(/pt-\[env\(safe-area-inset-top\)\]/);
    expect(header).toHaveClass('shrink-0');
    expect(within(header).getByRole('button', { name: 'Indietro' })).toBeInTheDocument();
    // La testata non sta nella parte che scorre: non può uscire dallo schermo scorrendo.
    expect(screen.getByTestId('schedule-modal-scroll').contains(header)).toBe(false);
  });

  test('"Invia" sta sotto la parte che scorre, mai dentro: resta attaccato sopra la tastiera', () => {
    render(<ScheduleModal {...base} />);
    const scroll = screen.getByTestId('schedule-modal-scroll');
    const send = screen.getByRole('button', { name: 'Invia' });
    expect(scroll.contains(send)).toBe(false);
    expect(scroll.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(scroll).toHaveClass('flex-1', 'overflow-y-auto', 'overscroll-contain');
  });

  test('con la tastiera aperta spariscono le righe grigie di contorno', () => {
    render(<ScheduleModal {...base} />);
    expect(screen.getByTestId('disconnect-microcopy')).toHaveClass('wl-hide-on-keyboard');
    render(<ScheduleModal {...base} contact={{ number: '120363000000000001@g.us', name: 'Under 12', kind: 'group', size: 19, hint: null } as any} />);
    expect(screen.getByTestId('group-hint')).toHaveClass('wl-hide-on-keyboard');
  });

  test('con la tastiera aperta gli avvisi gialli non mangiano il campo (revisione B3)', () => {
    // Domenica 4 ottobre alle 22:30 (fascia oraria), serie in modifica, limite di
    // oggi già pieno, WhatsApp scollegato: prima, con la tastiera aperta, il campo
    // spariva e Invia finiva tagliato sotto il bordo.
    const todayLimit = { limit: 5, plan_limit: 50, sent: 5, queued: 0, later: 0, later_days: 0, warmup: true, paired_at: new Date(Date.now() - 86_400_000).toISOString(), day: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date()) };
    const at = new Date(Date.now() + 3 * 3_600_000);
    render(<ScheduleModal {...base} connected={false} editMsgId="m1" initialMessage="Allenamento" initialRecurrenceRule="FREQ=DAILY" initialScheduledAt={at.toISOString()} todayLimit={todayLimit} queue={[]} />);
    // Quelli che dicono la serie e quando parte: una riga sola; gli altri: via.
    expect(screen.getByTestId('series-edit-note')).toHaveClass('wl-clamp-on-keyboard');
    expect(screen.getByTestId('day-full-warning')).toHaveClass('wl-clamp-on-keyboard');
    expect(screen.getByTestId('disconnected-warning')).toHaveClass('wl-hide-on-keyboard');
    // Nella parte fissa, oltre a Invia, nessun avviso resta intero con la tastiera.
    const scroll = screen.getByTestId('schedule-modal-scroll');
    for (const el of Array.from(document.querySelectorAll('[role="status"]'))) {
      if (scroll.contains(el)) continue;
      expect(el.className).toMatch(/wl-(hide|clamp)-on-keyboard/);
    }
    const css = read('app/globals.css');
    const clamp = css.slice(css.indexOf('html.wl-keyboard-open .wl-clamp-on-keyboard'), css.indexOf('}', css.indexOf('html.wl-keyboard-open .wl-clamp-on-keyboard')));
    expect(clamp).toMatch(/white-space:\s*nowrap/);
    expect(clamp).toMatch(/overflow:\s*hidden/);
    expect(clamp).toMatch(/text-overflow:\s*ellipsis/);
  });

  test('avviso della fascia oraria: via con la tastiera', () => {
    // 22:30 a Roma (10 gennaio 2030, ora solare).
    render(<ScheduleModal {...base} editMsgId="m1" initialMessage="Ciao" initialScheduledAt="2030-01-10T21:30:00.000Z" />);
    const w = screen.getByTestId('courtesy-warning');
    expect(w).toHaveTextContent(/22:30/);
    expect(w).toHaveClass('wl-hide-on-keyboard');
  });

  test('i fogli che si aprono dalla finestra seguono anche loro la parte visibile', () => {
    render(<RecurrenceBottomSheet open onClose={() => {}} value="none" onChange={() => {}} referenceDate={new Date(2026, 9, 8, 11, 0)} />);
    const sheet = screen.getByRole('dialog');
    const overlay = sheet.closest('.wl-viewport') ?? sheet;
    expect(overlay).toHaveClass('wl-viewport');
    // Niente più `fixed inset-0` in nessuna finestra o foglio della dashboard.
    for (const f of [
      'components/ScheduleModal.tsx', 'components/ContactPickerModal.tsx', 'app/components/MessageActionsSheet.tsx',
      'app/dashboard/LogoutDialog.tsx', 'app/components/MessagesSection.tsx',
      'components/schedule/RecurrenceBottomSheet.tsx', 'components/schedule/ReminderBottomSheet.tsx',
      'components/schedule/TemplateBottomSheet.tsx', 'components/schedule/MediaPicker.tsx',
      'components/schedule/DarkCalendarDialog.tsx', 'components/schedule/AnalogClockDialog.tsx',
      'components/LabelManagerSheet.tsx', 'components/LabelCreateModal.tsx', 'components/CsvImportDialog.tsx',
    ]) {
      expect({ f, inset: /className="fixed inset-0/.test(read(f)) }).toEqual({ f, inset: false });
    }
  });
});

describe('selettore (ContactPickerModal)', () => {
  test('contenitore legato alla parte visibile; la lista non passa il trascinamento alla pagina', () => {
    const src = read('components/ContactPickerModal.tsx');
    expect(src).toMatch(/className="wl-viewport z-modal bg-black\/60/);
    // Il contenitore interno segue quello esterno, non la pagina intera.
    expect(src).toMatch(/className="absolute inset-0 sm:static/);
    expect(src).toMatch(/className="flex-1 min-h-0 overflow-y-auto overscroll-contain"/);
    // Testata già con il margine per la tacca.
    expect(src).toMatch(/pt-\[max\(env\(safe-area-inset-top\),12px\)\]/);
  });
});

describe('Indietro chiude solo il foglio aperto', () => {
  test('foglio azioni (⋮): Indietro lo chiude e la pagina sotto resta', async () => {
    function H() {
      const [open, setOpen] = useState(false);
      return (<div>
        <p>Lista messaggi</p>
        <button onClick={() => setOpen(true)}>⋮</button>
        <MessageActionsSheet
          open={open} onClose={() => setOpen(false)} title="Smoke test"
          onDuplicate={() => {}} onEdit={() => {}} onPauseToggle={() => {}} onRetry={() => {}} onDelete={() => {}}
          isPaused={false} canEdit canPause canRetry={false} canDelete
        />
      </div>);
    }
    render(<H />);
    const before = window.history.length;
    fireEvent.click(screen.getByText('⋮'));
    await wait(10);
    expect(screen.getByTestId('message-actions-sheet')).toHaveClass('wl-viewport');
    expect(window.history.length).toBe(before + 1);
    expect(html()).toHaveClass('wl-layer-open');
    // Il vecchio blocco a mano sul body non c'è più: lo fa lo strato.
    expect(document.body.style.overflow).toBe('');

    await pressBack();
    expect(screen.queryByTestId('message-actions-sheet')).not.toBeInTheDocument();
    expect(screen.getByText('Lista messaggi')).toBeInTheDocument();
    expect(openModalLayerCount()).toBe(0);
    await wait(10);
    expect(html()).not.toHaveClass('wl-layer-open');
  });

  test('"Vuoi uscire?": Indietro vale "Resta collegato", non esce', async () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    function H() {
      const [open, setOpen] = useState(true);
      return <LogoutDialog open={open} pendingCount={2} onCancel={() => { onCancel(); setOpen(false); }} onConfirm={onConfirm} />;
    }
    render(<H />);
    await wait(10);
    const overlay = screen.getByTestId('logout-overlay');
    expect(overlay).toHaveClass('wl-viewport');
    // Con la coda le scelte sono tante: la finestra scorre da sola, con il margine in basso.
    expect(screen.getByRole('dialog')).toHaveClass('max-h-full', 'overflow-y-auto', 'overscroll-contain', 'pb-safe');
    await pressBack();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('"Promemoria ricorrente" (Elimina su una serie): Indietro chiude la domanda e non elimina', async () => {
    const onDelete = jest.fn();
    const msg: ScheduledMessage = {
      id: 'm1', recipient_name: 'Genitori catechismo', recipient_number: '393331234567', parsed_message: 'Catechismo alle 17',
      scheduled_at: new Date(Date.now() + 3 * 3600 * 1000).toISOString(), status: 'pending', recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU',
    } as ScheduledMessage;
    const props = {
      onDelete, onDuplicate: jest.fn(), onEdit: jest.fn(), onPauseToggle: jest.fn(),
      onRetry: jest.fn(), onSnooze: jest.fn(), onShowToast: jest.fn(), onChooseOtherContact: jest.fn(), connected: true,
    };
    render(<MessagesSection {...(props as any)} messages={[msg]} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Azioni messaggio' })[0]);
    await wait(10);
    fireEvent.click(screen.getByText('Elimina'));
    await wait(10);
    const dialog = screen.getByTestId('recurring-delete-dialog');
    expect(dialog.parentElement).toHaveClass('wl-viewport');
    // Il foglio azioni ha passato la sua voce alla domanda: una voce sola, non due.
    expect(window.history.state.__wlModal).toBe(1);

    await pressBack();
    expect(screen.queryByTestId('recurring-delete-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('message-actions-sheet')).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Catechismo alle 17')).toBeInTheDocument();
  });
});

describe('dashboard', () => {
  const resp = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const lastFriday = new Date(Date.now() - 4 * 86400_000).toISOString();

  function mockFetch(messages: unknown[]) {
    (global as any).fetch = jest.fn(async (url: string, init?: any): Promise<any> => {
      const method = init?.method || 'GET';
      if (url === '/api/auth/me') return resp({ phone: '393331112222', instanceName: 'X' });
      if (url === '/api/messages' && method === 'GET') {
        return resp({ messages, subscription_plan: 'beta', raw_plan: 'free', billing_enabled: false, connection_status: 'open', total_scheduled_lifetime: 5 });
      }
      return resp({});
    });
  }
  async function renderPage() {
    await act(async () => { render(<DashboardPage />); });
  }

  test('la barra in alto sparisce mentre una finestra è aperta e torna alla chiusura', async () => {
    mockFetch([]);
    await renderPage();
    const nav = await screen.findByTestId('dashboard-nav');
    expect(nav).not.toHaveClass('invisible');
    expect(nav).not.toHaveAttribute('aria-hidden');

    fireEvent.click(screen.getAllByRole('button', { name: /Programma un messaggio/ })[0]);
    await wait(10);
    expect(screen.getByTestId('contact-picker')).toBeInTheDocument();
    expect(nav).toHaveClass('invisible');
    expect(nav).toHaveAttribute('aria-hidden', 'true');

    await pressBack();
    expect(screen.queryByTestId('contact-picker')).not.toBeInTheDocument();
    expect(nav).not.toHaveClass('invisible');
  });

  test('"L\'orario è già passato": Indietro lo chiude e il messaggio resta in pausa', async () => {
    const paused = { id: 'p1', recipient_name: 'Luca', recipient_number: '393334445566', parsed_message: 'Domani alle 9 hai la guida', scheduled_at: lastFriday, status: 'paused' };
    mockFetch([paused]);
    await renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Azioni messaggio' }))[0]);
    await act(async () => { fireEvent.click(screen.getByText('Riprendi invio')); });
    const dialog = await screen.findByTestId('time-passed-dialog');
    expect(dialog.parentElement).toHaveClass('wl-viewport');
    expect(dialog).toHaveClass('pb-safe');
    await wait(10);
    expect(window.history.state.__wlModal).toBe(1);

    await pressBack();
    expect(screen.queryByTestId('time-passed-dialog')).not.toBeInTheDocument();
    const patches = ((global as any).fetch as jest.Mock).mock.calls.filter((c: any[]) => c[1]?.method === 'PATCH');
    expect(patches).toHaveLength(0);
    expect(screen.getByText('Domani alle 9 hai la guida')).toBeInTheDocument();
  });

  test('il pulsante tondo su telefono sta sopra la barretta dell\'iPhone', async () => {
    mockFetch([]);
    await renderPage();
    expect((await screen.findByTestId('mobile-fab')).className).toMatch(/bottom-\[calc\(1\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
  });
});

describe('fondo scuro sopra e sotto (T10) e margini (B5)', () => {
  test('la dashboard ha il suo colore della barra del browser, scuro', () => {
    expect(dashboardViewport.themeColor).toBe('#111B21');
    // Il resto del sito resta com'era.
    expect(read('app/layout.tsx')).toMatch(/themeColor: '#075E54'/);
  });

  test('la dashboard è avvolta in .app-dark, e il CSS colora html e body', () => {
    const { container } = render(<DashboardLayout><p>pagina</p></DashboardLayout>);
    expect(container.firstChild).toHaveClass('app-dark');
    const css = read('app/globals.css');
    expect(css).toMatch(/html:has\(\.app-dark\),\s*html:has\(\.app-dark\) body\s*\{\s*background-color:\s*#111B21;/);
  });

  test('pb-safe esiste: almeno 1.25rem, di più se l\'iPhone ha la barretta', () => {
    const css = read('app/globals.css');
    expect(css).toMatch(/\.pb-safe\s*\{\s*padding-bottom:\s*max\(1\.25rem,\s*env\(safe-area-inset-bottom\)\);/);
    // Fuori da @layer: deve vincere su p-5 dei fogli.
    expect(css.lastIndexOf('.pb-safe')).toBeGreaterThan(css.lastIndexOf('@tailwind utilities'));
  });
});
