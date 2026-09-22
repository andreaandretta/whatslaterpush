/**
 * Evolution API v2 emits messages.update with the status as a STRING
 * ("DELIVERY_ACK", "READ", …) and the id in `keyId`; raw Baileys uses a NUMBER
 * inside `update.status` with the id in `key.id`. The webhook must understand
 * both, otherwise every delivery receipt is silently dropped (21 set 2026:
 * first real message after MESSAGES_UPDATE was subscribed → delivered_at NULL).
 */
import { parseMessageStatus, extractStatusUpdate } from '../app/lib/message-status';

describe('parseMessageStatus', () => {
  test.each([
    [0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5],
    ['ERROR', 0], ['PENDING', 1], ['SERVER_ACK', 2], ['DELIVERY_ACK', 3], ['READ', 4], ['PLAYED', 5],
    ['delivery_ack', 3], [' read ', 4], ['3', 3],
  ])('%p → %p', (raw, expected) => {
    expect(parseMessageStatus(raw)).toBe(expected);
  });

  test.each([undefined, null, '', 'DELETED', 'whatever', 9, -1, 2.5, {}, []])('%p → null', (raw) => {
    expect(parseMessageStatus(raw)).toBeNull();
  });
});

describe('extractStatusUpdate', () => {
  test('Evolution v2 shape: keyId + string status', () => {
    expect(extractStatusUpdate({ keyId: 'EVO_1', status: 'DELIVERY_ACK', remoteJid: 'x@s.whatsapp.net', fromMe: true }))
      .toEqual({ msgId: 'EVO_1', status: 3, fromMe: true });
  });

  test('raw Baileys shape: key.id + update.status number', () => {
    expect(extractStatusUpdate({ key: { id: 'EVO_2' }, update: { status: 4 } })).toEqual({ msgId: 'EVO_2', status: 4, fromMe: null });
  });

  test('update.status wins over a top-level status when both exist', () => {
    expect(extractStatusUpdate({ keyId: 'EVO_3', status: 'PENDING', update: { status: 'READ' } })).toEqual({ msgId: 'EVO_3', status: 4, fromMe: null });
  });

  test('fromMe is read from key.fromMe (Baileys) or top level (Evolution)', () => {
    expect(extractStatusUpdate({ key: { id: 'A', fromMe: false }, update: { status: 3 } }).fromMe).toBe(false);
    expect(extractStatusUpdate({ keyId: 'B', fromMe: false, status: 'READ' }).fromMe).toBe(false);
  });

  test('missing id or unknown status → nulls, never throws', () => {
    expect(extractStatusUpdate({ status: 'READ' })).toEqual({ msgId: null, status: 4, fromMe: null });
    expect(extractStatusUpdate({ keyId: 'EVO_4', status: 'DELETED' })).toEqual({ msgId: 'EVO_4', status: null, fromMe: null });
    expect(extractStatusUpdate(null)).toEqual({ msgId: null, status: null, fromMe: null });
  });
});
