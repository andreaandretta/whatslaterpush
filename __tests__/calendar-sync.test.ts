/**
 * Calendar sync — pure logic (app/lib/calendar-sync.ts): phone extraction,
 * recipient name cleaning, event start (all-day = 09:00 Europe/Rome),
 * send-time clamps, template rendering ({nome} left for the send cron),
 * and the insert/update/cancel diff with the 100-inserts cap.
 *
 * Date/time expectations are Europe/Rome wall-clock: run with TZ=UTC too
 * (Vercel runs UTC) — the implementation must not depend on the server TZ.
 */
import {
  extractEventPhone,
  cleanRecipientName,
  eventStartOf,
  computeSendAt,
  renderReminderTemplate,
  buildEventKey,
  diffEventsToActions,
  DEFAULT_REMINDER_TEMPLATE,
  MAX_INSERTS_PER_SYNC,
  type CalendarEvent,
  type ExistingReminderRow,
} from '../app/lib/calendar-sync';

const NOW = new Date('2026-09-01T10:00:00Z');

const CONNECTION = {
  id: 'conn1',
  user_phone: '393331112223',
  reminder_offset_minutes: 60,
  message_template: null as string | null,
};

// 2026-09-10 is a Thursday; 13:30Z = 15:30 Europe/Rome (CEST).
const evt = (id: string, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  status: 'confirmed',
  summary: 'Mario Rossi 3401234567',
  start: { dateTime: '2026-09-10T13:30:00Z' },
  // Default fixture = evento creato dall'utente stesso (il caso normale ICP).
  // Il gate di provenienza (isEventTrusted) è testato a parte.
  creator: { self: true },
  ...over,
});

describe('extractEventPhone', () => {
  test('phone in summary (mobile senza prefisso) → normalizzato 39…', () => {
    const r = extractEventPhone({ summary: 'Mario Rossi 3401234567' });
    expect(r).toEqual({ phone: '393401234567', rawMatch: '3401234567' });
  });

  test('formato internazionale con spazi', () => {
    const r = extractEventPhone({ summary: 'Visita +39 340 123 4567' });
    expect(r).toEqual({ phone: '393401234567', rawMatch: '+39 340 123 4567' });
  });

  test('separatori misti (trattini)', () => {
    const r = extractEventPhone({ summary: 'Mario 340-123-4567' });
    expect(r?.phone).toBe('393401234567');
  });

  test('fisso con 0 iniziale (comportamento normalizeItalianPhone: 0 rimosso)', () => {
    const r = extractEventPhone({ summary: 'Studio 0612345678' });
    expect(r?.phone).toBe('39612345678');
  });

  test('priorità: summary vince su description e location', () => {
    const r = extractEventPhone({
      summary: 'A 3401111111',
      description: 'B 3402222222',
      location: 'C 3403333333',
    });
    expect(r?.phone).toBe('393401111111');
  });

  test('fallback su description, poi location', () => {
    expect(
      extractEventPhone({ summary: 'Solo nome', description: 'tel 3402222222' })?.phone
    ).toBe('393402222222');
    expect(
      extractEventPhone({ summary: 'Solo nome', location: '3403333333' })?.phone
    ).toBe('393403333333');
  });

  test('una data (10/09/2026) NON è un telefono', () => {
    expect(extractEventPhone({ summary: 'Riunione del 10/09/2026' })).toBeNull();
    // ...ma il telefono dopo la data viene trovato
    const r = extractEventPhone({ description: 'Il 10/09/2026 con Mario 3401234567' });
    expect(r?.phone).toBe('393401234567');
  });

  test('run troppo corta o troppo lunga → null', () => {
    expect(extractEventPhone({ summary: 'codice 12345678' })).toBeNull();
    expect(extractEventPhone({ summary: 'seriale 12345678901234567' })).toBeNull();
  });

  test('nessun campo / nessun numero → null', () => {
    expect(extractEventPhone({})).toBeNull();
    expect(extractEventPhone({ summary: 'Mario Rossi' })).toBeNull();
  });

  test('normalizeFn iniettabile', () => {
    const r = extractEventPhone({ summary: 'x 3401234567' }, () => '11122233344');
    expect(r?.phone).toBe('11122233344');
  });
});

