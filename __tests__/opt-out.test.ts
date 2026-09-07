import { isOptOutText, recipientFromKey, inboundText, OPT_OUT_MAX_CHARS } from '../app/lib/opt-out';
import { shouldSuspend, ACK_ERRORS_TO_SUSPEND } from '../app/lib/custody-ack';
import { suppressionReasonText } from '../app/lib/suppressions';
import { WEBHOOK_EVENTS, buildWebhookSetBody, refreshWebhooksForOpenInstances } from '../app/lib/webhook-config';

describe('isOptOutText — solo messaggi che SONO la richiesta', () => {
  test.each(['stop', 'STOP', ' Stop! ', 'basta', 'Basta.', 'non scrivermi', 'non scrivermi più', 'Non scrivermi piu', 'cancellami', 'unsubscribe', 'smettila'])(
    'riconosce %p', (t) => expect(isOptOutText(t)).toBe(true)
  );
  test.each(['stop, ci vediamo alle 18', 'ok', 'sì', 'basta che arrivi in orario', 'non posso venire', '', 'a'.repeat(OPT_OUT_MAX_CHARS + 1)])(
    'NON riconosce %p', (t) => expect(isOptOutText(t)).toBe(false)
  );
  test('null/undefined → false', () => {
    expect(isOptOutText(null)).toBe(false);
    expect(isOptOutText(undefined)).toBe(false);
  });
});

describe('recipientFromKey — solo chat 1:1, @lid solo con il numero vero', () => {
  test('@s.whatsapp.net → cifre (anche con suffisso :device)', () => {
    expect(recipientFromKey({ remoteJid: '393331234567@s.whatsapp.net' })).toBe('393331234567');
    expect(recipientFromKey({ remoteJid: '393331234567:12@s.whatsapp.net' })).toBe('393331234567');
  });
  test('@lid con remoteJidAlt/senderPn → numero vero; senza → null (mai indovinare)', () => {
    expect(recipientFromKey({ remoteJid: '123456789012345@lid', remoteJidAlt: '393331234567@s.whatsapp.net' })).toBe('393331234567');
    expect(recipientFromKey({ remoteJid: '123456789012345@lid', senderPn: '393331234567@s.whatsapp.net' })).toBe('393331234567');
    expect(recipientFromKey({ remoteJid: '123456789012345@lid' })).toBeNull();
  });
  test('gruppi, broadcast, newsletter, vuoto → null', () => {
    expect(recipientFromKey({ remoteJid: '120363@g.us' })).toBeNull();
    expect(recipientFromKey({ remoteJid: 'status@broadcast' })).toBeNull();
    expect(recipientFromKey({ remoteJid: '1@newsletter' })).toBeNull();
    expect(recipientFromKey({})).toBeNull();
  });
  test('inboundText legge conversation ed extendedTextMessage, non le didascalie', () => {
    expect(inboundText({ conversation: 'stop' })).toBe('stop');
    expect(inboundText({ extendedTextMessage: { text: 'basta' } })).toBe('basta');
    expect(inboundText({ imageMessage: { caption: 'x' } })).toBe('');
  });
});

describe('custody ack / suppressions', () => {
  test('sospensione al terzo rifiuto', () => {
    expect(ACK_ERRORS_TO_SUSPEND).toBe(3);
    expect(shouldSuspend(2)).toBe(false);
    expect(shouldSuspend(3)).toBe(true);
  });
  test('motivi leggibili', () => {
    expect(suppressionReasonText('opt_out')).toContain('stop');
    expect(suppressionReasonText('ack_error')).toContain('rifiutato');
    expect(suppressionReasonText('altro')).toContain('sospeso');
  });
});

describe('webhook-config', () => {
  test('MESSAGES_UPDATE sottoscritto, MESSAGING_HISTORY_SET (fuori enum v2) no', () => {
    expect(WEBHOOK_EVENTS).toContain('MESSAGES_UPDATE');
    expect(WEBHOOK_EVENTS).toContain('MESSAGES_UPSERT');
    expect(WEBHOOK_EVENTS).not.toContain('MESSAGING_HISTORY_SET');
  });
  test('body v2: root webhook, byEvents/base64, header segreto solo se configurato', () => {
    const prev = process.env.WEBHOOK_SECRET;
    process.env.WEBHOOK_SECRET = 's3cret';
    const b = buildWebhookSetBody();
    expect(b.webhook.events).toBe(WEBHOOK_EVENTS);
    expect(b.webhook.byEvents).toBe(false);
    expect((b.webhook.headers as any)['x-webhook-secret']).toBe('s3cret');
    delete process.env.WEBHOOK_SECRET;
    expect((buildWebhookSetBody().webhook as any).headers).toBeUndefined();
    if (prev !== undefined) process.env.WEBHOOK_SECRET = prev;
  });
  test('self-heal: una POST per istanza aperta, i fallimenti non bloccano le altre', async () => {
    process.env.EVOLUTION_API_URL = 'https://evo.test';
    process.env.EVOLUTION_API_KEY = 'k';
    delete process.env.WEBHOOK_SELFHEAL_DISABLED;
    const supabase = { from: () => ({ select: () => ({ eq: async () => ({ data: [{ instance_name: 'A' }, { instance_name: 'B' }, { instance_name: 'C' }], error: null }) }) }) };
    const calls: string[] = [];
    const fetchMock = (async (url: string) => { calls.push(url); return { ok: !url.endsWith('/B'), status: url.endsWith('/B') ? 400 : 200 } as any; }) as any;
    const r = await refreshWebhooksForOpenInstances(supabase as any, fetchMock);
    expect(calls).toEqual(['https://evo.test/webhook/set/A', 'https://evo.test/webhook/set/B', 'https://evo.test/webhook/set/C']);
    expect(r).toEqual({ ok: 2, failed: 1, skipped: false });
  });
  test('self-heal spento via env → skipped', async () => {
    process.env.WEBHOOK_SELFHEAL_DISABLED = 'true';
    const r = await refreshWebhooksForOpenInstances({ from: () => { throw new Error('non deve interrogare'); } } as any);
    expect(r.skipped).toBe(true);
    delete process.env.WEBHOOK_SELFHEAL_DISABLED;
  });
});
