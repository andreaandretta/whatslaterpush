import { mapErrorReason, mapPendingReason, isIndeterminateSend, isNotOnWhatsAppError, looksDisconnected } from '../app/lib/message-error';

describe('mapErrorReason', () => {
  describe('disconnected (→ "Ricollega")', () => {
    test.each([
      'HTTP 401: unauthorized',
      'HTTP 403: Forbidden',
      'HTTP 404: instance not found',
      'Connection Closed',
      'Connection Terminated by server',
      'Stream Errored (conflict): logged out',
      'logout',
      'session expired, please reconnect',
      'Istanza disconnessa, retry 3/12 fra 5 min',
    ])('%s → disconnected', (raw) => {
      const r = mapErrorReason(raw);
      expect(r.kind).toBe('disconnected');
      expect(r.label).toBe('WhatsApp disconnesso — ricollega');
    });
  });

  describe('invalid_number (→ "Numero non su WhatsApp")', () => {
    test.each([
      'HTTP 400: {"status":400,"message":"number does not exist"}',
      'recipient not on whatsapp',
      '{"exists":false}',
      'invalid jid for recipient',
    ])('%s → invalid_number', (raw) => {
      expect(mapErrorReason(raw).kind).toBe('invalid_number');
    });
  });

  describe('rate_limited (→ "Troppi invii")', () => {
    test.each([
      'HTTP 429: Too Many Requests',
      'rate-limit exceeded',
      'rate_limit hit',
    ])('%s → rate_limited', (raw) => {
      expect(mapErrorReason(raw).kind).toBe('rate_limited');
    });
  });

  describe('generic fallback (raw code never leaks)', () => {
    test.each([
      'HTTP 500: internal server error',
      'Failed to sign media URL',
      'fetch failed',
      'Unknown error',
      '',
      undefined,
      null,
    ])('%s → generic', (raw) => {
      const r = mapErrorReason(raw as string | null | undefined);
      expect(r.kind).toBe('generic');
      expect(r.label).toBe('Invio non riuscito — riprova');
    });
  });

  // Forma reale in prod (tutti i 400 salvati): anche i 400 "exists": false
  // hanno "error":"Bad Request", ma NON ogni "Bad Request" è un numero.
  const PROD_EXISTS_FALSE = 'HTTP 400: {"status":400,"error":"Bad Request","response":{"message":[{"jid":"393331234567@s.whatsapp.net","exists":false,"number":"393331234567"}]}}';
  const MEDIA_400 = 'HTTP 400: {"status":400,"error":"Bad Request","response":{"message":["Error: Invalid media type"]}}';

  describe('a generic 400 is not "Numero non su WhatsApp"', () => {
    test('prod exists:false body → invalid_number (with or without media)', () => {
      expect(mapErrorReason(PROD_EXISTS_FALSE).kind).toBe('invalid_number');
      expect(mapErrorReason(PROD_EXISTS_FALSE, { hasMedia: true }).kind).toBe('invalid_number');
    });
    test('media message + non-exists 400 → media_rejected with an Italian label', () => {
      const r = mapErrorReason(MEDIA_400, { hasMedia: true });
      expect(r.kind).toBe('media_rejected');
      expect(r.label).toBe('Allegato non accettato da WhatsApp — cambia file');
    });
    test.each(['HTTP 400: Bad Request', MEDIA_400])('text-only %s → generic (keeps Riprova)', (raw) => {
      expect(mapErrorReason(raw).kind).toBe('generic');
    });
  });

  test('a disconnected session inside a 4xx body wins over the 400 → number heuristic', () => {
    // Evolution can return HTTP 400 whose body says the socket is closed.
    // Reconnect is the fix, not "the number is wrong".
    expect(mapErrorReason('HTTP 400: Connection Closed').kind).toBe('disconnected');
  });
});

