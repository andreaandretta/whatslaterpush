// #3b: map a non-OK GET /api/contacts response to the ContactPicker's state.
//
// After #3a the route serves the cache even when Evolution is down, so a non-2xx
// now means specifically: the instance has NOTHING cached yet AND Evolution is
// unreachable — i.e. a freshly-connected user whose address book hasn't synced.
// That should read as a transient "sto sincronizzando…" state with a Retry, NOT a
// hard "picker broken" error. 401 stays a real auth error.
//
// Returns the next picker state for a non-OK status, or null when the response is OK
// (the caller then parses the body and renders the list). Pure + UI-free so it can
// be unit-tested without React.
export type PickerErrorState =
  | { kind: 'syncing' }
  | { kind: 'error'; reason: 'unauthorized' };

export function pickerStateForResponseStatus(status: number): PickerErrorState | null {
  if (status === 401) return { kind: 'error', reason: 'unauthorized' };
  if (status < 200 || status >= 300) return { kind: 'syncing' };
  return null;
}
