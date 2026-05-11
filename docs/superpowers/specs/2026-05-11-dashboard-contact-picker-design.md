# Dashboard Contact Picker & Direct Scheduling — Design

**Date**: 2026-05-11
**Status**: Approved, ready for implementation plan
**Author**: Andrea Andretta (with Claude)

## Problem

Today the only way to schedule a follow-up from the WhatsLater dashboard is via `QuickCaptureModal`, which composes a `wa.me` URL that opens the user's WhatsApp self-chat. The user must then send the message manually; the webhook AI parses it and creates the row in `scheduled_messages`. This flow has friction:

- Requires switching context to WhatsApp
- Requires typing the recipient phone number from memory or another source
- Depends on AI parsing, which can fail or ask for confirmations
- No browsing of the existing WhatsApp contact list

We want a direct in-dashboard scheduling flow that picks a contact from the WhatsApp address book (via Evolution API) and inserts the scheduled message directly into the database.

## Goal

Add a **second** primary action to the dashboard — "Nuovo contatto" — that opens a WhatsApp-style contact picker and a visual scheduling modal, inserting `scheduled_messages` directly with `status='pending'`. The existing `QuickCaptureModal` (`wa.me` flow) stays in place as a fallback during the verification period.

## Non-Goals

- Removing `QuickCaptureModal` — kept as fallback; removal in a follow-up PR after real-user verification
- Editing scheduled messages from the dashboard (cancel-only stays in v1)
- Multi-recipient scheduling
- Recurring schedules
- Media attachments
- Schema changes to `scheduled_messages`

## High-level architecture

```
Dashboard
 ├── ConnectedCard (unchanged)
 ├── Action row
 │     ├── [👤+ Nuovo contatto]  ← NEW, primary green
 │     │     └─ ContactPickerModal
 │     │           └─ ScheduleModal (after selection)
 │     │                 └─ POST /api/messages
 │     │
 │     └── [+ Nuovo follow-up]   ← legacy, secondary/outline
 │           └─ QuickCaptureModal (unchanged)
 │
 ├── PlanBadge (unchanged)
 ├── MessagesSection (renamed "Messaggi programmati", rewritten WhatsApp-style)
 ├── HowToUseBox / Help FAB (unchanged)
 └── PricingSection (unchanged)
```

## New files

| File | Responsibility |
|---|---|
| `components/ContactPickerModal.tsx` | WhatsApp-style picker with search, manual entry, contact list |
| `components/ScheduleModal.tsx` | Visual calendar + time + message + Schedula button |
| `components/MiniCalendar.tsx` | Custom month grid (date-fns), reusable |
| `components/ContactAvatar.tsx` | Initials avatar with deterministic background color |
| `lib/phone.ts` | `normalizeClientPhone()` shared client+server |
| `app/api/contacts/route.ts` | `GET` proxy to Evolution `findContacts` |

## Modified files

| File | Changes |
|---|---|
| `app/dashboard/page.tsx` | Add "Nuovo contatto" button + state for picker + selected contact; rename "Promemoria" → "Messaggi programmati"; rewrite `MessagesSection` row layout |
| `app/api/messages/route.ts` | Add `POST` handler (validation, plan limits, insert `pending`) |
| `lib/evolution/client.ts` | Add `findContacts(instanceName)` method |
| `components/QuickCaptureModal.tsx` | Import `normalizeClientPhone` from `lib/phone.ts` (deduplicate) |

## Components

### `ContactPickerModal`

**Props**
```ts
{
  open: boolean
  onClose: () => void
  onSelect: (contact: { number: string; name?: string }) => void
}
```

**Internal state**
```ts
type PickerState =
  | { kind: 'loading' }
  | { kind: 'list'; contacts: Contact[] }
  | { kind: 'error'; reason: 'timeout' | 'unavailable' | 'unauthorized' }

interface Contact {
  number: string     // normalized digits (no @s.whatsapp.net)
  name: string       // displayName (preferred) or pushName fallback
  pushName?: string  // WhatsApp profile name (may differ from address-book name)
}
```

**Layout**
- Full-screen on mobile (`< sm`), centered modal `max-w-md` on desktop
- Sticky header: title "Nuovi messaggi" + close (✕)
- Sticky search input below header (`<input>` filters list client-side, case-insensitive, matches name and number)
- Section 1: **"Nuovo contatto"** — collapsed by default
  - Tap row to expand → shows inputs (Nome optional, Numero required) + "Continua" button
  - Auto-expanded when picker enters `error` state, or when contact list is empty