describe('mapPendingReason (righe in coda spostate dal cron)', () => {
  test.each([
    ['Istanza disconnessa, retry 2/12 fra 5 min', 'In attesa: WhatsApp scollegato'],
    ['Istanza disconnessa per 12× 5min, riprogrammato a domani', 'Spostato a domani: WhatsApp scollegato'],
    ['Instance disconnected, rescheduled to 2026-05-14T07:00:00.000Z', 'Spostato a domani: WhatsApp scollegato'],
    ['Limite giornaliero raggiunto (5/5) nei primi giorni dal collegamento — riprogrammato a domattina', 'Spostato a domattina: nei primi giorni dal collegamento si inviano pochi messaggi al giorno'],
    ['Limite giornaliero raggiunto (50/50) — riprogrammato a domattina', 'Spostato a domattina: raggiunto il limite di messaggi del giorno'],
    ['Limite giornaliero raggiunto — riprogrammato dopo il reset di mezzanotte', 'Spostato a domattina: raggiunto il limite di messaggi del giorno'],
    ['Numeri nuovi: massimo 5 al giorno a chi non ti ha mai scritto — riprogrammato a domattina', 'Spostato a domattina: pochi numeri nuovi al giorno, per proteggere il tuo WhatsApp'],
    ['Cool-down: max 3 messaggi allo stesso contatto in 24h. Riprogrammato +30 min.', 'Spostato: già 3 messaggi a questo contatto nelle ultime 24 ore'],
    ['Invii sospesi (troppi fallimenti nelle ultime 24h) — riprogrammato a domattina', 'Spostato a domattina: troppi invii non riusciti nelle ultime 24 ore'],
    ['Rate limit raggiunto — riprogrammato a domattina', 'Spostato a domattina: troppi invii ravvicinati'],
    ['Trial scaduto — messaggio in pausa, riattiva con un piano', 'In pausa: la prova gratuita è scaduta'],
  ])('%s', (raw, expected) => {
    expect(mapPendingReason(raw)).toBe(expected);
  });

  test('the cron\'s new reasons are already user-facing and pass through', () => {
    expect(mapPendingReason('Massimo 3 messaggi in 24 ore alla stessa persona: parte domani 09:12')).toBe('Massimo 3 messaggi in 24 ore alla stessa persona: parte domani 09:12');
    expect(mapPendingReason('WhatsApp ricollegato: invii arretrati distanziati per non partire tutti insieme')).toMatch(/^WhatsApp ricollegato/);
  });

  test('suppression pause texts are already user-facing and pass through', () => {
    const t = 'In pausa: il destinatario ha chiesto di non ricevere più messaggi (ha scritto "stop"). Riprendi solo se te lo ha chiesto lui.';
    expect(mapPendingReason(t)).toBe(t);
  });

  test('a transient send error requeued by the cron never leaks raw', () => {
    const r = mapPendingReason('HTTP 500: {"status":500,"error":"Internal Server Error"}');
    expect(r).toBe("Nuovo tentativo a breve: l'invio precedente non è riuscito");
    expect(r).not.toMatch(/HTTP|500/);
  });

  test('no reason → null', () => {
    expect(mapPendingReason(null)).toBeNull();
    expect(mapPendingReason('')).toBeNull();
  });
});

describe('isIndeterminateSend ("Da verificare")', () => {
  const base = { status: 'sent', evolution_message_id: null, delivered_at: null, read_at: null };
  test('timeout marker without an Evolution id → true', () => {
    expect(isIndeterminateSend({ ...base, error_message: 'send_timeout_indeterminate: nessuna conferma da Evolution entro 8s, marcato inviato per evitare duplicati (verifica ✓✓ su WhatsApp se critico)' })).toBe(true);
  });
  test('lambda-died marker → true', () => {
    expect(isIndeterminateSend({ ...base, error_message: 'send_indeterminate: lambda died mid-send, marked sent to avoid duplicate (verify WhatsApp ✓✓ if critical)' })).toBe(true);
  });
  test('stale reason on a normally sent row → false', () => {
    expect(isIndeterminateSend({ ...base, error_message: 'Istanza disconnessa, retry 2/12 fra 5 min' })).toBe(false);
  });
  test('an Evolution id or a receipt is the missing proof → false', () => {
    const e = 'send_timeout_indeterminate: x';
    expect(isIndeterminateSend({ ...base, error_message: e, evolution_message_id: 'ABC' })).toBe(false);
    expect(isIndeterminateSend({ ...base, error_message: e, delivered_at: '2026-09-25T10:00:00Z' })).toBe(false);
  });
  test('not sent → false', () => {
    expect(isIndeterminateSend({ ...base, status: 'failed', error_message: 'send_indeterminate: x' })).toBe(false);
  });
});

test('isNotOnWhatsAppError is unchanged (the cron fast-fails on it)', () => {
  expect(isNotOnWhatsAppError('HTTP 400: {"exists":false}')).toBe(true);
  expect(isNotOnWhatsAppError('HTTP 400: Bad Request')).toBe(false);
});

