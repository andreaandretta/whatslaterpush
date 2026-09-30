/**
 * Testi d'errore mostrati da modali e toast: mai "Errore: <codice>", mai il
 * messaggio grezzo di Postgres; il `message` del server vince sempre.
 */
import fs from 'fs';
import path from 'path';
import { apiErrorText, GENERIC_ERROR_TEXT } from '../app/lib/api-error-text';

describe('apiErrorText', () => {
  test('server message wins (Italian by contract)', () => {
    expect(apiErrorText({ error: 'queue_full', message: 'Hai troppi messaggi in coda.' }, 429)).toBe('Hai troppi messaggi in coda.');
    expect(apiErrorText({ error: 'recipient_not_on_whatsapp', message: 'WhatsApp non conosce +39 333…' }, 400)).toBe('WhatsApp non conosce +39 333…');
  });

  test('queue_full without message uses pending/limit', () => {
    expect(apiErrorText({ error: 'queue_full', pending: 21, limit: 21 }, 429)).toBe('Hai già 21 messaggi in coda (massimo 21). Aspetta che ne venga inviato qualcuno.');
  });

  test.each([
    'invalid_media_url', 'invalid_media_type', 'no_fields_to_update', 'invalid_status',
    'recipient_not_on_whatsapp', 'recipient_is_lid', 'not_retryable_permanent', 'invalid_phone_country',
  ])('%s has its own Italian sentence', (code) => {
    const t = apiErrorText({ error: code }, 400);
    expect(t).not.toBe(GENERIC_ERROR_TEXT);
    expect(t).not.toContain(code);
    expect(t).not.toMatch(/^Errore:/);
  });

  test.each([
    'groups_disabled', 'whatsapp_disconnected', 'group_check_rate_limited', 'group_check_unavailable',
    'recipient_not_group_member', 'group_admins_only', 'group_is_community', 'placeholder_not_for_group',
    'groups_timeout', 'groups_unavailable', 'invalid_answer', 'fake_door_closed', 'save_failed',
  ])('gruppi / porta finta: %s has its own Italian sentence', (code) => {
    const t = apiErrorText({ error: code }, 400);
    expect(t).not.toBe(GENERIC_ERROR_TEXT);
    expect(t).not.toContain(code);
    expect(t).not.toMatch(/^Errore:/);
  });

  test('placeholder_not_for_group spiega perché {nome} non va nei gruppi', () => {
    expect(apiErrorText({ error: 'placeholder_not_for_group' }, 400)).toBe('Nei gruppi non si può usare {nome}: il messaggio arriva uguale a tutti. Toglilo o scrivi «Ciao a tutti».');
  });

  test('plan contacts limit keeps the beta wording (no "Aggiorna piano")', () => {
    expect(apiErrorText({ error: 'plan_contacts_limit_exceeded', plan: 'beta', limit: 350 }, 403)).toBe('Hai raggiunto il limite beta di 350 contatti attivi.');
  });

  test('an English Postgres message on a 500 never reaches the user', () => {
    const t = apiErrorText({ error: 'duplicate key value violates unique constraint "x"' }, 500);
    expect(t).not.toMatch(/duplicate|constraint/);
    expect(t).toMatch(/riprova/);
  });

  test('unknown code → generic Italian, never the code', () => {
    expect(apiErrorText({ error: 'weird_new_code' }, 400)).toBe(GENERIC_ERROR_TEXT);
    expect(apiErrorText({}, 400)).toBe(GENERIC_ERROR_TEXT);
    expect(apiErrorText(null)).toBe(GENERIC_ERROR_TEXT);
  });
});

// Ogni `error: '<codice>'` restituito da /api/messages (quello che modale e
// dashboard mostrano) deve avere una frase italiana: o nella stessa risposta
// (`message:`) o in apiErrorText. Le route upload/* passano invece da
// uploadErrorMessage (app/lib/upload-limits.ts, fuori da questo modulo).
describe('every error literal in app/api/messages/route.ts has an Italian text', () => {
  const root = path.join(__dirname, '..', 'app', 'api', 'messages');
  const files = [path.join(root, 'route.ts')];

  const literals: { file: string; code: string; hasMessage: boolean }[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /NextResponse\.json\(\s*\{([\s\S]*?)\}\s*,\s*\{\s*status/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const obj = m[1];
      const code = /\berror:\s*'([^']+)'/.exec(obj)?.[1];
      if (!code) continue;
      literals.push({ file: path.relative(root, f), code, hasMessage: /\bmessage:\s*['`]/.test(obj) });
    }
  }

  test('found the error literals', () => {
    expect(literals.length).toBeGreaterThan(10);
  });

  test('none falls through to the generic text', () => {
    const missing = literals
      .filter((l) => !l.hasMessage && apiErrorText({ error: l.code }, 400) === GENERIC_ERROR_TEXT && l.code !== 'id required')
      .map((l) => `${l.file}: ${l.code}`);
    expect(missing).toEqual([]);
  });
});
