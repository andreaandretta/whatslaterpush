/**
 * TDD — Task 58 (tier pairing-resilience): classificazione errori di /api/auth/init
 * per la UI di /connect.
 *
 * Lezione dell'incidente 17-19 ago: ogni fallimento era un alert() generico e
 * l'utente ri-cliccava subito — e ogni retry allungava il rate-limit Meta sul
 * SUO numero (7 tentativi bruciati in pochi minuti). La UI deve distinguere:
 * rate-limit (aspetta, con countdown reale da Retry-After), problema nostro
 * (non sei tu, siamo avvisati), generico (riprova).
 */
import { classifyInitError } from '../app/lib/connect-errors';

describe('classifyInitError', () => {
  test('429 → rate_limited con cooldown dal Retry-After', () => {
    const e = classifyInitError(429, { error: 'rate_limited' }, '600');
    expect(e.kind).toBe('rate_limited');
    expect(e.cooldownSec).toBe(600);
    expect(e.message).toMatch(/aspetta|attendi/i);
  });

  test('429 senza Retry-After → cooldown di default 600s', () => {
    const e = classifyInitError(429, {}, null);
    expect(e.kind).toBe('rate_limited');
    expect(e.cooldownSec).toBe(600);
  });

  test('503 (teardown fallito) → "problema nostro", cooldown breve, copy che scagiona l\'utente', () => {
    const e = classifyInitError(503, { error: 'Il numero risulta ancora agganciato…' }, null);
    expect(e.kind).toBe('ours');
    expect(e.cooldownSec).toBe(60);
    expect(e.message).toMatch(/non sei tu/i);
  });

  test('500 (create rigettata) → "problema nostro"', () => {
    const e = classifyInitError(500, { error: 'Errore creazione istanza Evolution API' }, null);
    expect(e.kind).toBe('ours');
  });

  test('400 → generico, passa il messaggio del server', () => {
    const e = classifyInitError(400, { error: 'Inserisci numero completo con prefisso internazionale' }, null);
    expect(e.kind).toBe('generic');
    expect(e.message).toContain('prefisso internazionale');
    expect(e.cooldownSec).toBeLessThanOrEqual(15);
  });

  test('Retry-After assurdo viene cappato (mai countdown oltre 10 min)', () => {
    const e = classifyInitError(429, {}, '86400');
    expect(e.cooldownSec).toBeLessThanOrEqual(600);
  });
});