describe('allegato scaduto (cleanup dei 30 giorni)', () => {
  test('the cron\'s MEDIA_EXPIRED_ERROR is a media problem, not a retryable one', () => {
    const { MEDIA_EXPIRED_ERROR } = require('../app/lib/cron-utils');
    const r = mapErrorReason(MEDIA_EXPIRED_ERROR, { hasMedia: true });
    expect(r.kind).toBe('media_rejected');
    expect(r.label).toMatch(/Duplica/);
  });
});

describe('gruppi (isGroup)', () => {
  // Evolution 2.3.7: NotFoundException('Group not found') lanciato nel try e
  // serializzato dentro un BadRequestException → "[object Object]".
  const GROUP_GONE = 'HTTP 400: {"status":400,"error":"Bad Request","response":{"message":["[object Object]"]}}';

  test('400 con [object Object] → group_unreachable, anche con allegato', () => {
    const r = mapErrorReason(GROUP_GONE, { isGroup: true });
    expect(r.kind).toBe('group_unreachable');
    expect(r.label).toBe('Gruppo non raggiungibile — controlla di farne ancora parte');
    expect(mapErrorReason(GROUP_GONE, { isGroup: true, hasMedia: true }).kind).toBe('group_unreachable');
  });

  test.each(['group not found', 'HTTP 404: item-not-found', 'not-authorized'])('%s con isGroup → group_unreachable', (raw) => {
    expect(mapErrorReason(raw, { isGroup: true }).kind).toBe('group_unreachable');
  });

  test('[object Object] senza il prefisso 400 → come oggi', () => {
    expect(mapErrorReason('[object Object]', { isGroup: true }).kind).toBe(mapErrorReason('[object Object]').kind);
    expect(mapErrorReason('HTTP 500: [object Object]', { isGroup: true }).kind).toBe('generic');
  });

  test('senza isGroup → come oggi', () => {
    expect(mapErrorReason(GROUP_GONE).kind).toBe('generic');
    expect(mapErrorReason(GROUP_GONE, { hasMedia: true }).kind).toBe('media_rejected');
  });

  test('HTTP 403 forbidden con isGroup → disconnected (guardia di Evolution, non il gruppo)', () => {
    expect(mapErrorReason('HTTP 403: forbidden', { isGroup: true }).kind).toBe('disconnected');
  });

  test('allegato scaduto vince anche per i gruppi', () => {
    expect(mapErrorReason('Allegato non più disponibile (pulizia 30 giorni)', { isGroup: true }).kind).toBe('media_rejected');
  });

  test('rate-overlimit → rate_limited', () => {
    expect(mapErrorReason('HTTP 400: {"response":{"message":["rate-overlimit"]}}').kind).toBe('rate_limited');
    expect(mapErrorReason('rate-overlimit', { isGroup: true }).kind).toBe('rate_limited');
  });

  test('looksDisconnected usa lo stesso criterio', () => {
    expect(looksDisconnected('Connection Closed')).toBe(true);
    expect(looksDisconnected('HTTP 400: Not Connected')).toBe(true);
    expect(looksDisconnected('HTTP 400: rate-overlimit')).toBe(false);
    expect(looksDisconnected(null)).toBe(false);
  });

  test('mapPendingReason: gruppo grande in warm-up', () => {
    expect(mapPendingReason('Gruppo con più di 50 persone: nei primi giorni dal collegamento si aspetta — riprogrammato a domattina'))
      .toBe('Spostato a domattina: nei primi giorni dal collegamento i gruppi grandi aspettano, per proteggere il tuo WhatsApp');
  });

  test('mapPendingReason: i motivi di gruppo scritti dal cron passano così come sono', () => {
    const t = 'In pausa: non risulti più nel gruppo «Genitori» (o il gruppo non esiste più). Se ci rientri, tocca Riprendi.';
    expect(mapPendingReason(t)).toBe(t);
    const c = 'Massimo 3 messaggi in 24 ore nello stesso gruppo: parte domani 09:12';
    expect(mapPendingReason(c)).toBe(c);
    const r = 'Controllo del gruppo non riuscito (WhatsApp non ha risposto): si riprova più tardi, per proteggere il tuo WhatsApp';
    expect(mapPendingReason(r)).toBe(r);
  });
});