describe('cleanRecipientName', () => {
  test('rimuove il numero e trimma', () => {
    expect(cleanRecipientName('Mario Rossi 3401234567', '3401234567')).toBe('Mario Rossi');
  });

  test('separatore residuo in coda rimosso', () => {
    expect(cleanRecipientName('Mario Rossi - 3401234567', '3401234567')).toBe('Mario Rossi');
    expect(cleanRecipientName('Mario · 3401234567', '3401234567')).toBe('Mario');
    expect(cleanRecipientName('Mario, 3401234567', '3401234567')).toBe('Mario');
  });

  test('parentesi residue rimosse', () => {
    expect(cleanRecipientName('(+39 340 1234567) Mario', '+39 340 1234567')).toBe('Mario');
  });

  test('separatori interni legittimi conservati', () => {
    expect(cleanRecipientName('Dentista - Mario 3401234567', '3401234567')).toBe('Dentista - Mario');
  });

  test('solo numero → null', () => {
    expect(cleanRecipientName('3401234567', '3401234567')).toBeNull();
  });

  test('summary assente → null', () => {
    expect(cleanRecipientName(null, '340')).toBeNull();
    expect(cleanRecipientName(undefined, '340')).toBeNull();
    expect(cleanRecipientName('', '340')).toBeNull();
  });

  test('cap 100 caratteri', () => {
    const long = 'A'.repeat(150);
    expect(cleanRecipientName(long, null)?.length).toBe(100);
  });
});

describe('eventStartOf', () => {
  test('dateTime con offset → stesso istante', () => {
    const d = eventStartOf({ start: { dateTime: '2026-09-10T15:30:00+02:00' } });
    expect(d?.toISOString()).toBe('2026-09-10T13:30:00.000Z');
  });

  test('all-day estate → 09:00 Rome = 07:00Z (CEST)', () => {
    const d = eventStartOf({ start: { date: '2026-09-10' } });
    expect(d?.toISOString()).toBe('2026-09-10T07:00:00.000Z');
  });

  test('all-day inverno → 09:00 Rome = 08:00Z (CET)', () => {
    const d = eventStartOf({ start: { date: '2026-12-10' } });
    expect(d?.toISOString()).toBe('2026-12-10T08:00:00.000Z');
  });

  test('start assente / vuoto / malformato → null', () => {
    expect(eventStartOf({})).toBeNull();
    expect(eventStartOf({ start: {} })).toBeNull();
    expect(eventStartOf({ start: { dateTime: 'garbage' } })).toBeNull();
    expect(eventStartOf({ start: { date: '10/09/2026' } })).toBeNull();
  });
});

describe('computeSendAt', () => {
  test('caso normale: start − offset', () => {
    const r = computeSendAt(new Date('2026-09-03T10:00:00Z'), 60, NOW);
    expect(r?.toISOString()).toBe('2026-09-03T09:00:00.000Z');
  });

  test('offset 0 → invia allo start', () => {
    const r = computeSendAt(new Date('2026-09-03T10:00:00Z'), 0, NOW);
    expect(r?.toISOString()).toBe('2026-09-03T10:00:00.000Z');
  });

  test('sendAt nel passato ma evento futuro → clamp a now+5min', () => {
    const start = new Date(NOW.getTime() + 30 * 60 * 1000); // fra 30min, offset 60
    const r = computeSendAt(start, 60, NOW);
    expect(r?.toISOString()).toBe(new Date(NOW.getTime() + 5 * 60 * 1000).toISOString());
  });

  test('sendAt sotto now+2min → clamp a now+5min', () => {
    const start = new Date(NOW.getTime() + 61 * 60 * 1000); // sendAt = now+1min
    const r = computeSendAt(start, 60, NOW);
    expect(r?.toISOString()).toBe(new Date(NOW.getTime() + 5 * 60 * 1000).toISOString());
  });

  test('sendAt esattamente a now+2min → NON clampato', () => {
    const start = new Date(NOW.getTime() + 62 * 60 * 1000); // sendAt = now+2min
    const r = computeSendAt(start, 60, NOW);
    expect(r?.toISOString()).toBe(new Date(NOW.getTime() + 2 * 60 * 1000).toISOString());
  });

  test('evento già iniziato/passato → null', () => {
    expect(computeSendAt(NOW, 60, NOW)).toBeNull();
    expect(computeSendAt(new Date(NOW.getTime() - 1000), 0, NOW)).toBeNull();
  });
});

