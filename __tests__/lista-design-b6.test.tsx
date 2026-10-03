/**
 * @jest-environment jsdom
 *
 * Rapporto 360, B6 — lista e design di base (T14, T22, T24, T26, T33-T35):
 * un tocco sulla riga apre il menu (i comandi dentro la riga restano loro),
 * data e ora "sab 10 ott · 18:00" a 14px, un solo segno di stato, l'avatar del
 * gruppo con l'icona, ⋮ e X da 44px con il loro nome, testata del selettore
 * con la sola X (CSV in fondo alla lista), campo del messaggio a tutta
 * larghezza, verde solo per le azioni, contrasti WCAG AA dei grigi scelti.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import MessagesSection, { type ScheduledMessage } from '../app/components/MessagesSection';
import ContactPickerModal from '../components/ContactPickerModal';
import ScheduleModal from '../components/ScheduleModal';
import { clearContactsSnapshots } from '../app/lib/contacts-client-cache';
import { formatRowWhen } from '../app/lib/schedule-quick';

// Martedì 6 ottobre 2026, 10:00 a Roma.
const NOW = new Date('2026-10-06T08:00:00Z');
const SAT_18 = '2026-10-10T16:00:00.000Z'; // sabato 10 ottobre, 18:00 a Roma
const GROUP_JID = '120363000000000001@g.us';

function msg(over: Partial<ScheduledMessage>): ScheduledMessage {
  return {
    id: 'm1', recipient_name: 'Mario Rossi', recipient_number: '393331234567', parsed_message: 'Allenamento alle 18',
    scheduled_at: SAT_18, status: 'pending', ...over,
  };
}

function setup(messages: ScheduledMessage[]) {
  const props = {
    onDelete: jest.fn(), onDuplicate: jest.fn(), onEdit: jest.fn(), onPauseToggle: jest.fn(),
    onRetry: jest.fn(), onSnooze: jest.fn(), onShowToast: jest.fn(), onChooseOtherContact: jest.fn(),
    connected: true,
  };
  render(<MessagesSection {...(props as any)} messages={messages} />);
  return props;
}

const sheet = () => screen.queryByTestId('message-actions-sheet');
const showSent = () => fireEvent.click(screen.getByRole('button', { name: /Inviati/ }));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  clearContactsSnapshots();
});

describe('T14 — un tocco sulla riga apre il menu', () => {
  test('tocco sul testo della riga → si apre il foglio azioni col nome', () => {
    setup([msg({})]);
    expect(sheet()).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Allenamento alle 18'));
    expect(sheet()).toBeInTheDocument();
    expect(within(sheet()!).getByText('Mario Rossi')).toBeInTheDocument();
  });

  test('anche il ⋮ apre il foglio; ha un nome e misura 44×44', () => {
    setup([msg({})]);
    const dots = screen.getByRole('button', { name: 'Azioni messaggio' });
    expect(dots).toHaveClass('w-11', 'h-11');
    expect(dots).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(dots);
    expect(sheet()).toBeInTheDocument();
  });

  test('la riga è toccabile ma non selezionabile', () => {
    setup([msg({})]);
    const row = screen.getByTestId('message-row');
    expect(row).toHaveClass('cursor-pointer', 'select-none');
  });

  test('pressione lunga: il foglio si apre a 500 ms e il tocco al rilascio non lo richiude', () => {
    setup([msg({})]);
    const row = screen.getByTestId('message-row');
    fireEvent.touchStart(row);
    act(() => { jest.advanceTimersByTime(499); });
    expect(sheet()).not.toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(1); });
    expect(sheet()).toBeInTheDocument();
    // Il rilascio annulla il "click" del telefono (preventDefault → false).
    expect(fireEvent.touchEnd(row)).toBe(false);
    fireEvent.click(row);
    expect(sheet()).toBeInTheDocument();
  });

  test('un trascinamento (scorrere la lista) non apre niente', () => {
    setup([msg({})]);
    const row = screen.getByTestId('message-row');
    fireEvent.touchStart(row);
    fireEvent.touchMove(row);
    act(() => { jest.advanceTimersByTime(800); });
    expect(sheet()).not.toBeInTheDocument();
    expect(fireEvent.touchEnd(row)).toBe(true);
  });

  test('tasto destro da computer apre il foglio', () => {
    setup([msg({})]);
    fireEvent.contextMenu(screen.getByTestId('message-row'));
    expect(sheet()).toBeInTheDocument();
  });

  test('card rossa: il tocco sulla card apre il menu, "Riprova" fa solo Riprova', async () => {
    const p = setup([msg({ status: 'failed', scheduled_at: '2026-10-06T07:00:00.000Z', error_message: 'HTTP 500: Internal Server Error' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
    expect(sheet()).not.toBeInTheDocument();
    await act(async () => {}); // fine del "Rimetto in coda…"
    fireEvent.click(screen.getByText('Allenamento alle 18'));
    expect(sheet()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Azioni messaggio' })).toHaveClass('w-11', 'h-11');
  });

  test('il foglio insegna il tocco e la sua X è da 44px', () => {
    setup([msg({})]);
    fireEvent.click(screen.getByText('Allenamento alle 18'));
    expect(screen.getByText('Tocca un messaggio della lista per aprire questo menu.')).toBeInTheDocument();
    expect(within(sheet()!).getByRole('button', { name: 'Chiudi' })).toHaveClass('w-11', 'h-11');
  });
});

describe('T22 — data e ora con il giorno, a 14px e chiare', () => {
  test('in coda: "sab 10 ott · 18:00", 14px #D1D5DB, senza l\'orologio doppio', () => {
    setup([msg({})]);
    const when = screen.getByTestId('row-when');
    expect(when).toHaveTextContent('sab 10 ott · 18:00');
    expect(when).toHaveClass('text-sm', 'text-[#D1D5DB]');
    expect(when.className).not.toMatch(/text-\[11px\]|text-gray-500/);
    expect(when.querySelector('svg')).toBeNull();
  });

  test('negli Inviati la data e l\'ora vere dell\'invio, non "4 giorni fa"', () => {
    setup([msg({ status: 'sent', scheduled_at: '2026-10-02T16:00:00.000Z', sent_at: '2026-10-02T16:01:00.000Z', evolution_message_id: 'A1' })]);
    showSent();
    expect(screen.getByTestId('row-when')).toHaveTextContent('ven 2 ott · 18:01');
    expect(document.body.textContent).not.toMatch(/giorni fa/);
  });

  test('un altro anno lo dice', () => {
    expect(formatRowWhen(new Date(2025, 5, 3, 9, 5), new Date(2026, 9, 6))).toBe('mar 3 giu 2025 · 09:05');
    expect(formatRowWhen(new Date(2026, 9, 10, 18, 0), new Date(2026, 9, 6))).toBe('sab 10 ott · 18:00');
  });

  test('titoli dei gruppi di date a 12px #8696A0, non più 11px gray-500', () => {
    setup([msg({})]);
    const title = screen.getByRole('heading', { name: 'Questa settimana' });
    expect(title).toHaveClass('text-xs', 'text-[#8696A0]');
    expect(title.className).not.toMatch(/text-\[11px\]|text-gray-500/);
  });

  test('motivo di uno spostamento a 13px #AEBAC1', () => {
    setup([msg({ error_message: 'Istanza disconnessa per 12× 5min, riprogrammato a domani' })]);
    expect(screen.getByTestId('pending-reason')).toHaveClass('text-[13px]', 'text-[#AEBAC1]');
  });
});

describe('T34 — un solo segno di stato, avatar del gruppo', () => {
  test('inviato e consegnato: "✓✓ Consegnato", senza la pillola "✓ Inviato" accanto', () => {
    setup([msg({ status: 'sent', scheduled_at: '2026-10-06T07:00:00.000Z', sent_at: '2026-10-06T07:00:00.000Z', delivered_at: '2026-10-06T07:00:05.000Z', evolution_message_id: 'A1' })]);
    showSent();
    const row = screen.getByTestId('message-row');
    expect(within(row).getByTestId('status-delivered')).toHaveTextContent('Consegnato');
    expect(within(row).queryByTestId('status-badge')).not.toBeInTheDocument();
    expect(within(row).queryByText('Inviato')).not.toBeInTheDocument();
  });

  test('letto: spunte blu e la parola "Letto"', () => {
    setup([msg({ status: 'sent', scheduled_at: '2026-10-06T07:00:00.000Z', read_at: '2026-10-06T07:10:00.000Z', evolution_message_id: 'A1' })]);
    showSent();
    const read = screen.getByTestId('status-read');
    expect(read).toHaveTextContent('Letto');
    expect(read.querySelector('svg')!.classList.contains('text-sky-400')).toBe(true);
  });

  test('gruppo inviato: "✓ Inviato" una volta sola, chip "Gruppo" neutro e avatar con l\'icona', () => {
    setup([msg({ recipient_name: 'Prova whatslater', recipient_number: GROUP_JID, status: 'sent', scheduled_at: '2026-10-06T07:00:00.000Z', evolution_message_id: 'A1' })]);
    showSent();
    const row = screen.getByTestId('message-row');
    expect(within(row).getAllByText('Inviato')).toHaveLength(1);
    expect(within(row).getByTestId('status-sent')).toHaveAttribute('title', 'Inviato nel gruppo (per i gruppi WhatsApp non ci manda le spunte di consegna)');
    expect(within(row).queryByTestId('status-badge')).not.toBeInTheDocument();
    const tag = within(row).getByTestId('group-tag');
    expect(tag.className).not.toMatch(/1F5A45|BFF0D5|emerald|primary/);
    const avatar = row.querySelector('[data-variant="group"]')!;
    expect(avatar.textContent).toBe('');
    expect(avatar.querySelector('svg.lucide-users')).toBeInTheDocument();
  });

  test('in coda: solo la pillola "Parte tra …", nessuna spunta', () => {
    setup([msg({})]);
    const row = screen.getByTestId('message-row');
    expect(within(row).getByTestId('status-badge')).toHaveTextContent('Parte tra 4 giorni');
    expect(within(row).getByTestId('status-badge')).toHaveClass('text-xs');
    expect(within(row).queryByTestId('status-sent')).not.toBeInTheDocument();
  });
});

describe('T35 — verde solo per le azioni (lista)', () => {
  test('"Prossimo invio …" non è verde', () => {
    setup([msg({})]);
    const next = screen.getByText(/^Prossimo invio/);
    expect(next.innerHTML).not.toMatch(/text-primary/);
  });

  test('chip allegato e chip "Gruppo" neutri', () => {
    setup([msg({ media_type: 'document', media_filename: 'orari.pdf' })]);
    expect(screen.getByTestId('attachment-chip').className).not.toMatch(/emerald|primary/);
  });
});

function mockFetchContacts(contacts: any[], recents: any[] = []) {
  const body = { contacts, recents };
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok: true, status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  });
}

describe('T33 — testata del selettore', () => {
  beforeEach(() => { jest.useRealTimers(); });

  test('in testata solo la X "Chiudi" da 44px; il CSV è l\'ultima riga della lista e apre l\'importazione', async () => {
    mockFetchContacts([{ number: '393331111111', name: 'Mario' }], [{ number: '393332222222', name: 'Anna' }]);
    const onClose = jest.fn();
    render(<ContactPickerModal open={true} onClose={onClose} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Mario')).toBeInTheDocument());

    const header = screen.getByRole('heading', { name: 'Nuovo messaggio' }).parentElement!;
    const headerButtons = within(header).getAllByRole('button');
    expect(headerButtons).toHaveLength(1);
    expect(headerButtons[0]).toHaveAccessibleName('Chiudi');
    expect(headerButtons[0]).toHaveClass('w-11', 'h-11');
    expect(within(header).queryByRole('button', { name: /Importa/ })).not.toBeInTheDocument();

    const scroll = screen.getByTestId('contact-picker-scroll');
    const rows = within(scroll).getAllByRole('button');
    const csv = screen.getByRole('button', { name: 'Importa un elenco di contatti (file CSV)' });
    expect(rows[rows.length - 1]).toBe(csv);
    fireEvent.click(csv);
    expect(screen.getByRole('heading', { name: 'Importa un elenco di contatti (file CSV)' })).toBeInTheDocument();

    fireEvent.click(headerButtons[0]);
    expect(onClose).toHaveBeenCalled();
  });

  test('titoli "Recenti" e "Contatti su WhatsApp" grigi, non verdi', async () => {
    mockFetchContacts([{ number: '393331111111', name: 'Mario' }], [{ number: '393332222222', name: 'Anna' }]);
    render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Mario')).toBeInTheDocument());
    for (const name of [/^Recenti$/, /^Contatti su WhatsApp/]) {
      const h = screen.getByRole('heading', { name });
      expect(h).toHaveStyle({ color: '#8696A0' });
      expect(h.getAttribute('style') || '').not.toMatch(/25D366|37, 211, 102/i);
    }
  });
});

describe('T26/T33/T35 — finestra del messaggio', () => {
  const contact = { number: '393331234567', name: 'Mario Rossi' };
  const base = { open: true, onClose: () => {}, onBack: () => {}, contact, onScheduled: () => {} };

  beforeEach(() => {
    jest.useRealTimers();
    (global as any).fetch = jest.fn();
  });

  test('campo del messaggio a tutta larghezza: niente graffetta dentro il riquadro', () => {
    render(<ScheduleModal {...base} />);
    const field = screen.getByRole('textbox', { name: 'Messaggio' });
    expect(field).toHaveClass('w-full', 'px-3', 'text-base');
    const box = field.parentElement!;
    expect(within(box).queryAllByRole('button')).toHaveLength(0);
    // "Allega" sta nella riga sotto, a vista, e apre la scelta dell'allegato.
    const clip = screen.getByRole('button', { name: 'Allega' });
    expect(box.contains(clip)).toBe(false);
    expect(clip).toHaveClass('min-h-[44px]');
    fireEvent.click(clip);
    expect(screen.getByRole('dialog', { name: 'Allega' })).toBeInTheDocument();
  });

  test('X "Chiudi" e freccia "Indietro" da 44px', () => {
    render(<ScheduleModal {...base} />);
    expect(screen.getByRole('button', { name: 'Chiudi' })).toHaveClass('w-11', 'h-11');
    expect(screen.getByRole('button', { name: 'Indietro' })).toHaveClass('w-11', 'h-11');
  });

  test('chip della data scelta: segnato (aria-pressed) ma non verde', () => {
    render(<ScheduleModal {...base} />);
    const chips = screen.getAllByRole('button', { pressed: true });
    expect(chips.length).toBe(1);
    expect(chips[0].className).not.toMatch(/text-primary|bg-primary|border-primary/);
  });

  test('valore di Ripeti grigio chiaro, non verde', () => {
    render(<ScheduleModal {...base} initialMessage="Allenamento" editMsgId="msg-1" initialScheduledAt="2026-10-05T16:00:00.000Z" initialRecurrenceRule="FREQ=WEEKLY;BYDAY=MO,TH" />);
    const row = screen.getByTestId('recurrence-row');
    const value = within(row).getByText('Ogni lunedì e giovedì');
    expect(value).toHaveClass('text-[#D1D5DB]');
    expect(row.innerHTML).not.toMatch(/text-primary/);
  });

  test('note sotto la finestra a 13px #AEBAC1', () => {
    render(<ScheduleModal {...base} connected />);
    expect(screen.getByTestId('disconnect-microcopy')).toHaveClass('text-[13px]', 'text-[#AEBAC1]');
  });
});

// Contrasti WCAG 2.1 (formula della luminanza relativa) delle coppie scelte:
// tutte ≥ 4,5:1 (AA per il testo normale). I valori "prima" restano qui come
// promemoria di cosa non passava.
function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

describe('contrasti dei testi grigi', () => {
  test.each([
    ['data e ora della riga', '#D1D5DB', '#202C33', 9.7],
    ['titoli dei gruppi di date', '#8696A0', '#111B21', 5.7],
    ['titoli del selettore', '#8696A0', '#111B21', 5.7],
    ['motivo di uno spostamento', '#AEBAC1', '#202C33', 7.2],
    ['spunte e "Inviato"', '#AEBAC1', '#202C33', 7.2],
    ['⋮ della riga', '#AEBAC1', '#202C33', 7.2],
    ['note sotto la finestra', '#AEBAC1', '#111B21', 8.8],
    ['valore di Ripeti', '#D1D5DB', '#111B21', 11.9],
    ['contatore dei caratteri', '#8696A0', '#111B21', 5.7],
    ['piè di pagina', '#8696A0', '#0B141A', 6.1],
    ['"Messaggio" nel foglio azioni', '#8696A0', '#1F2C33', 4.7],
    ['scritta del pulsante "+ Programma"', '#0B141A', '#25D366', 9.4],
  ])('%s: %s su %s ≈ %s:1', (_label, fg, bg, expected) => {
    const r = contrast(fg, bg);
    expect(r).toBeGreaterThanOrEqual(4.5);
    expect(r).toBeCloseTo(expected, 0);
  });

  test('prima: 11px #6B7280 su #202C33 non passava (2,96:1)', () => {
    expect(contrast('#6B7280', '#202C33')).toBeLessThan(3);
  });
});