- Section 2: **"Contatti su WhatsApp"** with count badge
  - Each row: `ContactAvatar` + name (bold) + number (muted, below)
  - Tap row → calls `onSelect(contact)` → parent closes picker and opens ScheduleModal

**Behavior**
- On `open=true`, fires `GET /api/contacts`
- 8s abort timeout (consistent with Evolution timeout convention)
- Filter applied client-side as user types in search
- Manual entry validates via `normalizeClientPhone`; rejects empty/invalid; on Continua calls `onSelect({number, name})`

### `ScheduleModal`

**Props**
```ts
{
  open: boolean
  onClose: () => void
  onBack: () => void    // returns user to ContactPickerModal
  contact: { number: string; name?: string }
  onScheduled: () => void  // parent refreshes messages list
}
```

**Internal state**
```ts
{
  selectedDate: Date         // default: today
  selectedTime: string       // "HH:mm", default: now + 1h rounded
  message: string
  submitting: boolean
  error: string | null
}
```

**Layout (top to bottom)**
1. Header: back arrow + `ContactAvatar` + contact name + close ✕
2. `MiniCalendar` — month grid, selectable days, today highlighted, past days disabled
3. Time row:
   - `<input type="time">` (custom)
   - 3 chip presets: "Tra 1h", "Stasera 18:00", "Domani 9:00"
4. Combined preview line: "Lunedì 12 maggio · 15:00" (formatted with `date-fns/locale/it`)
5. Message `<textarea>` with char counter (max 3500)
6. Sticky bottom: **"Schedula"** primary button — disabled until valid

**Validation (client-side)**
- `selectedDate + selectedTime` must be >= `now + 60s`
- `message.trim().length` in `[1, 3500]`
- On Schedula click → `POST /api/messages`
- On 200 → `onScheduled()` + close
- On 403 plan_limit → inline red banner with link to `#prezzi`
- On other errors → inline red banner with message

### `MiniCalendar`

**Props**
```ts
{
  selectedDate: Date
  onChange: (d: Date) => void
  minDate?: Date  // default: startOfToday()
}
```

**Behavior**
- Renders current month of `selectedDate`
- Header: month name + year + ◀ ▶ navigation arrows
- 7-column grid (Mon–Sun, Italian locale)
- Today: outline ring
- Selected: filled green circle
- Days `< minDate`: muted, non-clickable
- Built with `date-fns`: `startOfMonth`, `endOfMonth`, `eachDayOfInterval`, `getDay`, `isSameDay`, `isBefore`
- No external library

### `ContactAvatar`

**Props**
```ts
{
  name?: string
  number: string
  size?: 'sm' | 'md' | 'lg'  // default: 'md' (40px)
}
```

**Behavior**
- Initials: first letter of first two words of `name`, uppercase (max 2 chars). If `name` empty/missing, use last 2 digits of `number`
- Background: deterministic from `hash(number) % palette.length`, palette of 8 muted colors
- White text, bold, centered
- Used in: `ContactPickerModal` list rows, `ScheduleModal` header, `MessagesSection` rows

### `MessagesSection` (rewritten)

Section heading: **"Messaggi programmati"** (was "Promemoria")

Row layout:
```
┌────────────────────────────────────────────────────────┐
│ [MR]  Mario Rossi                       gio 14 mag      │
│       Ricordati l'incontro di…         15:00 ● Programm │
└────────────────────────────────────────────────────────┘
```

- Avatar: `ContactAvatar` size `md` (40px) on left
- Center: nome bold (truncate), preview parsed_message (truncate 50 char)
- Right column, top: data formatted by `formatScheduledDate(scheduled_at)` — "oggi", "domani", "gio 14 mag", "14/05"
- Right column, bottom: orario `HH:mm` + status dot + status label
- Trash icon: visible only when status `pending` or `awaiting_*`

`formatScheduledDate` is a small refactor of the existing `formatCountdown` — returns `{ date: string, time: string, urgent: boolean }` instead of a single string.

## API contracts

### `POST /api/messages` (new)

**Request body**
```ts
{
  recipient_number: string  // expected normalized; server normalizes again defensively
  recipient_name?: string   // optional; max 100 char
  message: string           // 1..3500 chars
  scheduled_at: string      // ISO datetime
}
```