describe('renderReminderTemplate', () => {
  const vars = { evento: 'Visita', data: 'gio 10 set', ora: '15:30' };

  test('template null → default, {nome} INTOCCATO (lo risolve il cron di invio)', () => {
    const out = renderReminderTemplate(null, vars);
    expect(out).toBe('Ciao {nome}, ti ricordo l\'appuntamento "Visita" di gio 10 set alle 15:30. A presto!');
    expect(out).toContain('{nome}');
  });

  test('template custom: {evento}/{data}/{ora} risolti, {nome} lasciato', () => {
    const out = renderReminderTemplate('{nome}: {evento} — {data} {ora}', vars);
    expect(out).toBe('{nome}: Visita — gio 10 set 15:30');
  });

  test('token con spazi e case-insensitive', () => {
    expect(renderReminderTemplate('{ Evento } alle { ORA }', vars)).toBe('Visita alle 15:30');
  });

  test('template vuoto/blank → default', () => {
    expect(renderReminderTemplate('   ', vars)).toBe(renderReminderTemplate(null, vars));
    expect(renderReminderTemplate(undefined, vars)).toContain('A presto!');
  });

  test('cap 3500 caratteri', () => {
    const out = renderReminderTemplate('A'.repeat(4000), vars);
    expect(out.length).toBe(3500);
  });

  test('default template esportato coerente', () => {
    expect(DEFAULT_REMINDER_TEMPLATE).toContain('{nome}');
    expect(DEFAULT_REMINDER_TEMPLATE).toContain('{evento}');
  });
});

describe('buildEventKey', () => {
  test('connectionId:eventId', () => {
    expect(buildEventKey('conn1', 'evt_a1')).toBe('conn1:evt_a1');
  });
});

