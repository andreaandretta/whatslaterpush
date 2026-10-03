/**
 * @jest-environment jsdom
 *
 * ScheduleModal e foglio Ripeti — correzioni rapide del rapporto 360 (2 ott 2026):
 * A2 il pulsante Invia spento dice perché, A3 l'ora proposta ha margine e non
 * cade di sera tardi, A4 la modifica di una serie avvisa che vale per le
 * prossime volte, A5 il foglio Ripeti mostra il primo invio e dice "l'8".
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ScheduleModal from '../components/ScheduleModal';
import { RecurrenceBottomSheet, recurrenceLabel } from '../components/schedule/RecurrenceBottomSheet';
import { TemplateBottomSheet } from '../components/schedule/TemplateBottomSheet';

const contact = { number: '393331234567', name: 'Mario Rossi' };
const group = { number: '120363000000000001@g.us', name: 'Under 12 – Genitori', kind: 'group' as const, size: 19, hint: null };
const base = { open: true, onClose: () => {}, onBack: () => {}, contact, onScheduled: () => {} };
const textarea = () => screen.getByPlaceholderText(/Scrivi il messaggio/i);
const sendButton = () => screen.getByRole('button', { name: 'Invia' });
const hint = () => screen.queryByTestId('send-fab-hint');

beforeEach(() => {
  (global as any).fetch = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('A2 — il pulsante Invia spento dice perché', () => {
  test('testo vuoto → "Scrivi il messaggio o allega un file.", fuori dall\'area che scorre', () => {
    render(<ScheduleModal {...base} />);
    expect(sendButton()).toBeDisabled();
    expect(hint()).toHaveTextContent('Scrivi il messaggio o allega un file.');
    expect(sendButton()).toHaveAttribute('aria-describedby', 'send-fab-hint');
    // La riga sta accanto al pulsante, non dentro lo scroll del modulo.
    expect(hint()!.closest('.overflow-y-auto')).toBeNull();
  });

  test('testo scritto → nessuna riga, pulsante attivo e verde con testo scuro', () => {
    render(<ScheduleModal {...base} />);
    fireEvent.change(textarea(), { target: { value: 'Allenamento alle 18' } });
    expect(sendButton()).toBeEnabled();
    expect(hint()).not.toBeInTheDocument();
    expect(sendButton().className).toMatch(/text-\[#0B141A\]/);
  });

  test('{nome} in un gruppo → il motivo è detto accanto al pulsante', () => {
    render(<ScheduleModal {...base} contact={group} />);
    fireEvent.change(textarea(), { target: { value: 'Ciao {nome}, domani partita' } });
    expect(sendButton()).toBeDisabled();
    expect(hint()).toHaveTextContent('{nome} non si usa nei gruppi: toglilo dal messaggio.');
  });

  test('campi del modello da completare → "Completa: {giorno}"', () => {
    render(<ScheduleModal {...base} />);
    fireEvent.change(textarea(), { target: { value: 'Allenamento {giorno} alle 18' } });
    expect(sendButton()).toBeDisabled();
    expect(hint()).toHaveTextContent('Completa: {giorno}');
  });

  test('l\'orario passa mentre si scrive → "L\'orario è già passato: tocca l\'ora per cambiarla."', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-08T08:59:00Z')); // 10:59 a Roma
    render(<ScheduleModal {...base} />);
    fireEvent.change(textarea(), { target: { value: 'Allenamento' } });
    expect(sendButton()).toBeEnabled();
    act(() => { jest.setSystemTime(new Date('2026-10-08T10:00:00Z')); }); // 12:00 a Roma
    fireEvent.change(textarea(), { target: { value: 'Allenamento!' } });
    expect(sendButton()).toBeDisabled();
    expect(hint()).toHaveTextContent("L'orario è già passato: tocca l'ora per cambiarla.");
  });
});

describe('chip "Inserisci il nome" (revisione)', () => {
  test('area di tocco di almeno 44px, testo a 13px', () => {
    render(<ScheduleModal {...base} />);
    const chip = screen.getByRole('button', { name: 'Inserisci il nome' });
    expect(chip.className).toMatch(/min-h-\[44px\]/);
    expect(chip.querySelector('span')!.className).toMatch(/text-\[13px\]/);
    fireEvent.click(chip);
    expect(textarea()).toHaveValue('{nome}');
  });
});

describe('foglio Modelli: il conteggio si legge (revisione)', () => {
  test('"I miei (3)" sulla scheda verde: numero scuro, non gray-500', async () => {
    const mine = [1, 2, 3].map((i) => ({ id: 'u' + i, category: null, emoji: null, title: 'M' + i, body: 'Testo ' + i, source_template_id: null, use_count: 0, created_at: '', updated_at: '' }));
    (global as any).fetch = jest.fn((url: string) => Promise.resolve({ ok: true, json: async () => ({ templates: url.endsWith('/personal') ? mine : [] }) }));
    render(<TemplateBottomSheet open onClose={() => {}} onSelect={() => {}} />);
    const tab = screen.getByRole('tab', { name: /I miei/ });
    await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
    const count = screen.getByText('(3)');
    expect(count.className).toMatch(/text-\[#0B141A\]/);
    expect(count.className).not.toMatch(/gray-500/);
    fireEvent.click(screen.getByRole('tab', { name: /Pronti per te/ }));
    expect(screen.getByText('(3)').className).toMatch(/text-gray-400/);
  });
});

describe('A2 — giorno passato (revisione)', () => {
  test('la modale aperta a cavallo della mezzanotte: "Il giorno è già passato: tocca Oggi o Domani."', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-08T21:50:00Z')); // 23:50 a Roma
    render(<ScheduleModal {...base} initialMessage="Allenamento" editMsgId="msg-1" initialScheduledAt="2026-10-08T21:58:00Z" />);
    expect(sendButton()).toBeEnabled();
    act(() => { jest.setSystemTime(new Date('2026-10-08T22:05:00Z')); }); // 00:05 del 9
    fireEvent.change(textarea(), { target: { value: 'Allenamento!' } });
    expect(sendButton()).toBeDisabled();
    expect(hint()).toHaveTextContent('Il giorno è già passato: tocca Oggi o Domani.');
  });

  test('Modifica di un messaggio rimasto indietro riparte da un orario valido, senza riga', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-06T08:00:00Z')); // 6 ottobre, 10:00 a Roma
    render(<ScheduleModal {...base} initialMessage="Catechismo" editMsgId="msg-1" initialScheduledAt="2026-10-02T16:00:00Z" />);
    expect(sendButton()).toBeEnabled();
    expect(hint()).not.toBeInTheDocument();
  });
});

describe('A3 — ora proposta', () => {
  test('alle 10:59 propone le 11:30, non le 11:00', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-08T08:59:00Z')); // 10:59 a Roma
    render(<ScheduleModal {...base} />);
    expect(screen.getByRole('button', { name: 'Modifica orario' })).toHaveTextContent('11:30');
    expect(screen.getByRole('button', { name: /Invia/ })).toHaveTextContent('Invia oggi alle 11:30');
  });

  test('alle 21:09 propone domani alle 9:00, senza l\'avviso giallo della sera', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-08T19:09:00Z')); // 21:09 a Roma
    render(<ScheduleModal {...base} />);
    expect(screen.getByRole('button', { name: /Invia/ })).toHaveTextContent('Invia domani alle 9:00');
    expect(screen.queryByText(/potrebbe dormire/)).not.toBeInTheDocument();
  });

  test('la data non è più in maiuscolo forzato ("gio 8 ott", non "Gio 8 Ott")', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-08T08:59:00Z'));
    render(<ScheduleModal {...base} />);
    const date = screen.getByRole('button', { name: 'Modifica data' });
    expect(date).toHaveTextContent('gio 8 ott');
    expect(date.className).not.toMatch(/\bcapitalize\b/);
  });
});

describe('A4 — modifica di una serie', () => {
  function nextThursdayAt18(): string {
    const d = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    while (d.getDay() !== 4) d.setDate(d.getDate() + 1);
    d.setHours(18, 0, 0, 0);
    return d.toISOString();
  }

  test('una riga di una serie settimanale → "Le modifiche valgono anche per tutte le prossime volte (ogni giovedì)."', () => {
    render(<ScheduleModal {...base} initialMessage="Catechismo" editMsgId="msg-1" initialScheduledAt={nextThursdayAt18()} initialRecurrenceRule="FREQ=WEEKLY;BYDAY=TH" />);
    expect(screen.getByTestId('series-edit-note')).toHaveTextContent('Le modifiche valgono anche per tutte le prossime volte (ogni giovedì).');
  });

  test('regola che la modale non sa leggere → l\'avviso c\'è lo stesso', () => {
    // B2: "TU,TH" ora la modale la legge (più giorni insieme); scritta in un
    // ordine diverso dal suo non la riscriverebbe identica → resta com'è.
    render(<ScheduleModal {...base} initialMessage="Uscita" editMsgId="msg-1" initialScheduledAt={nextThursdayAt18()} initialRecurrenceRule="FREQ=WEEKLY;BYDAY=TH,TU" />);
    expect(screen.getByTestId('series-edit-note')).toHaveTextContent('ogni martedì e giovedì');
  });

  test('messaggio singolo in modifica, o messaggio nuovo → nessun avviso', () => {
    const { unmount } = render(<ScheduleModal {...base} initialMessage="Ciao" editMsgId="msg-1" initialScheduledAt={nextThursdayAt18()} />);
    expect(screen.queryByTestId('series-edit-note')).not.toBeInTheDocument();
    unmount();
    render(<ScheduleModal {...base} />);
    expect(screen.queryByTestId('series-edit-note')).not.toBeInTheDocument();
  });
});

describe('A5 — foglio Ripeti', () => {
  // Giovedì 8 ottobre 2026, 11:00 (ora locale dei selettori).
  const thu8 = new Date(2026, 9, 8, 11, 0, 0, 0);

  test('l\'elenco parte dal primo invio, in evidenza, poi le due volte dopo', () => {
    render(<RecurrenceBottomSheet open onClose={() => {}} value="weekly" onChange={() => {}} referenceDate={thu8} />);
    expect(screen.getByText('Quando parte')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/Primo invio: gio 8 ottobre/);
    expect(items[1]).toHaveTextContent(/15 ottobre/);
    expect(items[2]).toHaveTextContent(/22 ottobre/);
  });

  test('"L\'8 di ogni mese", e "Solo una volta" al posto di "Schedula una volta"', () => {
    render(<RecurrenceBottomSheet open onClose={() => {}} value="none" onChange={() => {}} referenceDate={thu8} />);
    expect(screen.getByRole('radio', { name: "L'8 di ogni mese" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Solo una volta' })).toBeInTheDocument();
    expect(screen.queryByText(/Schedula/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Solo una volta' }).className).toMatch(/text-\[#0B141A\]/);
  });

  test('recurrenceLabel: l\'1, l\'11, il 15, il 31 (o l\'ultimo giorno)', () => {
    expect(recurrenceLabel('monthly', new Date(2026, 9, 1))).toBe("L'1 di ogni mese");
    expect(recurrenceLabel('monthly', new Date(2026, 9, 11))).toBe("L'11 di ogni mese");
    expect(recurrenceLabel('monthly', new Date(2026, 9, 15))).toBe('Il 15 di ogni mese');
    expect(recurrenceLabel('monthly', new Date(2026, 9, 31))).toBe("Il 31 di ogni mese (o l'ultimo giorno)");
  });
});
