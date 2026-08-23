/**
 * Sync del pairing code (incidente "terno al lotto" 23 ago): il webhook
 * QRCODE_UPDATED deve aggiornare il codice sulle pending session attive,
 * l'estrazione deve accettare solo codici Baileys validi, e lo stato di
 * connessione deve propagarsi solo per valori noti.
 */
import { extractPairingCode, syncPairingCode, syncConnState } from '@/app/lib/pairing-code-sync';

function chainMock() {
  const calls: Record<string, unknown> = {};
  const chain: any = {
    update: jest.fn((v: unknown) => { calls.update = v; return chain; }),
    eq: jest.fn((k: string, v: unknown) => { calls[`eq:${k}`] = v; return chain; }),
    gt: jest.fn((k: string, v: unknown) => { calls[`gt:${k}`] = v; return Promise.resolve({ error: null }); }),
  };
  const supabase: any = { from: jest.fn(() => chain) };
  return { supabase, chain, calls };
}

describe('extractPairingCode', () => {
  it('estrae dalle forme note del payload QRCODE_UPDATED', () => {
    expect(extractPairingCode({ data: { qrcode: { pairingCode: 'ABCD-1234' } } })).toBe('ABCD-1234');
    expect(extractPairingCode({ data: { pairingCode: 'abcd1234' } })).toBe('ABCD-1234');
    expect(extractPairingCode({ qrcode: { pairingCode: 'WXYZ-9876' } })).toBe('WXYZ-9876');
  });

  it('normalizza: maiuscole + trattino', () => {
    expect(extractPairingCode({ data: { pairingCode: 'ab12cd34' } })).toBe('AB12-CD34');
  });

  it('rifiuta payload senza codice o con formati invalidi', () => {
    expect(extractPairingCode({})).toBeNull();
    expect(extractPairingCode(null)).toBeNull();
    expect(extractPairingCode({ data: { pairingCode: 'too-long-code-123' } })).toBeNull();
    expect(extractPairingCode({ data: { pairingCode: 'AB!2-CD34' } })).toBeNull();
    expect(extractPairingCode({ data: { pairingCode: 123 } })).toBeNull();
    // il base64 del QR non deve MAI passare per un pairing code (bug storico)
    expect(extractPairingCode({ data: { qrcode: { base64: 'data:image/png;aaaa' } } })).toBeNull();
  });
});

describe('syncPairingCode', () => {
  it('aggiorna solo le pending session ATTIVE della stessa istanza', async () => {
    const { supabase, calls } = chainMock();
    await syncPairingCode(supabase, 'SchedWhats-393331112222', 'ABCD-1234');
    expect(supabase.from).toHaveBeenCalledWith('pending_auth_sessions');
    expect((calls.update as any).pairing_code).toBe('ABCD-1234');
    expect((calls.update as any).pairing_code_updated_at).toBeTruthy();
    expect(calls['eq:instance_name']).toBe('SchedWhats-393331112222');
    expect(calls['eq:status']).toBe('pending');
    expect(calls['gt:expires_at']).toBeTruthy();
  });

  it('no-op senza istanza o codice', async () => {
    const { supabase } = chainMock();
    await syncPairingCode(supabase, '', 'ABCD-1234');
    await syncPairingCode(supabase, 'X', '');
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe('syncConnState', () => {
  it('propaga solo stati noti', async () => {
    const { supabase, calls } = chainMock();
    await syncConnState(supabase, 'SchedWhats-X', 'connecting');
    expect((calls.update as any).conn_state).toBe('connecting');
  });

  it('ignora stati sconosciuti o mancanti', async () => {
    const { supabase } = chainMock();
    await syncConnState(supabase, 'SchedWhats-X', 'reconnecting-weird');
    await syncConnState(supabase, 'SchedWhats-X', null);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
