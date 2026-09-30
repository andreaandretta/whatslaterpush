/**
 * Corsia lenta e gruppi (D9): il primo invio a un gruppo conta come UN
 * destinatario nuovo. Nessun codice dedicato: isKnownRecipient dà vero solo
 * dopo un invio 'sent' verso quel JID, e i JID di gruppo non stanno in rubrica.
 */
import { isKnownRecipient } from '../app/lib/first-contact';
import { createMockSupabase } from './helpers/mocks';

const OWNER = '393331234567';
const GROUP = '120363000000000001@g.us';

describe('isKnownRecipient — gruppi', () => {
  test('gruppo mai scritto → nuovo (entra nella corsia lenta)', async () => {
    const supa = createMockSupabase();
    supa.setResponse('scheduled_messages:select', null, null, { count: 0 });
    supa.setResponse('whatsapp_contacts:select', null, null, { count: 0 });
    expect(await isKnownRecipient(supa.client as any, OWNER, GROUP)).toBe(false);
    const q = supa.calls.find((c) => c.table === 'scheduled_messages')!;
    expect(q.chain).toEqual(expect.arrayContaining([
      { method: 'eq', args: ['recipient_number', GROUP] },
      { method: 'eq', args: ['status', 'sent'] },
    ]));
  });

  test('gruppo con un invio "sent" precedente → conosciuto', async () => {
    const supa = createMockSupabase();
    supa.setResponse('scheduled_messages:select', null, null, { count: 1 });
    expect(await isKnownRecipient(supa.client as any, OWNER, GROUP)).toBe(true);
    expect(supa.calls.some((c) => c.table === 'whatsapp_contacts')).toBe(false);
  });
});