describe('diffEventsToActions', () => {
  const run = (events: CalendarEvent[], existingRows: ExistingReminderRow[] = [], conn = CONNECTION) =>
    diffEventsToActions({ events, existingRows, connection: conn, now: NOW });

  test('evento nuovo con telefono → insert completo', () => {
    const { inserts, updates, cancels, capHit } = run([evt('e1')]);
    expect(updates).toEqual([]);
    expect(cancels).toEqual([]);
    expect(capHit).toBe(false);
    expect(inserts).toHaveLength(1);
    const row = inserts[0];
    expect(row.calendar_event_key).toBe('conn1:e1');
    expect(row.status).toBe('pending');
    expect(row.instance_phone).toBe('393331112223');
    expect(row.recipient_number).toBe('393401234567');
    expect(row.recipient_name).toBe('Mario Rossi');
    // 13:30Z − 60min offset
    expect(row.scheduled_at).toBe('2026-09-10T12:30:00.000Z');
    expect(row.caption).toBe(row.parsed_message);
    // {data}/{ora} = start dell'EVENTO in ora di Roma; {nome} lasciato al cron
    expect(row.parsed_message).toContain('gio 10 set');
    expect(row.parsed_message).toContain('15:30');
    expect(row.parsed_message).toContain('{nome}');
    expect(row.parsed_message).toContain('"Mario Rossi"');
  });

  test('evento invariato con riga esistente → nessuna azione', () => {
    const first = run([evt('e1')]).inserts[0];
    const existing: ExistingReminderRow = {
      id: 'row1',
      status: 'pending',
      scheduled_at: first.scheduled_at,
      parsed_message: first.parsed_message,
      calendar_event_key: first.calendar_event_key,
    };
    const r = run([evt('e1')], [existing]);
    expect(r.inserts).toEqual([]);
    expect(r.updates).toEqual([]);
    expect(r.cancels).toEqual([]);
  });

  test('evento spostato → update di scheduled_at + testo (pending)', () => {
    const first = run([evt('e1')]).inserts[0];
    const existing: ExistingReminderRow = {
      id: 'row1',
      status: 'pending',
      scheduled_at: first.scheduled_at,
      parsed_message: first.parsed_message,
      calendar_event_key: first.calendar_event_key,
    };
    const moved = evt('e1', { start: { dateTime: '2026-09-11T09:00:00Z' } });
    const r = run([moved], [existing]);
    expect(r.inserts).toEqual([]);
    expect(r.updates).toHaveLength(1);
    expect(r.updates[0].id).toBe('row1');
    expect(r.updates[0].scheduled_at).toBe('2026-09-11T08:00:00.000Z');
    expect(r.updates[0].parsed_message).toContain('11:00'); // 09:00Z = 11:00 Rome
    expect(r.updates[0].caption).toBe(r.updates[0].parsed_message);
  });

  test('riga paused → update permesso', () => {
    const first = run([evt('e1')]).inserts[0];
    const existing: ExistingReminderRow = {
      id: 'row1',
      status: 'paused',
      scheduled_at: first.scheduled_at,
      parsed_message: 'testo vecchio',
      calendar_event_key: first.calendar_event_key,
    };
    const r = run([evt('e1')], [existing]);
    expect(r.updates).toHaveLength(1);
  });

  test('riga sent/processing/failed → MAI toccata anche se l\'evento cambia', () => {
    for (const status of ['sent', 'processing', 'failed', 'cancelled']) {
      const existing: ExistingReminderRow = {
        id: 'row1',
        status,
        scheduled_at: '2026-09-10T12:30:00.000Z',
        parsed_message: 'vecchio',
        calendar_event_key: 'conn1:e1',
      };
      const moved = evt('e1', { start: { dateTime: '2026-09-11T09:00:00Z' } });
      const r = run([moved], [existing]);
      expect(r.inserts).toEqual([]);
      expect(r.updates).toEqual([]);
    }
  });

  test('evento sparito dalla finestra → cancel della riga pending futura', () => {
    const existing: ExistingReminderRow = {
      id: 'row-gone',
      status: 'pending',
      scheduled_at: '2026-09-10T12:30:00.000Z', // futuro rispetto a NOW
      parsed_message: 'x',
      calendar_event_key: 'conn1:gone',
    };
    const r = run([evt('e1')], [existing]);
    expect(r.cancels).toEqual(['row-gone']);
  });

  test('evento presente ma status cancelled → cancel', () => {
    const existing: ExistingReminderRow = {
      id: 'row1',
      status: 'pending',
      scheduled_at: '2026-09-10T12:30:00.000Z',
      parsed_message: 'x',
      calendar_event_key: 'conn1:e1',
    };
    const r = run([evt('e1', { status: 'cancelled' })], [existing]);
    expect(r.inserts).toEqual([]);
    expect(r.cancels).toEqual(['row1']);
  });

  test('cancel NON tocca righe già passate, non-pending o di altre connessioni', () => {
    const rows: ExistingReminderRow[] = [
      { id: 'past', status: 'pending', scheduled_at: '2026-08-30T10:00:00.000Z', parsed_message: 'x', calendar_event_key: 'conn1:a' },
      { id: 'sent', status: 'sent', scheduled_at: '2026-09-10T10:00:00.000Z', parsed_message: 'x', calendar_event_key: 'conn1:b' },
      { id: 'other', status: 'pending', scheduled_at: '2026-09-10T10:00:00.000Z', parsed_message: 'x', calendar_event_key: 'connX:c' },
    ];
    const r = run([], rows);
    expect(r.cancels).toEqual([]);
  });

  test('evento senza telefono → skip, ma NON è "sparito" (no cancel)', () => {
    const existing: ExistingReminderRow = {
      id: 'row1',
      status: 'pending',
      scheduled_at: '2026-09-10T12:30:00.000Z',
      parsed_message: 'x',
      calendar_event_key: 'conn1:e1',
    };
    const r = run([evt('e1', { summary: 'Solo nome, niente numero' })], [existing]);
    expect(r.inserts).toEqual([]);
    expect(r.updates).toEqual([]);
    expect(r.cancels).toEqual([]);
  });

  test('evento già iniziato → skip totale (né insert né cancel)', () => {
    const existing: ExistingReminderRow = {
      id: 'row1',
      status: 'pending',
      scheduled_at: '2026-09-10T12:30:00.000Z',
      parsed_message: 'x',
      calendar_event_key: 'conn1:e1',
    };
    const past = evt('e1', { start: { dateTime: '2026-09-01T09:00:00Z' } }); // < NOW
    const r = run([past], [existing]);
    expect(r.inserts).toEqual([]);
    expect(r.updates).toEqual([]);
    expect(r.cancels).toEqual([]);
  });

  test('all-day event → promemoria basato sulle 09:00 di Roma', () => {
    const r = run([evt('e1', { start: { date: '2026-09-10' } })]);
    expect(r.inserts).toHaveLength(1);
    // 09:00 Rome = 07:00Z, meno offset 60 → 06:00Z
    expect(r.inserts[0].scheduled_at).toBe('2026-09-10T06:00:00.000Z');
    expect(r.inserts[0].parsed_message).toContain('9:00');
  });

  test('template custom della connessione usato', () => {
    const conn = { ...CONNECTION, message_template: 'Promemoria: {evento} alle {ora}' };
    const r = run([evt('e1')], [], conn);
    expect(r.inserts[0].parsed_message).toBe('Promemoria: Mario Rossi alle 15:30');
  });

  test('cap 100 insert per sync + capHit', () => {
    const events = Array.from({ length: 150 }, (_, i) => evt(`e${i}`));
    const r = run(events);
    expect(r.inserts).toHaveLength(MAX_INSERTS_PER_SYNC);
    expect(r.capHit).toBe(true);
  });

  test('evento senza id → ignorato', () => {
    const r = run([evt('') as CalendarEvent]);
    expect(r.inserts).toEqual([]);
  });
});

