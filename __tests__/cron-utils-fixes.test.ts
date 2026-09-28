/**
 * Helper puri aggiunti col giro "errori reali" (audit 25 set 2026): circuit
 * breaker per destinatario, timeout d'invio proporzionale all'allegato,
 * cool-down con orario di uscita onesto, scaletta della disconnessione e
 * distribuzione del backlog alla riconnessione.
 */
import {
  countBreakerFailures,
  BREAKER_THRESHOLD,
  sendTimeoutMs,
  cooldownReleaseAt,
  disconnectRetryStep,
  DISCONNECT_RETRY_THRESHOLD,
  planBacklogSpread,
  isLateDisconnectBacklog,
} from '../app/lib/cron-utils';

const EXISTS_FALSE = 'HTTP 400: {"status":400,"error":"Bad Request","response":{"message":[{"jid":"390811234567@s.whatsapp.net","exists":false,"number":"390811234567"}]}}';

describe('countBreakerFailures — il breaker guarda la salute del MITTENTE, non i numeri sbagliati', () => {
  test('5 numeri inesistenti (exists:false) NON contano: il breaker resta a 0', () => {
    const rows = ['390811', '390812', '390813', '390814', '390815'].map((r) => ({ recipient_number: r, error_message: EXISTS_FALSE }));
    expect(countBreakerFailures(rows)).toBe(0);
    expect(countBreakerFailures(rows)).toBeLessThan(BREAKER_THRESHOLD);
  });

  test('conta per destinatario distinto: 5 "Riprova" falliti verso lo stesso cliente valgono 1', () => {
    const rows = Array.from({ length: 5 }, () => ({ recipient_number: '393401234567', error_message: 'HTTP 500: boom' }));
    expect(countBreakerFailures(rows)).toBe(1);
  });

  test('guasti di trasporto verso 5 clienti diversi fanno ancora scattare il breaker', () => {
    const rows = ['1', '2', '3', '4', '5'].map((r) => ({ recipient_number: '39340000000' + r, error_message: 'HTTP 500: Internal Server Error' }));
    expect(countBreakerFailures(rows)).toBe(5);
  });

  test('mix: i numeri inesistenti non gonfiano il conteggio dei guasti veri', () => {
    const rows = [
      { recipient_number: 'a', error_message: EXISTS_FALSE },
      { recipient_number: 'b', error_message: 'HTTP 502: bad gateway' },
      { recipient_number: 'b', error_message: 'HTTP 502: bad gateway' },
      { recipient_number: 'c', error_message: null },
    ];
    expect(countBreakerFailures(rows)).toBe(2);
  });
});

describe('sendTimeoutMs — un PDF da 15 MB non ha lo stesso tempo di un testo', () => {
  test('testo: 8 s come prima', () => {
    expect(sendTimeoutMs('text')).toBe(8000);
  });
  test('allegato piccolo: almeno 8 s + 2 s per MB', () => {
    expect(sendTimeoutMs('media', 260 * 1024)).toBe(10_000);
    expect(sendTimeoutMs('media', 4.5 * 1024 * 1024)).toBe(18_000);
  });
  test('allegato da 16 MB: tetto a 40 s (dentro il maxDuration della route)', () => {
    expect(sendTimeoutMs('media', 16 * 1024 * 1024)).toBe(40_000);
  });
  test('dimensione sconosciuta: il tetto, mai gli 8 s del testo', () => {
    expect(sendTimeoutMs('media', null)).toBe(40_000);
    expect(sendTimeoutMs('media', undefined)).toBe(40_000);
  });
});

describe('cooldownReleaseAt — l\'orario vero in cui il 4° messaggio può partire', () => {
  const t = (iso: string) => new Date(iso);
  test('meno di 3 invii nelle 24h: nessun blocco', () => {
    expect(cooldownReleaseAt([t('2026-09-27T10:00:00Z'), t('2026-09-27T12:00:00Z')])).toBeNull();
  });
  test('3 invii: si libera 24h dopo il PIÙ VECCHIO (non +30 min ogni 30 min)', () => {
    const out = cooldownReleaseAt([t('2026-09-27T16:00:00Z'), t('2026-09-27T09:05:00Z'), t('2026-09-27T12:00:00Z')]);
    expect(out!.toISOString()).toBe('2026-09-28T09:05:00.000Z');
  });
  test('4 invii (uno in questo stesso giro): serve che ne escano 2', () => {
    const out = cooldownReleaseAt([
      t('2026-09-27T09:00:00Z'), t('2026-09-27T10:00:00Z'), t('2026-09-27T11:00:00Z'), t('2026-09-27T12:00:00Z'),
    ]);
    expect(out!.toISOString()).toBe('2026-09-28T10:00:00.000Z');
  });
});

