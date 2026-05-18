# WhatsApp-native ScheduleModal redesign

**Date:** 2026-05-18
**Status:** Approved, ready for implementation plan

## Goal

Replace the current `ScheduleModal` with a WhatsApp-native UI inspired by the "Programma una chiamata" screen. The new modal keeps the existing API contract (`POST /api/messages`) and introduces three new UI-only fields (description, reminder, approval toggle) that are visual placeholders for future work.

## Non-goals

- Backend changes: the API and DB schema stay untouched. New UI fields (`description`, `reminder`, `approval`) are state-only, not persisted, not sent.
- Multi-recipient or template scheduling.
- Drag interaction on the analog clock (snap-to-5min only for v1).
- Animations beyond the existing Tailwind `animate-slide-up` keyframe.

## User-facing changes

Replaces light-themed modal with dark WhatsApp-native UI:

- Dark theme `#111B21` background, white text, green `#25D366` accents.
- Header: back arrow + title "Programma un messaggio" (no contact avatar).
- Body bold title "Messaggio per {nome}" with X close button.
- New UI-only fields: description input, approval toggle, reminder picker.
- Date + time on one row, each opening its own picker dialog.
- Calendar opens as Material-style dark overlay dialog.
- Time opens as analog clock dialog (24h, hour→minute auto-advance, OK confirm).
- Reminder opens as bottom sheet with 5 radio options (tap selects + closes).
- Message textarea preserves current `maxLength` and counter.
- Round green FAB send button bottom-right (instead of full-width "Schedula").
- Existing presets ("Tra 1h" / "Stasera 18:00" / "Domani 9:00") removed.

## Responsive behaviour

- **Mobile (`<sm`):** full-screen.
- **Desktop (`≥sm`):** centered card `max-w-sm h-[700px] rounded-3xl shadow-2xl`, "iPhone frame" feel; FAB anchored to card bottom-right.

## Architecture

```
components/
├── ScheduleModal.tsx                (orchestrator — props, state, submit, ~250 LOC)
└── schedule/
    ├── DarkCalendarDialog.tsx       (~150 LOC)
    ├── AnalogClockDialog.tsx        (~200 LOC)
    ├── ReminderBottomSheet.tsx      (~80 LOC)
    └── SendFab.tsx                  (~30 LOC)
```

`ScheduleModal` keeps the same props (`open`, `onClose`, `onBack`, `contact`, `onScheduled`) so its single call site (`app/dashboard/page.tsx:337`) is unchanged.

### Sub-component contracts

**DarkCalendarDialog**
```ts
{ open: boolean; onClose: () => void;
  value: Date; minDate?: Date;
  onConfirm: (d: Date) => void }
```
Overlay `bg-black/70`, card `bg-[#1F2C33] rounded-3xl`. Month navigation (chevrons). 7-column grid (Mon-first, Italian locale). Past days disabled. Footer buttons `Annulla` / `OK`. Reuses `date-fns` (already installed).

**AnalogClockDialog**
```ts
{ open: boolean; onClose: () => void;
  value: string;  // "HH:MM"
  onConfirm: (s: string) => void }
```
24-hour format. Internal state: `phase: 'hour' | 'minute'`, `hour: number`, `minute: number`.
- Tracker top: `HH : MM`, the active half is highlighted in `text-primary`.
- SVG clock (radius ~120px):
  - `phase === 'hour'`: outer ring 0-11, inner ring 12-23 (24 clickable nodes).
  - `phase === 'minute'`: single ring 00, 05, 10, …, 55 (12 nodes).
- Clicking a number: snap, set state, advance phase from `hour` to `minute` automatically. Minute clicks update only.
- Hand animated with `transition: transform 0.2s`.
- Footer buttons `Annulla` / `OK`. `OK` emits `"HH:MM"`.

**ReminderBottomSheet**
```ts
type ReminderValue = 'never' | '15min' | '30min' | '1h' | '1day';
{ open: boolean; onClose: () => void;
  value: ReminderValue;
  onChange: (v: ReminderValue) => void }
```
Slide-up panel anchored to bottom of viewport (mobile) or card (desktop). Backdrop `bg-black/50`. 5 rows with custom radio (empty circle → filled green when selected). Tap a row = `onChange(v)` then `onClose()`. No explicit confirm button (WhatsApp style).

**SendFab**
```ts
{ disabled: boolean; loading: boolean; onClick: () => void }
```
56×56 round, `bg-primary`, `Send` lucide icon, spinner overlay when `loading`. `aria-label="Invia"`.