// ── Gate di provenienza (review MEDIUM): mai auto-schedulare inviti altrui ──

import { isEventTrusted } from '@/app/lib/calendar-sync';

describe('isEventTrusted', () => {
  it('accetta eventi creati dall\'account collegato', () => {
    expect(isEventTrusted({ creator: { self: true } })).toBe(true);
  });

  it('accetta eventi organizzati dall\'account collegato', () => {
    expect(isEventTrusted({ organizer: { self: true } })).toBe(true);
  });

  it('accetta inviti ESPLICITAMENTE accettati', () => {
    expect(isEventTrusted({
      creator: { self: false },
      attendees: [{ self: true, responseStatus: 'accepted' }],
    })).toBe(true);
  });

  it('rifiuta inviti auto-aggiunti non accettati (vettore spam)', () => {
    expect(isEventTrusted({
      creator: { self: false },
      organizer: { self: false },
      attendees: [{ self: true, responseStatus: 'needsAction' }],
    })).toBe(false);
    expect(isEventTrusted({
      attendees: [{ self: true, responseStatus: 'declined' }],
    })).toBe(false);
    expect(isEventTrusted({})).toBe(false);
  });
});

describe('diffEventsToActions — gate di provenienza', () => {
  const conn = {
    id: 'conn-1',
    user_phone: '393331112222',
    reminder_offset_minutes: 60,
    message_template: null,
  };
  const NOW = new Date('2026-09-01T08:00:00Z');

  it('un invito di terzi non accettato NON genera insert né update', () => {
    const attacker = {
      id: 'evil-1',
      status: 'confirmed',
      summary: 'Clicca qui +39 340 999 8877',
      start: { dateTime: '2026-09-10T13:30:00Z' },
      creator: { self: false },
      organizer: { self: false },
      attendees: [{ self: true, responseStatus: 'needsAction' }],
    };
    const r = diffEventsToActions({ events: [attacker], existingRows: [], connection: conn, now: NOW });
    expect(r.inserts).toEqual([]);
    expect(r.updates).toEqual([]);
  });

  it('un evento non fidato ancora presente NON cancella la riga esistente (unschedulable ≠ removed)', () => {
    const attacker = {
      id: 'e1',
      status: 'confirmed',
      summary: 'Mario Rossi 3401234567',
      start: { dateTime: '2026-09-10T13:30:00Z' },
      creator: { self: false },
    };
    const existing = [{
      id: 'row-1',
      status: 'pending',
      scheduled_at: '2026-09-10T12:30:00.000Z',
      parsed_message: 'x',
      calendar_event_key: 'conn-1:e1',
    }];
    const r = diffEventsToActions({ events: [attacker], existingRows: existing, connection: conn, now: NOW });
    expect(r.cancels).toEqual([]);
    expect(r.updates).toEqual([]);
  });
});