describe('disconnectRetryStep — la scaletta riparte ogni giorno', () => {
  test('primi 11 tentativi: +5 min', () => {
    expect(disconnectRetryStep(0, 'close')).toEqual({ newCount: 1, retryInMinutes: 5 });
    expect(disconnectRetryStep(10, 'close')).toEqual({ newCount: 11, retryInMinutes: 5 });
  });
  test('12° tentativo: domani', () => {
    expect(disconnectRetryStep(DISCONNECT_RETRY_THRESHOLD - 1, 'close')).toEqual({ newCount: 12, retryInMinutes: null });
  });
  test('BUG: dopo un lungo blackout (count=12) un glitch di pochi secondi il giorno dopo NON rinvia di un altro giorno', () => {
    // prima: newCount=13 >= 12 → subito domani. Ora: nuova scaletta, +pochi minuti.
    const step = disconnectRetryStep(12, 'connecting');
    expect(step.newCount).toBe(13);
    expect(step.retryInMinutes).not.toBeNull();
  });
  test('il secondo giorno intero di blackout rinvia di nuovo a domani (count 24)', () => {
    expect(disconnectRetryStep(23, 'close').retryInMinutes).toBeNull();
  });
  test('"connecting" è di solito un riaggancio di Baileys: i primi 3 giri ricontrollano dopo 1 minuto', () => {
    expect(disconnectRetryStep(0, 'connecting').retryInMinutes).toBe(1);
    expect(disconnectRetryStep(2, 'connecting').retryInMinutes).toBe(1);
    expect(disconnectRetryStep(3, 'connecting').retryInMinutes).toBe(5);
    expect(disconnectRetryStep(12, 'connecting').retryInMinutes).toBe(1);
  });
});

describe('planBacklogSpread — alla riconnessione il backlog esce uno per volta', () => {
  const now = Date.parse('2026-09-28T10:00:00Z');
  const row = (id: string, owner: string, count: number, status = 'open') => ({
    id, instance_phone: owner, disconnect_retry_count: count, user_instances: { connection_status: status },
  });

  test('5 messaggi arretrati dello stesso utente: 1 parte ora, gli altri a +90/180/270/360 s', () => {
    const rows = [row('a', 'u1', 3), row('b', 'u1', 3), row('c', 'u1', 3), row('d', 'u1', 3), row('e', 'u1', 3)];
    const { keep, defer } = planBacklogSpread(rows, now);
    expect(keep.map((r) => r.id)).toEqual(['a']);
    expect(defer).toEqual([
      { id: 'b', scheduledAt: new Date(now + 90_000).toISOString() },
      { id: 'c', scheduledAt: new Date(now + 180_000).toISOString() },
      { id: 'd', scheduledAt: new Date(now + 270_000).toISOString() },
      { id: 'e', scheduledAt: new Date(now + 360_000).toISOString() },
    ]);
  });

  test('righe normali (mai trattenute per disconnessione) non vengono toccate', () => {
    const rows = [row('a', 'u1', 0), row('b', 'u1', 0), row('c', 'u1', 2), row('d', 'u1', 1)];
    const { keep, defer } = planBacklogSpread(rows, now);
    expect(keep.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(defer.map((d) => d.id)).toEqual(['d']);
  });

  test('utenti diversi non si rallentano a vicenda', () => {
    const rows = [row('a', 'u1', 4), row('b', 'u2', 4)];
    expect(planBacklogSpread(rows, now).keep.map((r) => r.id)).toEqual(['a', 'b']);
  });

  test('istanza ANCORA disconnessa: nessuno spread, la riga deve fare la sua scaletta', () => {
    const rows = [row('a', 'u1', 4, 'close'), row('b', 'u1', 4, 'close')];
    const { keep, defer } = planBacklogSpread(rows, now);
    expect(keep.map((r) => r.id)).toEqual(['a', 'b']);
    expect(defer).toEqual([]);
  });
});

describe('isLateDisconnectBacklog — da quando l\'orario non è più quello scelto dall\'utente', () => {
  test('pochi minuti di ritardo (1-5 giri da 5 min): resta l\'orario dell\'utente', () => {
    expect(isLateDisconnectBacklog(0)).toBe(false);
    expect(isLateDisconnectBacklog(5)).toBe(false);
  });
  test('da mezz\'ora in poi (o rinviato a domani) l\'orario è del sistema', () => {
    expect(isLateDisconnectBacklog(6)).toBe(true);
    expect(isLateDisconnectBacklog(12)).toBe(true);
    expect(isLateDisconnectBacklog(13)).toBe(true);
  });
});
