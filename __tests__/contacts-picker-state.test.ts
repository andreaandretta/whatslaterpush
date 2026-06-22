/**
 * #3b: ContactPicker state mapping for non-OK /api/contacts responses.
 * After #3a a non-2xx means "fresh instance, not synced yet + Evolution down" —
 * a transient syncing state with retry, NOT a hard error. 401 stays a real error.
 */
import { pickerStateForResponseStatus } from '../app/lib/contacts-picker-state';

describe('pickerStateForResponseStatus', () => {
  test('200 OK -> null (caller parses body + renders the list)', () => {
    expect(pickerStateForResponseStatus(200)).toBeNull();
  });

  test('299 upper OK boundary -> null', () => {
    expect(pickerStateForResponseStatus(299)).toBeNull();
  });

  test('401 -> hard auth error (session expired)', () => {
    expect(pickerStateForResponseStatus(401)).toEqual({ kind: 'error', reason: 'unauthorized' });
  });

  test('502 (fresh instance, cache empty + Evolution unreachable) -> syncing, NOT error', () => {
    expect(pickerStateForResponseStatus(502)).toEqual({ kind: 'syncing' });
  });

  test('504 timeout -> syncing', () => {
    expect(pickerStateForResponseStatus(504)).toEqual({ kind: 'syncing' });
  });

  test('404 (no instance) -> syncing (retry + manual fallback, never a broken picker)', () => {
    expect(pickerStateForResponseStatus(404)).toEqual({ kind: 'syncing' });
  });
});