**Responses**
| Status | Body | Condition |
|---|---|---|
| 200 | `{ id, scheduled_at, status: 'pending' }` | Inserted successfully |
| 400 | `{ error: 'invalid_phone' }` | normalizeClientPhone returns null, or number is a group/broadcast |
| 400 | `{ error: 'invalid_message' }` | empty or >3500 chars |
| 400 | `{ error: 'invalid_datetime' }` | not ISO, or `< now + 60s` |
| 400 | `{ error: 'self_target' }` | `recipient_number === instance_phone` |
| 401 | `{ error: 'Unauthorized' }` | No/invalid session cookie |
| 403 | `{ error: 'plan_contacts_limit_exceeded', plan, limit }` | New recipient would exceed `maxContacts` for plan |
| 500 | `{ error: string }` | Unexpected DB error |

**Server-side processing**
1. Verify session cookie → `phone`
2. Look up `user_instances` row for `phone` → get `id`, `subscription_plan`, `connection_status`
3. Normalize `recipient_number` defensively (`normalizeClientPhone`)
4. Reject if recipient ends in `@g.us`, `@broadcast`, or equals `phone`
5. Plan-limit check (only `maxContacts`, mirroring the existing webhook convention; `dailyLimit` stays enforced at cron-send time, not at scheduling time):
   - Compute distinct `recipient_number` set across `pending_contacts` and `scheduled_messages` (where `status != 'cancelled'`) for this user
   - If the incoming `recipient_number` is **not** already in that set AND `set.size >= maxContacts`, return 403 `plan_contacts_limit_exceeded`
6. Insert row:
   ```ts
   {
     user_instance_id: user.id,
     instance_phone: phone,
     recipient_number: normalizedNumber,
     recipient_name: recipient_name?.trim() || null,
     caption: message,           // for compat with existing schema; same as message
     parsed_message: message,    // cron reads this
     scheduled_at: new Date(scheduled_at).toISOString(),
     status: 'pending',
     retry_count: 0,
     max_retries: 3,
     wa_message_id: null         // not from WhatsApp; dashboard-originated
   }
   ```
7. Return 200 with `id` and `scheduled_at`
8. The existing cron picks up `pending` rows and dispatches via Evolution — no changes needed there

### `GET /api/contacts` (new)

**Response 200**
```ts
{
  contacts: Array<{
    number: string    // normalized digits only
    name: string      // resolved display name
    pushName?: string // optional WhatsApp profile name
  }>
}
```

**Other responses**
| Status | Body | Condition |
|---|---|---|
| 401 | `{ error: 'Unauthorized' }` | No/invalid session |
| 502 | `{ error: 'evolution_unavailable' }` | Non-2xx from Evolution |
| 504 | `{ error: 'evolution_timeout' }` | 8s abort fired |

**Server-side processing**
1. Verify session cookie → `phone`
2. Look up `instance_name` from `user_instances`
3. Call `evolutionClient.findContacts(instanceName)` with `AbortSignal.timeout(8000)`
4. Filter response:
   - Drop entries where `remoteJid` ends in `@g.us` (groups)
   - Drop entries where `remoteJid` includes `@broadcast`
   - Drop entries with no valid phone after `normalizeClientPhone`
   - Drop entries matching the user's own `phone` (self)
5. Map to `{ number, name, pushName }`:
   - `number`: digits extracted from `remoteJid` (before `@`)
   - `name`: prefer Evolution's `name` field; fall back to `pushName`; fall back to `+{number}`
6. Sort alphabetically by `name`
7. Return JSON

### `evolutionClient.findContacts` (new method)

```ts
async findContacts(instanceName: string): Promise<EvolutionContact[]> {
  return this.request(`/chat/findContacts/${instanceName}`, {
    method: 'POST',
    body: JSON.stringify({ where: {} }),  // empty filter returns all
    signal: AbortSignal.timeout(8000),
  })
}
```

Note: Evolution v2 uses `POST /chat/findContacts/{instance}` despite the user's initial spec referencing GET. Verified against Evolution v2 docs.

## Data flow

```
User clicks "Nuovo contatto"
   │
   ▼
dashboard sets contactPickerOpen=true
   │
   ▼
ContactPickerModal mounts → useEffect fires GET /api/contacts
   │  (parallel: shows spinner)
   ▼
Server: verify cookie → lookup instance → call Evolution → filter → return JSON
   │
   ▼
ContactPickerModal renders list (or error state with manual entry expanded)
   │
   │   user types in search → client-side filter
   │
   ▼
User selects contact (from list or manual entry)
   │
   ▼
dashboard sets selectedContact={number, name}, contactPickerOpen=false, scheduleOpen=true
   │
   ▼
ScheduleModal opens with contact in header
   │
   │   user picks date → time → message
   │
   ▼
User clicks "Schedula"
   │
   ▼
POST /api/messages
   │
   ▼
Server: validate → plan check → insert pending row
   │
   ▼
Response 200 → dashboard.onScheduled() → fetchMessages() → list refreshed
   │
   ▼
Cron (existing, unchanged) picks up pending row at scheduled_at
   │
   ▼
Evolution sends message to recipient
```