### Orchestrator state

```ts
// data
selectedDate: Date            // default: today
selectedTime: string          // "HH:MM", default: next rounded hour
description: string           // UI-only, default: ""
message: string               // default: ""
reminder: ReminderValue       // UI-only, default: 'never'
approval: boolean             // UI-only, default: false

// network
submitting: boolean
error: string | null

// UI
calendarOpen: boolean
clockOpen: boolean
reminderSheetOpen: boolean
```

All state resets when `open` transitions `false → true` (mirrors current behaviour).

### Default time computation

```ts
function defaultDateTime(): { date: Date; time: string } {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);  // next rounded hour
  return { date: d, time: `${String(d.getHours()).padStart(2,'0')}:00` };
}
```
At 23:30 → returns tomorrow 00:00 automatically because `setHours` rolls the date.

### Submit

```ts
POST /api/messages
{
  recipient_number: contact.number,
  recipient_name: contact.name || undefined,
  message: message.trim(),
  scheduled_at: combineDateTime(selectedDate, selectedTime).toISOString(),
}
```

Validation rules unchanged:
- `scheduledDate >= Date.now() + 60_000`
- `message.trim().length > 0 && message.length <= 3500`
- FAB disabled when invalid or `submitting`.

Error mapping reuses the current `translateError(code)` function (kept inline in `ScheduleModal.tsx`).

## Theme tokens (Tailwind)

Reuse existing tokens — no `tailwind.config.ts` change needed:
- Background: `bg-text-primary` (already maps to `#111B21`)
- Accent / FAB / selected day / radio: `bg-primary` (already `#25D366`)
- Surface cards (textarea, dialogs, bottom sheet): `bg-[#1F2C33]` and `bg-[#202C33]` (one-off hex, not added to theme — only used in this feature).
- Separators: `border-[#2A3942]` (one-off).
- Secondary text: `text-gray-400`, placeholders `text-gray-500`.

## Accessibility

- `role="dialog" aria-modal="true"` on main modal and every sub-dialog/sheet.
- ESC closes the top-most open layer (sub-dialog if any, otherwise the modal).
- All icon-only buttons carry `aria-label` (`Indietro`, `Chiudi`, `Apri calendario`, `Apri orologio`, `Apri promemoria`, `Invia`).
- On open, focus moves to the first interactive control (description input).
- Simple focus trap inside the active layer (return focus to opener on close).

## Cleanup

- Delete `components/MiniCalendar.tsx` (orphaned after this change — only consumer is the old modal).
- Delete `__tests__/mini-calendar.test.tsx`.

## Test updates

- `__tests__/e2e/contact-picker.spec.ts` lines 121-123 must change:
  - Replace `getByRole('button', { name: /Domani 9:00/i }).click()` with: open clock dialog and pick a valid future time (or accept the default and only set message), since presets are gone.
  - `getByPlaceholder(/Scrivi il messaggio/i)` selector continues to work (placeholder text preserved).
  - Replace `getByRole('button', { name: /^Schedula$/i }).click()` with `getByRole('button', { name: /Invia/i }).click()` (FAB has `aria-label="Invia"`).

Recommended new unit tests (nice-to-have, not blocking):
- `DarkCalendarDialog`: renders selected month, disables past days, emits picked date on OK.
- `AnalogClockDialog`: clicking an hour advances phase to minute; OK emits "HH:MM".
- `ReminderBottomSheet`: clicking a row emits value and closes.

## Risks and trade-offs

- **Analog clock complexity.** SVG with two concentric rings (24h) is the largest new piece. Mitigation: keep snap-to-multiple-of-5 for minutes (no drag); keep two phases discrete; reuse the same number-positioning math for both rings (different radii). If it turns out fragile, fall back to a 24-h scrollable list — but not as v1 default.
- **UI-only fields suggest broken UX later.** A user could toggle `approval = on` expecting it to do something. Mitigation acceptable for v1 (user accepted this in brainstorming); follow-up work will wire them up.
- **One-off hex colors** (`#1F2C33`, `#202C33`, `#2A3942`) are not added to Tailwind theme to keep the diff small. If they spread to other features later, promote to tokens.

## Out of scope (deferred)

- Wiring `description`, `reminder`, `approval` to backend.
- Drag interaction on analog clock.
- Re-introducing quick presets (decided to evaluate later).
- Reminder notifications delivery pipeline.
- Self-approval flow (sends confirmation message before delivery).
