/**
 * @jest-environment jsdom
 *
 * "Ripeti" in vista (rapporto 360 B2, T5 e T17):
 * - la riga Ripeti sta sotto data e ora, sempre a vista (via "Opzioni avanzate");
 *   "Usa un modello" è un link sopra il campo del messaggio;
 * - nel foglio Ripeti si scelgono più giorni insieme (L M M G V S D): la regola
 *   FREQ=WEEKLY;BYDAY=MO,TH è già accettata da server e cron, nessuna migrazione;
 * - una serie in pausa con l'orario passato si riprende "dalla prossima volta"
 *   invece di mandare il vecchio avviso.
 * Orologio fermo: sabato 3 ottobre 2026, 12:00 a Roma.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('../app/components/CalendarSyncCard', () => () => null);
jest.mock('../app/components/InstallPrompt', () => () => null);
jest.mock('../app/components/InstallAppButton', () => () => null);
jest.mock('../app/components/PricingSection', () => () => null);
jest.mock('../app/components/FAQSection', () => () => null);
jest.mock('../app/lib/contacts-client-cache', () => ({ prefetchContacts: jest.fn(), setContactsCacheOwner: jest.fn(), getGroupsSnapshot: () => null }));
jest.mock('../components/ContactPickerModal', () => (p: any) => (p.open ? <div data-testid="contact-picker" /> : null));

import ScheduleModal from '../components/ScheduleModal';
import DashboardPage from '../app/dashboard/page';
import { buildRRule, recurrenceLabel, weeklyDays, firstWeeklySend } from '../components/schedule/RecurrenceBottomSheet';
import { weekdaysPhrase, recurrenceTagLabel, resumeNextOccurrence, mondayFirst } from '../app/lib/schedule-quick';
import { saveScheduleDraft, loadScheduleDraft, SCHEDULE_DRAFT_KEY } from '../app/lib/schedule-draft';
import { isValidRule, nextOccurrences } from '../app/lib/recurrence';

const NOW = new Date('2026-10-03T10:00:00Z'); // sabato 3 ottobre, 12:00 a Roma

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'] });
  jest.setSystemTime(NOW);
  try { window.sessionStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => { jest.useRealTimers(); });

const contact = { number: '393331234567', name: 'Mario Rossi' };
const okFetch = () => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
const base = { open: true, onClose: () => {}, onBack: () => {}, contact, onScheduled: () => {} };

function openSheet() {
  fireEvent.click(screen.getByTestId('recurrence-row'));
  return screen.getByRole('dialog', { name: 'Ripetizione' });
}
const day = (sheet: HTMLElement, name: string) => within(sheet).getByRole('button', { name });
const lastBody = () => {
  const calls = (global as any).fetch.mock.calls;
  return JSON.parse(calls[calls.length - 1][1].body);
};

// ── Funzioni pure ──

describe('regola e parole dei giorni', () => {
  test('un giorno solo: la regola è identica a prima (comanda la data)', () => {
    const sat = new Date(2026, 9, 3, 12, 30);
    expect(buildRRule('weekly', sat)).toBe('FREQ=WEEKLY;BYDAY=SA');
    expect(buildRRule('weekly', sat, [])).toBe('FREQ=WEEKLY;BYDAY=SA');
    expect(buildRRule('weekly', sat, [1])).toBe('FREQ=WEEKLY;BYDAY=SA');
    expect(recurrenceLabel('weekly', sat)).toBe('Ogni sabato');
  });

  test('più giorni: BYDAY dal lunedì, valida per il server', () => {
    const sat = new Date(2026, 9, 3, 12, 30);
    const rule = buildRRule('weekly', sat, [4, 1]);
    expect(rule).toBe('FREQ=WEEKLY;BYDAY=MO,TH');
    expect(isValidRule(rule!)).toBe(true);
    expect(buildRRule('weekly', sat, [0, 6])).toBe('FREQ=WEEKLY;BYDAY=SA,SU');
    expect(recurrenceLabel('weekly', sat, [1, 4])).toBe('Ogni lunedì e giovedì');
    expect(weeklyDays(sat, [4, 1, 4])).toEqual([1, 4]);
  });

  test('weekdaysPhrase: "e" prima dell\'ultimo, "dal lunedì al venerdì", tutti = ogni giorno', () => {
    expect(weekdaysPhrase([2])).toBe('ogni martedì');
    expect(weekdaysPhrase([4, 1])).toBe('ogni lunedì e giovedì');
    expect(weekdaysPhrase([1, 3, 5])).toBe('ogni lunedì, mercoledì e venerdì');
    expect(weekdaysPhrase([1, 2, 3, 4, 5])).toBe('dal lunedì al venerdì');
    expect(weekdaysPhrase([0, 1, 2, 3, 4, 5, 6])).toBe('ogni giorno');
    expect(weekdaysPhrase([0, 6])).toBe('ogni sabato e domenica');
    expect(mondayFirst([0, 3, 3, 9, 1])).toEqual([1, 3, 0]);
  });

  test('l\'etichetta nella lista dice i giorni insieme', () => {
    expect(recurrenceTagLabel('FREQ=WEEKLY;BYDAY=MO,TH')).toBe('ogni lunedì e giovedì');
    expect(recurrenceTagLabel('FREQ=WEEKLY;BYDAY=TU')).toBe('ogni martedì');
  });

  test('firstWeeklySend: la data se è un giorno scelto, altrimenti il primo giorno scelto dopo', () => {
    const sat = new Date(2026, 9, 3, 12, 30);
    expect(firstWeeklySend(sat, [6, 1])).toBe(sat);
    const first = firstWeeklySend(sat, [1, 4]);
    expect([first.getDate(), first.getDay(), first.getHours(), first.getMinutes()]).toEqual([5, 1, 12, 30]);
  });

  test('il cron segue i giorni scelti: dopo lunedì viene giovedì, poi lunedì', () => {
    const mon = new Date('2026-10-05T16:00:00Z'); // lun 5 ott, 18:00 a Roma
    expect(nextOccurrences('FREQ=WEEKLY;BYDAY=MO,TH', mon, 3).map((d) => d.toISOString())).toEqual([
      '2026-10-08T16:00:00.000Z', '2026-10-12T16:00:00.000Z', '2026-10-15T16:00:00.000Z',
    ]);
  });
});

describe('resumeNextOccurrence ("Riprendi dalla prossima volta")', () => {
  test('serie del martedì alle 17 ferma da settimane → martedì prossimo alle 17', () => {
    const next = resumeNextOccurrence({ recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU', scheduled_at: '2026-09-15T15:00:00Z', recurrence_anchor_at: '2026-09-15T15:00:00Z' });
    expect(next?.toISOString()).toBe('2026-10-06T15:00:00.000Z');
  });

  test('riga spostata dal cron a domattina: si torna all\'ora scelta (ancora), non alle 8', () => {
    const next = resumeNextOccurrence({ recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU', scheduled_at: '2026-09-16T06:03:00Z', recurrence_anchor_at: '2026-09-08T20:00:00Z' });
    expect(next?.toISOString()).toBe('2026-10-06T20:00:00.000Z'); // mar 6 ott, 22:00 a Roma
  });

  test('più giorni: il primo dei giorni scelti dopo adesso', () => {
    const next = resumeNextOccurrence({ recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,TH', scheduled_at: '2026-09-21T16:00:00Z', recurrence_anchor_at: '2026-09-07T16:00:00Z' });
    expect(next?.toISOString()).toBe('2026-10-05T16:00:00.000Z');
  });

  test('una volta tra meno di 2 minuti si salta (il server vuole almeno un minuto)', () => {
    // Sabato alle 12:01 a Roma, adesso sono le 12:00.
    const next = resumeNextOccurrence({ recurrence_rule: 'FREQ=WEEKLY;BYDAY=SA', scheduled_at: '2026-09-26T10:01:00Z', recurrence_anchor_at: '2026-09-26T10:01:00Z' });
    expect(next?.toISOString()).toBe('2026-10-10T10:01:00.000Z');
  });

  test('niente regola o regola illeggibile → null', () => {
    expect(resumeNextOccurrence({ recurrence_rule: null, scheduled_at: '2026-09-15T15:00:00Z' })).toBeNull();
    expect(resumeNextOccurrence({ recurrence_rule: 'FREQ=YEARLY', scheduled_at: '2026-09-15T15:00:00Z' })).toBeNull();
    expect(resumeNextOccurrence({ recurrence_rule: 'FREQ=DAILY', scheduled_at: 'boh' })).toBeNull();
  });
});

// ── Finestra del messaggio ──

describe('la riga Ripeti è a vista sotto data e ora', () => {
  test('sotto l\'orario e sopra il campo, con "Non si ripete"; niente "Opzioni avanzate"', () => {
    render(<ScheduleModal {...base} />);
    const row = screen.getByTestId('recurrence-row');
    expect(row).toHaveTextContent('Ripeti');
    expect(row).toHaveTextContent('Non si ripete');
    const time = screen.getByRole('button', { name: 'Modifica orario' });
    const field = screen.getByPlaceholderText(/Scrivi il messaggio/);
    expect(time.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/Opzioni avanzate/)).not.toBeInTheDocument();
  });

  test('"Usa un modello" sopra il campo apre i modelli', () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ templates: [] }) });
    render(<ScheduleModal {...base} />);
    const link = screen.getByRole('button', { name: 'Usa un modello' });
    expect(link.compareDocumentPosition(screen.getByPlaceholderText(/Scrivi il messaggio/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(link);
    expect(screen.getByRole('dialog', { name: 'Scegli un modello' })).toBeInTheDocument();
  });
});

describe('più giorni della settimana insieme', () => {
  test('lunedì e giovedì: la data va al primo lunedì, la regola dice MO,TH', async () => {
    (global as any).fetch = okFetch();
    render(<ScheduleModal {...base} />);
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Ogni sabato' }));
    expect(within(sheet).getByTestId('weekday-picker')).toHaveTextContent('LMMGVSD');
    fireEvent.click(day(sheet, 'lunedì'));
    fireEvent.click(day(sheet, 'giovedì'));
    fireEvent.click(day(sheet, 'sabato'));
    expect(day(sheet, 'lunedì')).toHaveAttribute('aria-pressed', 'true');
    expect(day(sheet, 'sabato')).toHaveAttribute('aria-pressed', 'false');
    expect(within(sheet).getByRole('radio', { name: 'Ogni lunedì e giovedì' })).toBeInTheDocument();
    expect(within(sheet).getAllByRole('listitem')[0]).toHaveTextContent(/Primo invio: lun 5 ottobre/);
    expect(within(sheet).getAllByRole('listitem')[1]).toHaveTextContent(/gio 8 ottobre/);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Conferma ogni lunedì e giovedì' }));

    expect(screen.getByTestId('recurrence-row')).toHaveTextContent('Ogni lunedì e giovedì');
    expect(screen.getByRole('button', { name: 'Modifica data' })).toHaveTextContent('lun 5 ott');
    expect(screen.queryByTestId('recurrence-first-send')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/), { target: { value: 'Allenamento alle 18' } });
    fireEvent.click(screen.getByRole('button', { name: /Invia/ }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    const body = lastBody();
    expect(body.recurrence_rule).toBe('FREQ=WEEKLY;BYDAY=MO,TH');
    expect(body.scheduled_at).toBe('2026-10-05T10:30:00.000Z'); // lun 5 ott, 12:30 a Roma
  });

  test('un giorno solo diverso da quello della data: la data si sposta lì', async () => {
    (global as any).fetch = okFetch();
    render(<ScheduleModal {...base} initialMessage="Catechismo" />);
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Ogni sabato' }));
    fireEvent.click(day(sheet, 'martedì'));
    fireEvent.click(day(sheet, 'sabato'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Conferma ogni martedì' }));
    expect(screen.getByTestId('recurrence-row')).toHaveTextContent('Ogni martedì');
    fireEvent.click(screen.getByRole('button', { name: /Invia/ }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    expect(lastBody().recurrence_rule).toBe('FREQ=WEEKLY;BYDAY=TU');
    expect(lastBody().scheduled_at).toBe('2026-10-06T10:30:00.000Z');
  });

  test('il giorno della data, come prima: regola e data invariate', async () => {
    (global as any).fetch = okFetch();
    render(<ScheduleModal {...base} initialMessage="Ciao" />);
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Ogni sabato' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Conferma ogni sabato' }));
    fireEvent.click(screen.getByRole('button', { name: /Invia/ }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    expect(lastBody().recurrence_rule).toBe('FREQ=WEEKLY;BYDAY=SA');
    expect(lastBody().scheduled_at).toBe('2026-10-03T10:30:00.000Z');
  });

  test('l\'ultimo giorno scelto non si toglie', () => {
    render(<ScheduleModal {...base} />);
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Ogni sabato' }));
    fireEvent.click(day(sheet, 'sabato'));
    expect(day(sheet, 'sabato')).toHaveAttribute('aria-pressed', 'true');
  });

  test('dal lunedì al venerdì', async () => {
    (global as any).fetch = okFetch();
    render(<ScheduleModal {...base} initialMessage="Buongiorno" />);
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Ogni sabato' }));
    for (const n of ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']) fireEvent.click(day(sheet, n));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Conferma dal lunedì al venerdì' }));
    expect(screen.getByTestId('recurrence-row')).toHaveTextContent('Dal lunedì al venerdì');
    fireEvent.click(screen.getByRole('button', { name: /Invia/ }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    expect(lastBody().recurrence_rule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  });

  test('tutti e sette i giorni = ogni giorno', async () => {
    (global as any).fetch = okFetch();
    render(<ScheduleModal {...base} initialMessage="Ciao" />);
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Ogni sabato' }));
    for (const n of ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'domenica']) fireEvent.click(day(sheet, n));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Conferma ogni giorno' }));
    expect(screen.getByTestId('recurrence-row')).toHaveTextContent('Ogni giorno');
    fireEvent.click(screen.getByRole('button', { name: /Invia/ }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    expect(lastBody().recurrence_rule).toBe('FREQ=DAILY');
  });

  test('data cambiata dopo in un giorno non scelto: lo si dice, i giorni restano', async () => {
    (global as any).fetch = okFetch();
    render(<ScheduleModal {...base} initialMessage="Allenamento" />);
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Ogni sabato' }));
    fireEvent.click(day(sheet, 'lunedì'));
    fireEvent.click(day(sheet, 'giovedì'));
    fireEvent.click(day(sheet, 'sabato'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Conferma ogni lunedì e giovedì' }));
    fireEvent.click(screen.getByRole('button', { name: 'Domani' }));
    expect(screen.getByTestId('recurrence-first-send')).toHaveTextContent('Primo invio dom 4 ott, poi ogni lunedì e giovedì');
    fireEvent.click(screen.getByRole('button', { name: /Invia/ }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    expect(lastBody().recurrence_rule).toBe('FREQ=WEEKLY;BYDAY=MO,TH');
    expect(lastBody().scheduled_at).toBe('2026-10-04T10:30:00.000Z');
  });
});

describe('modifica di una serie con più giorni', () => {
  const MON_18 = '2026-10-05T16:00:00.000Z'; // lun 5 ott, 18:00 a Roma

  test('la riga dice i giorni; correggere il testo non tocca regola né orario', async () => {
    (global as any).fetch = okFetch();
    render(<ScheduleModal {...base} initialMessage="Allenamento" editMsgId="msg-1" initialScheduledAt={MON_18} initialRecurrenceRule="FREQ=WEEKLY;BYDAY=MO,TH" />);
    expect(screen.getByTestId('recurrence-row')).toHaveTextContent('Ogni lunedì e giovedì');
    expect(screen.getByTestId('series-edit-note')).toHaveTextContent('(ogni lunedì e giovedì)');
    fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/), { target: { value: 'Allenamento al campo 2' } });
    fireEvent.click(screen.getByRole('button', { name: /Invia/ }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    const body = lastBody();
    expect(body).not.toHaveProperty('recurrence_rule');
    expect(body).not.toHaveProperty('scheduled_at');
  });

  test('spostata a domenica solo questa volta: "Questa volta dom 4 ott, poi …", la regola resta', async () => {
    (global as any).fetch = okFetch();
    render(<ScheduleModal {...base} initialMessage="Allenamento" editMsgId="msg-1" initialScheduledAt={MON_18} initialRecurrenceRule="FREQ=WEEKLY;BYDAY=MO,TH" />);
    fireEvent.click(screen.getByRole('button', { name: 'Domani' }));
    expect(screen.getByTestId('recurrence-first-send')).toHaveTextContent('Questa volta dom 4 ott, poi ogni lunedì e giovedì');
    fireEvent.click(screen.getByRole('button', { name: /Invia/ }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    const body = lastBody();
    expect(body).not.toHaveProperty('recurrence_rule');
    expect(body.scheduled_at).toBe('2026-10-04T16:00:00.000Z');
  });

  test('"ogni venerdì" spostato dal cron a sabato mattina: la riga dice la serie, non "Non si ripete"', async () => {
    (global as any).fetch = okFetch();
    // sab 10 ott, 08:03 a Roma (il venerdì sera era fuori dalla fascia 8-21).
    render(<ScheduleModal {...base} initialMessage="Convocazione" editMsgId="msg-1" initialScheduledAt="2026-10-10T06:03:00.000Z" initialRecurrenceRule="FREQ=WEEKLY;BYDAY=FR" />);
    expect(screen.getByTestId('recurrence-row')).toHaveTextContent('Ogni venerdì');
    expect(screen.getByTestId('recurrence-row')).not.toHaveTextContent('Non si ripete');
    expect(screen.getByTestId('recurrence-first-send')).toHaveTextContent('Questa volta sab 10 ott, poi ogni venerdì');
    fireEvent.click(screen.getByRole('button', { name: /Invia/ }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    expect(lastBody()).not.toHaveProperty('recurrence_rule');
  });

  test('il foglio si apre con i giorni della serie già scelti', () => {
    render(<ScheduleModal {...base} initialMessage="Allenamento" editMsgId="msg-1" initialScheduledAt={MON_18} initialRecurrenceRule="FREQ=WEEKLY;BYDAY=MO,TH" />);
    const sheet = openSheet();
    expect(within(sheet).getByRole('radio', { name: 'Ogni lunedì e giovedì' })).toHaveAttribute('aria-checked', 'true');
    expect(day(sheet, 'lunedì')).toHaveAttribute('aria-pressed', 'true');
    expect(day(sheet, 'giovedì')).toHaveAttribute('aria-pressed', 'true');
    expect(day(sheet, 'martedì')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('confermare il foglio Ripeti senza cambiare nulla non sposta niente (revisione B2)', () => {
  const RULE = 'FREQ=WEEKLY;BYDAY=MO,TH';
  // La volta di lunedì 18:00 spostata dal cron (limite dei primi giorni) a mar 6 ott 08:03.
  const TUE_0803 = '2026-10-06T06:03:00.000Z';

  test('volta spostata dal cron: "Conferma ogni lunedì e giovedì" non porta la data a giovedì né riscrive la serie', async () => {
    (global as any).fetch = okFetch();
    render(<ScheduleModal {...base} initialMessage="Allenamento" editMsgId="msg-1" initialScheduledAt={TUE_0803} initialRecurrenceRule={RULE} />);
    expect(screen.getByTestId('recurrence-first-send')).toHaveTextContent('Questa volta mar 6 ott, poi ogni lunedì e giovedì');
    const sheet = openSheet();
    // Il foglio dice la stessa cosa della riga: questa volta martedì, poi i giorni della serie.
    const items = within(sheet).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/Questa volta: mar 6 ottobre/);
    expect(items[1]).toHaveTextContent(/gio 8 ottobre/);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Conferma ogni lunedì e giovedì' }));
    expect(screen.getByRole('button', { name: 'Modifica data' })).toHaveTextContent('mar 6 ott');
    expect(screen.getByTestId('recurrence-first-send')).toHaveTextContent('Questa volta mar 6 ott, poi ogni lunedì e giovedì');
    fireEvent.click(screen.getByRole('button', { name: /Invia/ }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    const body = lastBody();
    // Niente scheduled_at né regola: l'ancora delle 18:00 resta, la volta resta martedì 08:03.
    expect(body).not.toHaveProperty('scheduled_at');
    expect(body).not.toHaveProperty('recurrence_rule');
  });

  test('data scelta a mano su un altro giorno ("Questa volta dom 4 ott"): la conferma non la annulla', async () => {
    (global as any).fetch = okFetch();
    render(<ScheduleModal {...base} initialMessage="Allenamento" editMsgId="msg-1" initialScheduledAt="2026-10-05T16:00:00.000Z" initialRecurrenceRule={RULE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Domani' }));
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Conferma ogni lunedì e giovedì' }));
    expect(screen.getByRole('button', { name: 'Modifica data' })).toHaveTextContent('dom 4 ott');
    fireEvent.click(screen.getByRole('button', { name: /Invia/ }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    const body = lastBody();
    expect(body.scheduled_at).toBe('2026-10-04T16:00:00.000Z');
    expect(body).not.toHaveProperty('recurrence_rule');
  });

  test('messaggio nuovo: stessi giorni confermati di nuovo → la data scelta dopo resta', async () => {
    (global as any).fetch = okFetch();
    render(<ScheduleModal {...base} initialMessage="Allenamento" />);
    let sheet = openSheet();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Ogni sabato' }));
    fireEvent.click(day(sheet, 'lunedì'));
    fireEvent.click(day(sheet, 'giovedì'));
    fireEvent.click(day(sheet, 'sabato'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Conferma ogni lunedì e giovedì' }));
    fireEvent.click(screen.getByRole('button', { name: 'Domani' }));
    sheet = openSheet();
    expect(within(sheet).getAllByRole('listitem')[0]).toHaveTextContent(/Primo invio: dom 4 ottobre/);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Conferma ogni lunedì e giovedì' }));
    expect(screen.getByRole('button', { name: 'Modifica data' })).toHaveTextContent('dom 4 ott');
    fireEvent.click(screen.getByRole('button', { name: /Invia/ }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    expect(lastBody().scheduled_at).toBe('2026-10-04T10:30:00.000Z');
    expect(lastBody().recurrence_rule).toBe(RULE);
  });

  test('giorni cambiati davvero: la data va al primo giorno scelto e la regola si manda', async () => {
    (global as any).fetch = okFetch();
    render(<ScheduleModal {...base} initialMessage="Allenamento" editMsgId="msg-1" initialScheduledAt={TUE_0803} initialRecurrenceRule={RULE} />);
    const sheet = openSheet();
    fireEvent.click(day(sheet, 'mercoledì'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Conferma ogni lunedì, mercoledì e giovedì' }));
    expect(screen.getByRole('button', { name: 'Modifica data' })).toHaveTextContent('mer 7 ott');
    fireEvent.click(screen.getByRole('button', { name: /Invia/ }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    expect(lastBody().recurrence_rule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,TH');
    expect(lastBody().scheduled_at).toBe('2026-10-07T06:03:00.000Z');
  });

  test('un giorno solo cambiato (sabato → martedì) non è "la stessa scelta" anche se la data è la stessa', async () => {
    (global as any).fetch = okFetch();
    render(<ScheduleModal {...base} initialMessage="Catechismo" />);
    let sheet = openSheet();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Ogni sabato' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Conferma ogni sabato' }));
    sheet = openSheet();
    fireEvent.click(day(sheet, 'martedì'));
    fireEvent.click(day(sheet, 'sabato'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Conferma ogni martedì' }));
    expect(screen.getByTestId('recurrence-row')).toHaveTextContent('Ogni martedì');
    fireEvent.click(screen.getByRole('button', { name: /Invia/ }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    expect(lastBody().recurrence_rule).toBe('FREQ=WEEKLY;BYDAY=TU');
    expect(lastBody().scheduled_at).toBe('2026-10-06T10:30:00.000Z');
  });
});

describe('misure su iPhone (revisione B2)', () => {
  test('riga Ripeti su due righe: la scritta "Ripeti" e il valore nella stessa colonna, il valore va a capo', () => {
    render(<ScheduleModal {...base} initialMessage="Allenamento" editMsgId="msg-1" initialScheduledAt="2026-10-07T06:03:00.000Z" initialRecurrenceRule="FREQ=WEEKLY;BYDAY=MO,TU,TH,FR" />);
    const row = screen.getByTestId('recurrence-row');
    const value = within(row).getByTestId('recurrence-value');
    expect(value).toHaveTextContent('Ogni lunedì, martedì, giovedì e venerdì');
    const column = value.parentElement!;
    expect(column).toHaveClass('flex-1', 'min-w-0');
    expect(column.firstElementChild).toHaveTextContent(/^Ripeti$/);
    // La nota sta nella stessa colonna, sotto il valore, a tutta larghezza.
    expect(column.contains(within(row).getByTestId('recurrence-first-send'))).toBe(true);
    // Nessun elemento accanto alla colonna che possa schiacciarla (solo icona e freccia, che non si stringono).
    for (const el of Array.from(row.children)) {
      if (el !== column) expect(el.getAttribute('class') || '').toMatch(/shrink-0/);
    }
  });

  test('giorni L M M G V S D: sette colonne uguali, alti 44px, senza rientro', () => {
    render(<ScheduleModal {...base} />);
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Ogni sabato' }));
    const picker = within(sheet).getByTestId('weekday-picker');
    expect(picker.className).not.toMatch(/pl-12/);
    const grid = within(picker).getByRole('group', { name: 'Giorni della settimana' });
    expect(grid).toHaveClass('grid', 'grid-cols-7');
    for (const b of within(grid).getAllByRole('button')) {
      expect(b).toHaveClass('h-11', 'w-full', 'min-w-0');
      expect(b.className).not.toMatch(/\bw-9\b|\bh-9\b/);
    }
  });

  test('chip della data (Oggi, Domani, …, Altra data): area di tocco alta 44px', () => {
    render(<ScheduleModal {...base} />);
    const chips = screen.getByTestId('quick-date-chips');
    const buttons = within(chips).getAllByRole('button');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(expect.arrayContaining(['Oggi', 'Domani', 'Altra data']));
    for (const b of buttons) expect(b.className).toMatch(/min-h-\[44px\]/);
  });
});

describe('bozza', () => {
  test('i giorni scelti finiscono nella bozza e tornano con "Riprendi bozza"', () => {
    render(<ScheduleModal {...base} />);
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Ogni sabato' }));
    fireEvent.click(day(sheet, 'lunedì'));
    fireEvent.click(day(sheet, 'giovedì'));
    fireEvent.click(day(sheet, 'sabato'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Conferma ogni lunedì e giovedì' }));
    fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/), { target: { value: 'Allenamento' } });
    const saved = JSON.parse(window.sessionStorage.getItem(SCHEDULE_DRAFT_KEY) || '{}');
    expect(saved.recurrence).toBe('weekly');
    expect(saved.weekDays).toEqual([1, 4]);
  });

  test('load: giorni validi tenuti, il resto scartato; bozza vecchia senza giorni → []', () => {
    saveScheduleDraft({ contactNumber: '39333', message: 'x', scheduledAt: '', recurrence: 'weekly', weekDays: [1, 4, 9, 4] as number[], media: null });
    expect(loadScheduleDraft('39333')?.weekDays).toEqual([1, 4]);
    window.sessionStorage.setItem(SCHEDULE_DRAFT_KEY, JSON.stringify({ v: 1, contactNumber: '39333', message: 'x', scheduledAt: '', recurrence: 'weekly', media: null, savedAt: Date.now() }));
    expect(loadScheduleDraft('39333')?.weekDays).toEqual([]);
  });
});

// ── Dashboard: serie in pausa con l'orario passato ──

const resp = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function mockDashboard(messages: unknown[]) {
  const fn = jest.fn(async (url: string, init?: any): Promise<any> => {
    const method = init?.method || 'GET';
    if (url === '/api/auth/me') return resp({ phone: '393331112222', instanceName: 'X' });
    if (url === '/api/messages' && method === 'GET') {
      return resp({ messages, subscription_plan: 'beta', raw_plan: 'free', billing_enabled: false, connection_status: 'open', total_scheduled_lifetime: 5 });
    }
    if (url === '/api/messages' && method === 'PATCH') return resp({ message: { id: 's1' } });
    return resp({});
  });
  (global as any).fetch = fn;
  return fn;
}
const patches = (fn: jest.Mock) => fn.mock.calls.filter((c: any[]) => c[1]?.method === 'PATCH').map((c: any[]) => JSON.parse(c[1].body));

async function openResume() {
  await act(async () => { render(<DashboardPage />); });
  fireEvent.click((await screen.findAllByRole('button', { name: 'Azioni messaggio' }))[0]);
  await act(async () => { fireEvent.click(screen.getByText('Riprendi invio')); });
  return screen.findByTestId('time-passed-dialog');
}

describe('serie in pausa con l\'orario passato: "Riprendi dalla prossima volta"', () => {
  const series = {
    id: 's1', recipient_name: 'Genitori', recipient_number: '393334445566', parsed_message: 'Catechismo alle 17',
    scheduled_at: '2026-09-15T15:00:00.000Z', recurrence_anchor_at: '2026-09-15T15:00:00.000Z',
    status: 'paused', recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU',
  };

  test('la prima scelta riparte martedì prossimo alle 17, senza mandare il vecchio avviso', async () => {
    const fetchFn = mockDashboard([series]);
    const dialog = await openResume();
    expect(dialog).toHaveTextContent('È un messaggio che si ripete (ogni martedì)');
    const btn = within(dialog).getByRole('button', { name: /^Riprendi dalla prossima volta \(mar 6 ott 17:00\)$/ });
    expect(within(dialog).getByRole('button', { name: 'Invia ora' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Lascia in pausa' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(btn); });
    expect(patches(fetchFn)).toEqual([{ id: 's1', status: 'pending', scheduled_at: '2026-10-06T15:00:00.000Z', keep_recurrence_anchor: true }]);
    await waitFor(() => expect(screen.getByText('Ripreso — la prossima volta parte mar 6 ott 17:00')).toBeInTheDocument());
  });

  test('un messaggio singolo non ha questa scelta', async () => {
    mockDashboard([{ ...series, recurrence_rule: null, recurrence_anchor_at: null }]);
    const dialog = await openResume();
    expect(within(dialog).queryByRole('button', { name: /Riprendi dalla prossima volta/ })).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent('parte subito, con il testo di allora');
  });
});