## Error handling

| Scenario | Behavior |
|---|---|
| Evolution timeout (8s) | `ContactPickerModal` error state: red banner "Impossibile caricare i contatti", manual entry section auto-expanded |
| Evolution non-2xx | Same error state |
| Empty contacts list | Empty state: "Nessun contatto trovato in rubrica", manual entry auto-expanded |
| `plan_contacts_limit_exceeded` on POST | `ScheduleModal` shows red banner "Hai raggiunto il limite di {limit} contatti del piano {plan}" + link to `#prezzi`; Schedula button re-enabled |
| Past/too-near datetime | Inline validation, "Schedula" button disabled, helper text "Almeno 1 minuto nel futuro" |
| Invalid phone (manual entry) | Inline error under input on "Continua" tap |
| 401 on either route | Redirect to `/connect` (consistent with existing dashboard behavior) |
| Network error on POST | Red banner "Errore di rete, riprova"; button re-enabled |

## Testing

### Unit (Jest)

- `lib/phone.test.ts` — `normalizeClientPhone`:
  - Italian mobile without prefix: `3331234567` → `393331234567`
  - Italian mobile with prefix: `393331234567` → `393331234567`
  - International with +: `+447700900123` → `447700900123`
  - Spaces/dashes stripped: `+39 333 123 4567` → `393331234567`
  - Too short / non-numeric → `null`
- `components/MiniCalendar.test.tsx`:
  - Renders correct month
  - Past days are disabled and non-clickable
  - Selecting a day calls `onChange` with the right Date
  - Navigation arrows change displayed month
- `app/api/messages/POST.test.ts`:
  - 401 without cookie
  - 400 on group/broadcast/self number
  - 400 on past datetime
  - 403 on `maxContacts` exceeded for a new recipient
  - 200 when scheduling for an existing recipient even if user is at `maxContacts` (re-use of known contact must not be blocked)
  - 200 inserts row with correct fields

### E2E (Playwright)

- `tests/e2e/contact-picker.spec.ts`:
  - Authenticated user clicks "Nuovo contatto" → picker opens → list loads (mock `/api/contacts`)
  - Selects a contact → `ScheduleModal` opens with contact in header
  - Picks date in calendar, types time, types message → clicks Schedula → success → new row in list
  - Manual entry path: expand "Nuovo contatto" → fill nome/numero → Continua → ScheduleModal → Schedula → success
  - Search input filters the list correctly
  - Evolution error: mock 504 → picker shows error banner + manual entry expanded

## Rollout

1. Ship both buttons co-present in one PR (this design)
2. Monitor: dashboard analytics for `POST /api/messages` success rate, error logs
3. After ~1 week with no regressions, follow-up PR removes:
   - Legacy "Nuovo follow-up" button from dashboard
   - `components/QuickCaptureModal.tsx`
   - `useState` for `quickCaptureOpen`
4. No DB schema migration is required at any stage

## Acceptance criteria

- [ ] Dashboard shows two buttons: "Nuovo contatto" (primary) and "Nuovo follow-up" (secondary)
- [ ] "Nuovo contatto" opens `ContactPickerModal` that fetches contacts from Evolution within 8s
- [ ] Search bar filters the contact list client-side
- [ ] "Nuovo contatto" manual entry section is collapsed by default, auto-expanded on error/empty
- [ ] Manual entry validates phone with `normalizeClientPhone`
- [ ] Selecting (or manually entering) a contact opens `ScheduleModal`
- [ ] `MiniCalendar` allows selecting a future date; past dates disabled
- [ ] Time can be picked via `<input type="time">` or chip presets
- [ ] "Schedula" button calls `POST /api/messages` and inserts a `pending` row
- [ ] `maxContacts` enforced server-side on new recipients only; UI shows banner on 403
- [ ] Existing recipients can be re-scheduled even at the `maxContacts` cap
- [ ] Self-target, groups, broadcasts blocked server-side
- [ ] `MessagesSection` renamed to "Messaggi programmati" with new WhatsApp-style row layout
- [ ] `ContactAvatar` shows deterministic-colored initials
- [ ] `QuickCaptureModal` still works (fallback)
- [ ] All existing 88 tests still pass; new unit + e2e tests added
