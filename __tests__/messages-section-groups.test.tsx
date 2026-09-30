/**
 * @jest-environment jsdom
 *
 * Lista messaggi con righe di gruppo (chip "Gruppo", avatar di gruppo, mai le
 * cifre del JID) e porta finta "foto del calendario" (D14): visibile solo in
 * "Prossimi" senza ricerca, una risposta sola, la X non registra niente.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import MessagesSection, { type ScheduledMessage } from '../app/components/MessagesSection';
import FakeDoorCard from '../app/components/FakeDoorCard';

const JID = '120363000000000001@g.us';
const OLD_JID = '393331234567-1600000000@g.us';
const HIDDEN_KEY = 'wl_fakedoor_calendar_hidden';

function msg(over: Partial<ScheduledMessage>): ScheduledMessage {
  return {
    id: 'g1', recipient_name: 'Under 12 – Genitori', recipient_number: JID, parsed_message: 'Allenamento alle 17',
    scheduled_at: new Date(Date.now() + 3 * 3600 * 1000).toISOString(), status: 'pending', ...over,
  };
}

function setup(messages: ScheduledMessage[], extra: Record<string, unknown> = {}) {
  const props = {
    onDelete: jest.fn(), onDuplicate: jest.fn(), onEdit: jest.fn(), onPauseToggle: jest.fn(),
    onRetry: jest.fn(), onSnooze: jest.fn(), onShowToast: jest.fn(), onChooseOtherContact: jest.fn(),
    onFakeDoorAnswered: jest.fn(),
    connected: true,
    ...extra,
  };
  render(<MessagesSection {...(props as any)} messages={messages} />);
  return props;
}

const html = () => document.body.innerHTML;
const openSheet = () => fireEvent.click(screen.getAllByRole('button', { name: 'Azioni messaggio' })[0]);
const search = (q: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Cerca' }));
  fireEvent.change(screen.getByPlaceholderText('Cerca per nome, numero o testo…'), { target: { value: q } });
};
const resp = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  try { window.localStorage.clear(); } catch { /* jsdom */ }
});

describe('riga di un gruppo', () => {
  test('chip "Gruppo" e avatar di gruppo, mai le cifre del JID', () => {
    setup([msg({})]);
    expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument();
    expect(screen.getByTestId('group-tag')).toHaveTextContent('Gruppo');
    expect(document.querySelector('[data-variant="group"]')).toBeInTheDocument();
    expect(html()).not.toContain('@g.us');
    expect(html()).not.toContain('120363');
    expect(html()).not.toContain('+1203');
  });

  test('senza nome → "Gruppo senza nome"; nel formato vecchio nemmeno il telefono di chi l\'ha creato', () => {
    setup([
      msg({ id: 'a', recipient_name: undefined }),
      msg({ id: 'b', recipient_name: '', recipient_number: OLD_JID }),
    ]);
    expect(screen.getAllByText('Gruppo senza nome')).toHaveLength(2);
    expect(screen.getAllByTestId('group-tag')).toHaveLength(2);
    expect(html()).not.toContain('@g.us');
    expect(html()).not.toContain('393331234567');
    expect(html()).not.toContain('+1203');
  });

  test('una persona non ha il chip "Gruppo" né l\'avatar di gruppo (regressione)', () => {
    setup([msg({ recipient_name: 'Mario', recipient_number: '393331234567' })]);
    expect(screen.queryByTestId('group-tag')).not.toBeInTheDocument();
    expect(document.querySelector('[data-variant="group"]')).not.toBeInTheDocument();
  });

  test('inviato con read_at: solo ✓ col testo del gruppo, mai "Letto"', () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    setup([msg({ status: 'sent', scheduled_at: past, sent_at: past, read_at: past, evolution_message_id: 'X1' })]);
    fireEvent.click(screen.getByText('Inviati'));
    expect(screen.getByLabelText('Inviato')).toHaveAttribute('title', 'Inviato nel gruppo (per i gruppi WhatsApp non ci manda le spunte di consegna)');
    expect(screen.queryByLabelText('Letto')).not.toBeInTheDocument();
  });

  test('"Da verificare" su un gruppo: il title dice di guardare nel gruppo', () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    setup([msg({ status: 'sent', scheduled_at: past, error_message: 'send_indeterminate: risposta incerta da Evolution durante l\'invio nel gruppo, marcato inviato per evitare doppioni (controlla nel gruppo)' })]);
    fireEvent.click(screen.getByText('Inviati'));
    expect(screen.getByTestId('status-unverified')).toHaveAttribute('title', 'WhatsApp non ci ha confermato l\'invio: guarda nel gruppo se è arrivato prima di rimandarlo.');
  });

  test('titolo del foglio azioni = nome del gruppo, o "Gruppo senza nome"', () => {
    setup([msg({ recipient_name: undefined })]);
    openSheet();
    expect(screen.getAllByText('Gruppo senza nome').length).toBeGreaterThanOrEqual(2);
    expect(html()).not.toContain('120363');
  });

  test('titolo del foglio azioni per una persona senza nome: il numero come prima, senza "+" (regressione)', () => {
    setup([msg({ recipient_name: undefined, recipient_number: '393331234567' })]);
    openSheet();
    // La riga mostra "+39…" (come prima); il titolo del foglio le sole cifre (come prima).
    expect(screen.getByText('393331234567')).toBeInTheDocument();
  });
});

