/**
 * @jest-environment jsdom
 *
 * Istruttore su Android, PWA installata: sceglie il contatto, scrive un
 * promemoria lungo, allega un PDF, poi preme "Indietro" di riflesso.
 * Prima: nessuna voce di cronologia → Indietro chiudeva l'app, e la modale
 * teneva tutto solo in memoria → testo, data e allegato persi.
 * Ora: Indietro chiude la modale (l'app resta), e la bozza torna con
 * "Riprendi bozza" alla prossima apertura per lo stesso contatto.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ScheduleModal from '../components/ScheduleModal';
import ContactPickerModal from '../components/ContactPickerModal';
import { __resetModalHistoryForTests } from '../app/lib/use-modal-history';
import {
  SCHEDULE_DRAFT_KEY, SCHEDULE_DRAFT_TTL_MS, saveScheduleDraft, loadScheduleDraft, draftDateTime,
} from '../app/lib/schedule-draft';

const mario = { number: '393331234567', name: 'Mario Rossi' };
const luigi = { number: '393339876543', name: 'Luigi Bianchi' };

async function pressBack() {
  await act(async () => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 20));
  });
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

function Modal(props: Partial<React.ComponentProps<typeof ScheduleModal>>) {
  return (
    <ScheduleModal open={true} onClose={() => {}} onBack={() => {}} contact={mario} onScheduled={() => {}} {...props} />
  );
}

beforeEach(() => {
  __resetModalHistoryForTests();
  window.history.replaceState({ __NA: true }, '');
  window.sessionStorage.clear();
  (global as any).fetch = jest.fn();
});
afterEach(() => { jest.restoreAllMocks(); });

describe('Indietro con la modale aperta', () => {
  test('ScheduleModal: Indietro chiude la modale invece di lasciare la pagina', async () => {
    const onClose = jest.fn();
    render(<Modal onClose={onClose} />);
    await settle();
    expect(window.history.state?.__wlModal).toBe(1);
    await pressBack();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('ScheduleModal: con il calendario aperto, Indietro chiude solo il calendario', async () => {
    const onClose = jest.fn();
    render(<Modal onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Modifica data/i }));
    await settle();
    expect(window.history.state?.__wlModal).toBe(2);
    await pressBack();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Messaggio per Mario Rossi/i)).toBeInTheDocument();
  });

  test('ContactPicker: Indietro chiude il selettore', async () => {
    (global as any).fetch = jest.fn(() => new Promise(() => {}));
    const onClose = jest.fn();
    render(<ContactPickerModal open={true} onClose={onClose} onSelect={() => {}} />);
    await settle();
    expect(window.history.state?.__wlModal).toBe(1);
    await pressBack();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Bozza non inviata', () => {
  test('testo e ripetizione tornano con "Riprendi bozza" riaprendo per lo stesso contatto', async () => {
    const { rerender } = render(<Modal />);
    fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: 'Allenamento spostato alle 18, portate le scarpe da calcetto' } });
    await settle();

    // L'app si ricarica (service worker, Android che chiude la scheda…): modale smontata.
    rerender(<div />);
    rerender(<Modal />);
    await settle();
    expect(screen.getByPlaceholderText(/Scrivi il messaggio/i)).toHaveValue('');
    expect(screen.getByText(/Hai una bozza non inviata/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Riprendi bozza/i }));
    expect(screen.getByPlaceholderText(/Scrivi il messaggio/i)).toHaveValue('Allenamento spostato alle 18, portate le scarpe da calcetto');
    expect(screen.queryByText(/Hai una bozza non inviata/i)).not.toBeInTheDocument();
  });

  test('l\'allegato già caricato torna con la bozza', async () => {
    const { rerender } = render(<Modal />);
    window.sessionStorage.setItem(SCHEDULE_DRAFT_KEY, JSON.stringify({
      v: 1, contactNumber: mario.number, message: '', scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
      recurrence: 'none', media: { media_url: '39333/u-orari.pdf', media_type: 'document', media_filename: 'orari.pdf', bytes: 2048 }, savedAt: Date.now(),
    }));
    rerender(<div />);
    rerender(<Modal />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Riprendi bozza/i }));
    expect(screen.getByText('orari.pdf')).toBeInTheDocument();
  });

  test('la bozza di Mario NON viene proposta a Luigi', async () => {
    const { rerender } = render(<Modal />);
    fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: 'Solo per Mario' } });
    await settle();
    rerender(<div />);
    rerender(<Modal contact={luigi} />);
    await settle();
    expect(screen.queryByText(/Hai una bozza non inviata/i)).not.toBeInTheDocument();
  });

  test('riaprire la modale per Luigi non salva il testo rimasto di Mario come bozza di Luigi', async () => {
    const { rerender } = render(<Modal />);
    fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: 'Solo per Mario' } });
    await settle();
    // Stessa istanza montata: si chiude e si riapre per un altro contatto.
    rerender(<Modal open={false} />);
    rerender(<Modal contact={luigi} />);
    await settle();
    const raw = JSON.parse(window.sessionStorage.getItem(SCHEDULE_DRAFT_KEY) || '{}');
    expect(raw.contactNumber).toBe(mario.number);
  });

  test('dopo un invio riuscito la bozza sparisce', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const { rerender } = render(<Modal />);
    fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: 'Ci vediamo sabato' } });
    await settle();
    expect(window.sessionStorage.getItem(SCHEDULE_DRAFT_KEY)).not.toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Invia/i })); });
    await settle();
    expect(window.sessionStorage.getItem(SCHEDULE_DRAFT_KEY)).toBeNull();
    rerender(<div />);
    rerender(<Modal />);
    await settle();
    expect(screen.queryByText(/Hai una bozza non inviata/i)).not.toBeInTheDocument();
  });

  test('storage bloccato (modalità privata): nessun crash, la modale funziona', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    render(<Modal />);
    fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), { target: { value: 'ciao' } });
    await settle();
    expect(screen.getByPlaceholderText(/Scrivi il messaggio/i)).toHaveValue('ciao');
  });
});

describe('schedule-draft (helper)', () => {
  const base = { contactNumber: mario.number, message: 'ciao', scheduledAt: '2026-10-01T16:00:00.000Z', recurrence: 'weekly' as const, media: null };

  test('oltre 24 ore la bozza non si ripropone', () => {
    saveScheduleDraft(base, 1_000);
    expect(loadScheduleDraft(mario.number, 1_000 + SCHEDULE_DRAFT_TTL_MS - 1)).not.toBeNull();
    expect(loadScheduleDraft(mario.number, 1_000 + SCHEDULE_DRAFT_TTL_MS + 1)).toBeNull();
  });

  test('JSON rotto o valori strani: niente bozza, niente crash', () => {
    window.sessionStorage.setItem(SCHEDULE_DRAFT_KEY, '{nope');
    expect(loadScheduleDraft(mario.number)).toBeNull();
    window.sessionStorage.setItem(SCHEDULE_DRAFT_KEY, JSON.stringify({ v: 1, contactNumber: mario.number, message: 'x', savedAt: Date.now(), recurrence: 'yearly', media: { media_url: 1 } }));
    expect(loadScheduleDraft(mario.number)).toMatchObject({ recurrence: 'none', media: null });
  });

  test('un orario già passato (o a meno di un minuto) non viene ripristinato', () => {
    const d = { ...base, v: 1 as const, savedAt: 0 };
    expect(draftDateTime(d, Date.parse('2026-10-01T15:59:30.000Z'))).toBeNull();
    expect(draftDateTime(d, Date.parse('2026-09-30T10:00:00.000Z'))).not.toBeNull();
  });
});