describe('card rossa di un gruppo', () => {
  const unreachable = 'HTTP 400: {"status":400,"error":"Bad Request","response":{"message":["[object Object]"]}}';

  test('testo di gruppo, chip "Gruppo", nessun suggerimento "numero non su WhatsApp"', () => {
    setup([msg({ status: 'failed', error_message: unreachable })]);
    expect(screen.getByText('Gruppo non raggiungibile — controlla di farne ancora parte')).toBeInTheDocument();
    expect(screen.getByTestId('group-tag')).toBeInTheDocument();
    expect(screen.queryByTestId('invalid-number-hint')).not.toBeInTheDocument();
    expect(html()).not.toContain('120363');
  });

  test('"exists": false su un gruppo non diventa "numero sconosciuto" (niente LID, niente "Scegli un altro contatto")', () => {
    setup([msg({ status: 'failed', recipient_number: OLD_JID, error_message: 'HTTP 400: {"response":{"message":[{"exists":false,"jid":"x"}]}}' })]);
    expect(screen.queryByTestId('invalid-number-hint')).not.toBeInTheDocument();
    expect(screen.queryByText('Scegli un altro contatto')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument();
  });

  test('lo stesso errore su una persona resta quello di oggi (regressione)', () => {
    setup([msg({ status: 'failed', recipient_name: 'Mario', recipient_number: '393331234567', error_message: unreachable })]);
    expect(screen.queryByText('Gruppo non raggiungibile — controlla di farne ancora parte')).not.toBeInTheDocument();
    expect(screen.queryByTestId('group-tag')).not.toBeInTheDocument();
  });
});

describe('ricerca', () => {
  test('"1203" non trova il gruppo, "gruppo" sì', () => {
    setup([msg({}), msg({ id: 'p1', recipient_name: 'Mario', recipient_number: '393331234567', parsed_message: 'Ciao' })]);
    search('1203');
    expect(screen.queryByText('Under 12 – Genitori')).not.toBeInTheDocument();
    expect(screen.getByText(/Nessun risultato per "1203"/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Cerca per nome, numero o testo…'), { target: { value: 'gruppo' } });
    expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument();
    expect(screen.queryByText('Mario')).not.toBeInTheDocument();
  });
});

describe('porta finta nella lista', () => {
  const on = { active: true, answered: false };

  test('visibile in "Prossimi", senza ricerca, se attiva e senza risposta', () => {
    setup([msg({})], { fakeDoor: on });
    expect(screen.getByTestId('fake-door-calendar')).toHaveTextContent('Carica la foto del calendario della stagione');
    expect(screen.getByText('Quante date ha il tuo calendario?')).toBeInTheDocument();
  });

  test('nascosta in "Inviati"', () => {
    setup([msg({})], { fakeDoor: on });
    fireEvent.click(screen.getByText('Inviati'));
    expect(screen.queryByTestId('fake-door-calendar')).not.toBeInTheDocument();
  });

  test('nascosta durante una ricerca', () => {
    setup([msg({})], { fakeDoor: on });
    search('under');
    expect(screen.queryByTestId('fake-door-calendar')).not.toBeInTheDocument();
  });

  test.each([
    ['spenta', { active: false, answered: false }],
    ['già risposta', { active: true, answered: true }],
    ['senza dati', undefined],
  ])('nascosta se %s', (_label, fakeDoor) => {
    setup([msg({})], { fakeDoor });
    expect(screen.queryByTestId('fake-door-calendar')).not.toBeInTheDocument();
  });
});

describe('FakeDoorCard', () => {
  const chip = (label: string) => screen.getByRole('button', { name: label });
  const chips = () => ['Meno di 10', '10-30', 'Più di 30', 'Non mi serve'].map(chip);

  test('tocco → POST col body giusto, chip spenti durante l\'invio, grazie e poi onAnswered', async () => {
    jest.useFakeTimers();
    let finish: (v: unknown) => void = () => {};
    const fetchFn = jest.fn(() => new Promise((r) => { finish = r; }));
    (global as any).fetch = fetchFn;
    const onAnswered = jest.fn();
    render(<FakeDoorCard onAnswered={onAnswered} />);

    fireEvent.click(chip('Meno di 10'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as any[];
    expect(url).toBe('/api/feedback');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ feature: 'calendar_photo', answer: 'lt10' });
    chips().forEach((b) => expect(b).toBeDisabled());
    fireEvent.click(chip('10-30'));
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await act(async () => { finish(resp({ ok: true })); });
    expect(screen.getByText('Grazie! Ci aiuta a decidere.')).toBeInTheDocument();
    expect(onAnswered).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(2500); });
    expect(onAnswered).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('fake-door-calendar')).not.toBeInTheDocument();
  });

  test('"Non mi serve" → answer "no"; una risposta già data (already) ringrazia lo stesso', async () => {
    const fetchFn = jest.fn().mockResolvedValue(resp({ ok: true, already: true }));
    (global as any).fetch = fetchFn;
    render(<FakeDoorCard onAnswered={() => {}} />);
    await act(async () => { fireEvent.click(chip('Non mi serve')); });
    expect(JSON.parse((fetchFn.mock.calls[0] as any[])[1].body)).toEqual({ feature: 'calendar_photo', answer: 'no' });
    expect(screen.getByText('Grazie! Ci aiuta a decidere.')).toBeInTheDocument();
  });

  test('X → scheda nascosta, nessuna fetch, chiave in localStorage', () => {
    const fetchFn = jest.fn();
    (global as any).fetch = fetchFn;
    const onAnswered = jest.fn();
    render(<FakeDoorCard onAnswered={onAnswered} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(screen.queryByTestId('fake-door-calendar')).not.toBeInTheDocument();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(onAnswered).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(HIDDEN_KEY)).toBe('1');
  });

  test('chiave già presente: la scheda non si mostra', () => {
    window.localStorage.setItem(HIDDEN_KEY, '1');
    render(<FakeDoorCard onAnswered={() => {}} />);
    expect(screen.queryByTestId('fake-door-calendar')).not.toBeInTheDocument();
  });

  test('localStorage che lancia (modalità privata): la scheda si mostra e la X la chiude senza errori', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError'); });
    const fetchFn = jest.fn();
    (global as any).fetch = fetchFn;
    render(<FakeDoorCard onAnswered={() => {}} />);
    expect(screen.getByTestId('fake-door-calendar')).toBeInTheDocument();
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }))).not.toThrow();
    expect(screen.queryByTestId('fake-door-calendar')).not.toBeInTheDocument();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('409 (domanda chiusa) → scheda nascosta in silenzio, niente onAnswered', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(resp({ error: 'fake_door_closed' }, 409));
    const onAnswered = jest.fn();
    render(<FakeDoorCard onAnswered={onAnswered} />);
    await act(async () => { fireEvent.click(chip('Più di 30')); });
    expect(screen.queryByTestId('fake-door-calendar')).not.toBeInTheDocument();
    expect(screen.queryByText('Non è arrivata: riprova.')).not.toBeInTheDocument();
    expect(onAnswered).not.toHaveBeenCalled();
  });

  test('risposta e cambio scheda prima dei 2,5 s: al ritorno su "Prossimi" la scheda non c\'è, onAnswered una volta', async () => {
    jest.useFakeTimers();
    (global as any).fetch = jest.fn().mockResolvedValue(resp({ ok: true }));
    const answered = jest.fn();
    // Stato tenuto come nella dashboard.
    function Wrapper() {
      const [fd, setFd] = React.useState({ active: true, answered: false });
      return (
        <MessagesSection
          {...({
            onDelete: jest.fn(), onDuplicate: jest.fn(), onEdit: jest.fn(), onPauseToggle: jest.fn(),
            onRetry: jest.fn(), onSnooze: jest.fn(), onShowToast: jest.fn(), onChooseOtherContact: jest.fn(),
            connected: true,
          } as any)}
          messages={[msg({})]}
          fakeDoor={fd}
          onFakeDoorAnswered={() => { answered(); setFd((f) => ({ ...f, answered: true })); }}
        />
      );
    }
    render(<Wrapper />);
    await act(async () => { fireEvent.click(chip('Meno di 10')); });
    expect(screen.getByText('Grazie! Ci aiuta a decidere.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Inviati'));
    fireEvent.click(screen.getByText('Prossimi'));
    expect(screen.queryByTestId('fake-door-calendar')).not.toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(5000); });
    expect(answered).toHaveBeenCalledTimes(1);
  });

  test('X durante l\'invio: la scheda resta chiusa quando arriva la risposta; se salvata, onAnswered', async () => {
    let finish: (v: unknown) => void = () => {};
    (global as any).fetch = jest.fn(() => new Promise((r) => { finish = r; }));
    const onAnswered = jest.fn();
    render(<FakeDoorCard onAnswered={onAnswered} />);
    fireEvent.click(chip('Più di 30'));
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(screen.queryByTestId('fake-door-calendar')).not.toBeInTheDocument();
    await act(async () => { finish(resp({ ok: true })); });
    expect(screen.queryByTestId('fake-door-calendar')).not.toBeInTheDocument();
    expect(screen.queryByText('Grazie! Ci aiuta a decidere.')).not.toBeInTheDocument();
    expect(onAnswered).toHaveBeenCalledTimes(1);
  });

  test('X durante l\'invio e POST fallita: nessun errore a schermo, la scheda resta chiusa', async () => {
    let finish: (v: unknown) => void = () => {};
    (global as any).fetch = jest.fn(() => new Promise((r) => { finish = r; }));
    const onAnswered = jest.fn();
    render(<FakeDoorCard onAnswered={onAnswered} />);
    fireEvent.click(chip('10-30'));
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    await act(async () => { finish(resp({ error: 'save_failed' }, 500)); });
    expect(screen.queryByTestId('fake-door-calendar')).not.toBeInTheDocument();
    expect(screen.queryByText('Non è arrivata: riprova.')).not.toBeInTheDocument();
    expect(onAnswered).not.toHaveBeenCalled();
  });

  test.each([
    ['500', () => jest.fn().mockResolvedValue(resp({ error: 'save_failed' }, 500))],
    ['rete giù', () => jest.fn().mockRejectedValue(new Error('network'))],
  ])('errore (%s) → testo d\'errore e chip di nuovo attivi', async (_label, make) => {
    (global as any).fetch = make();
    render(<FakeDoorCard onAnswered={() => {}} />);
    await act(async () => { fireEvent.click(chip('10-30')); });
    await waitFor(() => expect(screen.getByText('Non è arrivata: riprova.')).toBeInTheDocument());
    chips().forEach((b) => expect(b).not.toBeDisabled());
    expect(screen.getByTestId('fake-door-calendar')).toBeInTheDocument();
  });
});
