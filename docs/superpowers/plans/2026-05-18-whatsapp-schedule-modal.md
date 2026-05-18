# WhatsApp-native ScheduleModal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current light-themed `ScheduleModal` with a WhatsApp-native dark modal containing description, date/time, approval, reminder, and message fields, using four new sub-components in `components/schedule/`.

**Architecture:** `ScheduleModal.tsx` becomes a thin orchestrator (props, state, submit) that opens three dialog/sheet sub-components for the pickers (calendar, analog clock, reminder bottom sheet) and renders a round FAB for submit. Backend contract unchanged: `POST /api/messages` with `recipient_number`, `recipient_name`, `message`, `scheduled_at`. The new fields `description`, `reminder`, `approval` are UI-only (state, not sent).

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, `date-fns` 3.6 + `date-fns/locale/it`, `lucide-react` icons, Jest + ts-jest + React Testing Library (`jsdom` env), Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-05-18-whatsapp-schedule-modal-design.md`

---

## File Structure

**Create:**
- `components/schedule/SendFab.tsx` — round green FAB with send icon
- `components/schedule/ReminderBottomSheet.tsx` — bottom sheet, 5 radio options
- `components/schedule/DarkCalendarDialog.tsx` — Material-style dark calendar dialog
- `components/schedule/AnalogClockDialog.tsx` — 24h analog clock dialog (SVG)
- `__tests__/send-fab.test.tsx`
- `__tests__/reminder-bottom-sheet.test.tsx`
- `__tests__/dark-calendar-dialog.test.tsx`
- `__tests__/analog-clock-dialog.test.tsx`
- `__tests__/schedule-modal.test.tsx`

**Modify:**
- `components/ScheduleModal.tsx` — full rewrite, same props
- `__tests__/e2e/contact-picker.spec.ts` — update selectors lines 121-123

**Delete:**
- `components/MiniCalendar.tsx`
- `__tests__/mini-calendar.test.tsx`

`app/dashboard/page.tsx:337` does **not** change — `ScheduleModal` keeps the same props.

---

## Conventions

- Test files use `/** @jest-environment jsdom */` first-line directive (required for component tests in this repo — see `__tests__/mini-calendar.test.tsx` for reference).
- Components use `'use client';` first line.
- Import lucide icons named (e.g. `import { Send } from 'lucide-react'`).
- Theme: bg `#111B21` (= Tailwind `bg-text-primary`), surfaces `#1F2C33`/`#202C33`, separators `#2A3942`, accent `bg-primary` (= `#25D366`).
- Strings are Italian.
- Commit per task (small, focused commits).
- After every implementation step that touches code, run `npm test` before committing — must stay green.

---

### Task 1: Scaffold `components/schedule/` + SendFab

**Files:**
- Create: `components/schedule/SendFab.tsx`
- Create: `__tests__/send-fab.test.tsx`

- [ ] **Step 1: Create the test file**

Create `__tests__/send-fab.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SendFab } from '../components/schedule/SendFab';

describe('SendFab', () => {
  test('renders with aria-label Invia', () => {
    render(<SendFab disabled={false} loading={false} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: /Invia/i })).toBeInTheDocument();
  });

  test('calls onClick when clicked', () => {
    const onClick = jest.fn();
    render(<SendFab disabled={false} loading={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('does not call onClick when disabled', () => {
    const onClick = jest.fn();
    render(<SendFab disabled={true} loading={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
    expect(onClick).not.toHaveBeenCalled();
  });

  test('does not call onClick when loading', () => {
    const onClick = jest.fn();
    render(<SendFab disabled={false} loading={true} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/send-fab.test.tsx`
Expected: FAIL with module not found error for `../components/schedule/SendFab`.

- [ ] **Step 3: Create the SendFab component**

Create `components/schedule/SendFab.tsx`:

```tsx
'use client';

import React from 'react';
import { Send, Loader2 } from 'lucide-react';

interface SendFabProps {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}

export function SendFab({ disabled, loading, onClick }: SendFabProps) {
  return (
    <button
      type="button"
      aria-label="Invia"
      onClick={onClick}
      disabled={disabled || loading}
      className="absolute bottom-4 right-4 w-14 h-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-hover transition-colors"
    >
      {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/send-fab.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add components/schedule/SendFab.tsx __tests__/send-fab.test.tsx
git commit -m "feat(schedule): add SendFab component"
```

---

### Task 2: ReminderBottomSheet

**Files:**
- Create: `components/schedule/ReminderBottomSheet.tsx`
- Create: `__tests__/reminder-bottom-sheet.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/reminder-bottom-sheet.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ReminderBottomSheet } from '../components/schedule/ReminderBottomSheet';

describe('ReminderBottomSheet', () => {
  test('renders nothing when closed', () => {
    const { container } = render(
      <ReminderBottomSheet open={false} onClose={() => {}} value="never" onChange={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders all 5 options when open', () => {
    render(<ReminderBottomSheet open={true} onClose={() => {}} value="never" onChange={() => {}} />);
    expect(screen.getByText(/15 minuti prima/i)).toBeInTheDocument();
    expect(screen.getByText(/30 minuti prima/i)).toBeInTheDocument();
    expect(screen.getByText(/1 ora prima/i)).toBeInTheDocument();
    expect(screen.getByText(/1 giorno prima/i)).toBeInTheDocument();
    expect(screen.getByText(/^Mai$/i)).toBeInTheDocument();
  });

  test('clicking a row calls onChange with the value and onClose', () => {
    const onChange = jest.fn();
    const onClose = jest.fn();
    render(<ReminderBottomSheet open={true} onClose={onClose} value="never" onChange={onChange} />);
    fireEvent.click(screen.getByText(/1 ora prima/i));
    expect(onChange).toHaveBeenCalledWith('1h');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('clicking backdrop calls onClose without changing value', () => {
    const onChange = jest.fn();
    const onClose = jest.fn();
    render(<ReminderBottomSheet open={true} onClose={onClose} value="never" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('reminder-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/reminder-bottom-sheet.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `components/schedule/ReminderBottomSheet.tsx`:

```tsx
'use client';

import React from 'react';

export type ReminderValue = 'never' | '15min' | '30min' | '1h' | '1day';

interface ReminderBottomSheetProps {
  open: boolean;
  onClose: () => void;
  value: ReminderValue;
  onChange: (v: ReminderValue) => void;
}

const OPTIONS: { value: ReminderValue; label: string }[] = [
  { value: '15min', label: '15 minuti prima' },
  { value: '30min', label: '30 minuti prima' },
  { value: '1h', label: '1 ora prima' },
  { value: '1day', label: '1 giorno prima' },
  { value: 'never', label: 'Mai' },
];

export function ReminderBottomSheet({ open, onClose, value, onChange }: ReminderBottomSheetProps) {
  if (!open) return null;

  function pick(v: ReminderValue) {
    onChange(v);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Promemoria"
    >
      <div
        data-testid="reminder-backdrop"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-sm bg-[#1F2C33] rounded-t-3xl pb-6 pt-4 px-2 animate-slide-up">
        <div className="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4" />
        {OPTIONS.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => pick(opt.value)}
              className="w-full flex items-center gap-4 px-4 py-3 hover:bg-white/5 rounded-xl text-left"
            >
              <span
                className={`w-5 h-5 rounded-full border-2 ${
                  selected ? 'border-primary bg-primary' : 'border-gray-500'
                } flex items-center justify-center`}
              >
                {selected && <span className="w-2 h-2 rounded-full bg-white" />}
              </span>
              <span className="text-white text-base">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/reminder-bottom-sheet.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add components/schedule/ReminderBottomSheet.tsx __tests__/reminder-bottom-sheet.test.tsx
git commit -m "feat(schedule): add ReminderBottomSheet component"
```

---

### Task 3: DarkCalendarDialog

**Files:**
- Create: `components/schedule/DarkCalendarDialog.tsx`
- Create: `__tests__/dark-calendar-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/dark-calendar-dialog.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DarkCalendarDialog } from '../components/schedule/DarkCalendarDialog';

describe('DarkCalendarDialog', () => {
  const may15 = new Date(2026, 4, 15);

  test('renders nothing when closed', () => {
    const { container } = render(
      <DarkCalendarDialog open={false} onClose={() => {}} value={may15} onConfirm={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders the month of the selected date in Italian when open', () => {
    render(
      <DarkCalendarDialog open={true} onClose={() => {}} value={may15} onConfirm={() => {}} />
    );
    expect(screen.getByText(/maggio 2026/i)).toBeInTheDocument();
  });

  test('past days are disabled when minDate is today', () => {
    const today = new Date(2026, 4, 11);
    render(
      <DarkCalendarDialog
        open={true}
        onClose={() => {}}
        value={today}
        minDate={today}
        onConfirm={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: /^5$/ })).toBeDisabled();
  });

  test('forward arrow advances to next month', () => {
    render(
      <DarkCalendarDialog open={true} onClose={() => {}} value={may15} onConfirm={() => {}} />
    );
    fireEvent.click(screen.getByLabelText(/mese successivo/i));
    expect(screen.getByText(/giugno 2026/i)).toBeInTheDocument();
  });

  test('clicking OK emits the picked date', () => {
    const onConfirm = jest.fn();
    render(
      <DarkCalendarDialog open={true} onClose={() => {}} value={may15} onConfirm={onConfirm} />
    );
    fireEvent.click(screen.getByRole('button', { name: /^20$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^OK$/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const picked = onConfirm.mock.calls[0][0] as Date;
    expect(picked.getFullYear()).toBe(2026);
    expect(picked.getMonth()).toBe(4);
    expect(picked.getDate()).toBe(20);
  });

  test('clicking Annulla calls onClose without confirm', () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    render(
      <DarkCalendarDialog
        open={true}
        onClose={onClose}
        value={may15}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Annulla/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/dark-calendar-dialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `components/schedule/DarkCalendarDialog.tsx`:

```tsx
'use client';

import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  startOfMonth, endOfMonth, eachDayOfInterval, getDay,
  addMonths, subMonths, format, isSameDay, isBefore, startOfDay,
} from 'date-fns';
import { it } from 'date-fns/locale';

interface DarkCalendarDialogProps {
  open: boolean;
  onClose: () => void;
  value: Date;
  minDate?: Date;
  onConfirm: (d: Date) => void;
}

export function DarkCalendarDialog({ open, onClose, value, minDate, onConfirm }: DarkCalendarDialogProps) {
  const [picked, setPicked] = useState<Date>(value);
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(value));

  useEffect(() => {
    if (open) {
      setPicked(value);
      setViewMonth(startOfMonth(value));
    }
  }, [open, value]);

  if (!open) return null;

  const min = minDate ? startOfDay(minDate) : startOfDay(new Date());
  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const firstDow = (getDay(monthStart) + 6) % 7;
  const blanks = Array.from({ length: firstDow });

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Seleziona data"
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-xs bg-[#1F2C33] rounded-3xl p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => setViewMonth(subMonths(viewMonth, 1))}
            aria-label="Mese precedente"
            className="p-2 rounded-full hover:bg-white/10 text-white"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="font-semibold text-white capitalize">
            {format(viewMonth, 'MMMM yyyy', { locale: it })}
          </div>
          <button
            type="button"
            onClick={() => setViewMonth(addMonths(viewMonth, 1))}
            aria-label="Mese successivo"
            className="p-2 rounded-full hover:bg-white/10 text-white"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-400 mb-1">
          {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d, i) => <div key={i}>{d}</div>)}
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {blanks.map((_, i) => <div key={'b' + i} />)}
          {days.map((day) => {
            const isPast = isBefore(day, min);
            const isSelected = isSameDay(day, picked);
            const isToday = isSameDay(day, new Date());

            let cls = 'w-9 h-9 rounded-full text-sm flex items-center justify-center mx-auto ';
            if (isPast) cls += 'text-gray-600 cursor-not-allowed';
            else if (isSelected) cls += 'bg-primary text-black font-semibold';
            else if (isToday) cls += 'ring-1 ring-primary text-primary font-semibold';
            else cls += 'hover:bg-white/10 text-white';

            return (
              <button
                key={day.toISOString()}
                type="button"
                disabled={isPast}
                onClick={() => setPicked(day)}
                className={cls}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full text-primary text-sm font-medium hover:bg-white/5"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={() => { onConfirm(picked); onClose(); }}
            className="px-4 py-2 rounded-full text-primary text-sm font-semibold hover:bg-white/5"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/dark-calendar-dialog.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add components/schedule/DarkCalendarDialog.tsx __tests__/dark-calendar-dialog.test.tsx
git commit -m "feat(schedule): add DarkCalendarDialog component"
```

---

### Task 4: AnalogClockDialog

**Files:**
- Create: `components/schedule/AnalogClockDialog.tsx`
- Create: `__tests__/analog-clock-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/analog-clock-dialog.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AnalogClockDialog } from '../components/schedule/AnalogClockDialog';

describe('AnalogClockDialog', () => {
  test('renders nothing when closed', () => {
    const { container } = render(
      <AnalogClockDialog open={false} onClose={() => {}} value="15:00" onConfirm={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders the current value in the tracker when open', () => {
    render(
      <AnalogClockDialog open={true} onClose={() => {}} value="15:30" onConfirm={() => {}} />
    );
    expect(screen.getByTestId('clock-hour')).toHaveTextContent('15');
    expect(screen.getByTestId('clock-minute')).toHaveTextContent('30');
  });

  test('starts in hour phase: hour tracker is active, hour nodes are clickable', () => {
    render(
      <AnalogClockDialog open={true} onClose={() => {}} value="15:00" onConfirm={() => {}} />
    );
    expect(screen.getByTestId('clock-hour')).toHaveClass('text-primary');
    // 24 hour nodes exist (0..23)
    expect(screen.getByTestId('clock-node-0')).toBeInTheDocument();
    expect(screen.getByTestId('clock-node-23')).toBeInTheDocument();
  });

  test('clicking an hour node updates the hour and advances to minute phase', () => {
    render(
      <AnalogClockDialog open={true} onClose={() => {}} value="15:00" onConfirm={() => {}} />
    );
    fireEvent.click(screen.getByTestId('clock-node-7'));
    expect(screen.getByTestId('clock-hour')).toHaveTextContent('7');
    expect(screen.getByTestId('clock-minute')).toHaveClass('text-primary');
    // minute nodes are now shown
    expect(screen.getByTestId('clock-node-0')).toBeInTheDocument(); // 00 minutes
    expect(screen.getByTestId('clock-node-55')).toBeInTheDocument();
  });

  test('clicking a minute node updates the minute (does not auto-confirm)', () => {
    const onConfirm = jest.fn();
    render(
      <AnalogClockDialog open={true} onClose={() => {}} value="15:00" onConfirm={onConfirm} />
    );
    fireEvent.click(screen.getByTestId('clock-node-7')); // advance to minute phase
    fireEvent.click(screen.getByTestId('clock-node-25'));
    expect(screen.getByTestId('clock-minute')).toHaveTextContent('25');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('OK emits HH:MM with zero padding', () => {
    const onConfirm = jest.fn();
    render(
      <AnalogClockDialog open={true} onClose={() => {}} value="15:00" onConfirm={onConfirm} />
    );
    fireEvent.click(screen.getByTestId('clock-node-7'));
    fireEvent.click(screen.getByTestId('clock-node-5'));
    fireEvent.click(screen.getByRole('button', { name: /^OK$/i }));
    expect(onConfirm).toHaveBeenCalledWith('07:05');
  });

  test('clicking hour tracker switches back to hour phase', () => {
    render(
      <AnalogClockDialog open={true} onClose={() => {}} value="15:00" onConfirm={() => {}} />
    );
    fireEvent.click(screen.getByTestId('clock-node-7')); // now in minute phase
    expect(screen.getByTestId('clock-minute')).toHaveClass('text-primary');
    fireEvent.click(screen.getByTestId('clock-hour'));
    expect(screen.getByTestId('clock-hour')).toHaveClass('text-primary');
    expect(screen.getByTestId('clock-node-0')).toBeInTheDocument(); // hour 0 visible again
    expect(screen.getByTestId('clock-node-23')).toBeInTheDocument();
  });

  test('Annulla closes without confirming', () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    render(
      <AnalogClockDialog open={true} onClose={onClose} value="15:00" onConfirm={onConfirm} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Annulla/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/analog-clock-dialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `components/schedule/AnalogClockDialog.tsx`:

```tsx
'use client';

import React, { useState, useEffect } from 'react';

interface AnalogClockDialogProps {
  open: boolean;
  onClose: () => void;
  value: string; // "HH:MM"
  onConfirm: (s: string) => void;
}

type Phase = 'hour' | 'minute';

const SVG_SIZE = 280;
const CENTER = SVG_SIZE / 2;
const OUTER_R = 110; // hours 0-11 (or minutes 0-55)
const INNER_R = 72;  // hours 12-23

function parseTime(v: string): { h: number; m: number } {
  const [h, m] = v.split(':').map(Number);
  return { h: isNaN(h) ? 0 : h, m: isNaN(m) ? 0 : m };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// Standard clock layout: 12 o'clock at top, going clockwise.
// For 12 positions (0..11): angle = (pos * 30deg) - 90deg
function positionForIndex(index: number, total: number, radius: number): { x: number; y: number } {
  const angleDeg = (index * (360 / total)) - 90;
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(angleRad),
    y: CENTER + radius * Math.sin(angleRad),
  };
}

export function AnalogClockDialog({ open, onClose, value, onConfirm }: AnalogClockDialogProps) {
  const initial = parseTime(value);
  const [hour, setHour] = useState<number>(initial.h);
  const [minute, setMinute] = useState<number>(initial.m);
  const [phase, setPhase] = useState<Phase>('hour');

  useEffect(() => {
    if (open) {
      const t = parseTime(value);
      setHour(t.h);
      setMinute(t.m);
      setPhase('hour');
    }
  }, [open, value]);

  if (!open) return null;

  function pickHour(h: number) {
    setHour(h);
    setPhase('minute');
  }
  function pickMinute(m: number) {
    setMinute(m);
  }

  // Hour nodes: 12 outer (0..11) + 12 inner (12..23). Outer index 0 = "12 o'clock" position which represents hour 0 (or 12).
  // Map: outer ring shows hours 0..11 at the 12 positions (0 at top, 1 next, ..., 11 before 12). Inner shows 12..23 at same angles.
  const hourNodes = phase === 'hour'
    ? [
        ...Array.from({ length: 12 }, (_, i) => {
          const p = positionForIndex(i, 12, OUTER_R);
          return { value: i, x: p.x, y: p.y };
        }),
        ...Array.from({ length: 12 }, (_, i) => {
          const p = positionForIndex(i, 12, INNER_R);
          return { value: i + 12, x: p.x, y: p.y };
        }),
      ]
    : [];

  // Minute nodes: 12 positions on outer ring, values 0, 5, 10, ..., 55
  const minuteNodes = phase === 'minute'
    ? Array.from({ length: 12 }, (_, i) => {
        const p = positionForIndex(i, 12, OUTER_R);
        return { value: i * 5, x: p.x, y: p.y };
      })
    : [];

  // Hand angle (where to draw the indicator line)
  const handAngle = phase === 'hour'
    ? ((hour % 12) * 30) - 90
    : (minute / 5 * 30) - 90;
  const handLength = phase === 'hour' && hour >= 12 ? INNER_R : OUTER_R;
  const handEndX = CENTER + handLength * Math.cos((handAngle * Math.PI) / 180);
  const handEndY = CENTER + handLength * Math.sin((handAngle * Math.PI) / 180);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Seleziona orario"
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-xs bg-[#1F2C33] rounded-3xl p-6 shadow-2xl">
        {/* Tracker */}
        <div className="flex items-center justify-center gap-1 text-4xl font-semibold mb-6">
          <button
            type="button"
            data-testid="clock-hour"
            onClick={() => setPhase('hour')}
            className={phase === 'hour' ? 'text-primary' : 'text-gray-300'}
          >
            {pad(hour)}
          </button>
          <span className="text-gray-300">:</span>
          <button
            type="button"
            data-testid="clock-minute"
            onClick={() => setPhase('minute')}
            className={phase === 'minute' ? 'text-primary' : 'text-gray-300'}
          >
            {pad(minute)}
          </button>
        </div>

        {/* SVG clock */}
        <svg
          width={SVG_SIZE}
          height={SVG_SIZE}
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
          className="mx-auto"
        >
          <circle cx={CENTER} cy={CENTER} r={OUTER_R + 24} fill="#2A3942" />
          {/* Hand */}
          <line
            x1={CENTER}
            y1={CENTER}
            x2={handEndX}
            y2={handEndY}
            stroke="#25D366"
            strokeWidth={2}
            style={{ transition: 'all 0.2s' }}
          />
          <circle cx={CENTER} cy={CENTER} r={4} fill="#25D366" />
          <circle cx={handEndX} cy={handEndY} r={18} fill="#25D366" opacity={0.25} />

          {/* Nodes */}
          {phase === 'hour' && hourNodes.map((n) => {
            const isSelected = n.value === hour;
            return (
              <g
                key={`h-${n.value}`}
                data-testid={`clock-node-${n.value}`}
                onClick={() => pickHour(n.value)}
                style={{ cursor: 'pointer' }}
              >
                <circle cx={n.x} cy={n.y} r={16} fill="transparent" />
                <text
                  x={n.x}
                  y={n.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={n.value >= 12 ? 12 : 14}
                  fill={isSelected ? '#000' : '#fff'}
                  fontWeight={isSelected ? 600 : 400}
                >
                  {n.value === 0 ? '00' : n.value}
                </text>
              </g>
            );
          })}
          {phase === 'minute' && minuteNodes.map((n) => {
            const isSelected = n.value === minute;
            return (
              <g
                key={`m-${n.value}`}
                data-testid={`clock-node-${n.value}`}
                onClick={() => pickMinute(n.value)}
                style={{ cursor: 'pointer' }}
              >
                <circle cx={n.x} cy={n.y} r={16} fill="transparent" />
                <text
                  x={n.x}
                  y={n.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={14}
                  fill={isSelected ? '#000' : '#fff'}
                  fontWeight={isSelected ? 600 : 400}
                >
                  {pad(n.value)}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Footer */}
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full text-primary text-sm font-medium hover:bg-white/5"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={() => { onConfirm(`${pad(hour)}:${pad(minute)}`); onClose(); }}
            className="px-4 py-2 rounded-full text-primary text-sm font-semibold hover:bg-white/5"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/analog-clock-dialog.test.tsx`
Expected: PASS, 8 tests.

If any test fails, do **not** weaken the test — fix the component. The tests document the contract.

- [ ] **Step 5: Commit**

```bash
git add components/schedule/AnalogClockDialog.tsx __tests__/analog-clock-dialog.test.tsx
git commit -m "feat(schedule): add AnalogClockDialog component"
```

---

### Task 5: Rewrite ScheduleModal

**Files:**
- Modify: `components/ScheduleModal.tsx` (full rewrite, same props)
- Create: `__tests__/schedule-modal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/schedule-modal.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ScheduleModal from '../components/ScheduleModal';

const contact = { number: '393331234567', name: 'Mario Rossi' };

describe('ScheduleModal (new WhatsApp UI)', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  test('renders nothing when closed', () => {
    const { container } = render(
      <ScheduleModal open={false} onClose={() => {}} onBack={() => {}} contact={contact} onScheduled={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders header title and body title with contact name', () => {
    render(
      <ScheduleModal open={true} onClose={() => {}} onBack={() => {}} contact={contact} onScheduled={() => {}} />
    );
    expect(screen.getByText(/Programma un messaggio/i)).toBeInTheDocument();
    expect(screen.getByText(/Messaggio per Mario Rossi/i)).toBeInTheDocument();
  });

  test('shows description, message, approval toggle, reminder row, and FAB', () => {
    render(
      <ScheduleModal open={true} onClose={() => {}} onBack={() => {}} contact={contact} onScheduled={() => {}} />
    );
    expect(screen.getByPlaceholderText(/Descrizione/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Scrivi il messaggio/i)).toBeInTheDocument();
    expect(screen.getByText(/Richiedi approvazione per l'invio/i)).toBeInTheDocument();
    expect(screen.getByText(/^Promemoria$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invia/i })).toBeInTheDocument();
  });

  test('FAB is disabled when message is empty', () => {
    render(
      <ScheduleModal open={true} onClose={() => {}} onBack={() => {}} contact={contact} onScheduled={() => {}} />
    );
    expect(screen.getByRole('button', { name: /Invia/i })).toBeDisabled();
  });

  test('FAB enabled and submits POST /api/messages when message is set', async () => {
    const onScheduled = jest.fn();
    const onClose = jest.fn();
    (global as any).fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({}),
    });

    render(
      <ScheduleModal open={true} onClose={onClose} onBack={() => {}} contact={contact} onScheduled={onScheduled} />
    );
    fireEvent.change(screen.getByPlaceholderText(/Scrivi il messaggio/i), {
      target: { value: 'Ciao' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Invia/i }));

    await waitFor(() => expect((global as any).fetch).toHaveBeenCalled());
    const [url, opts] = (global as any).fetch.mock.calls[0];
    expect(url).toBe('/api/messages');
    const body = JSON.parse(opts.body);
    expect(body.recipient_number).toBe('393331234567');
    expect(body.recipient_name).toBe('Mario Rossi');
    expect(body.message).toBe('Ciao');
    expect(typeof body.scheduled_at).toBe('string');
    // description / reminder / approval must NOT be in payload
    expect(body).not.toHaveProperty('description');
    expect(body).not.toHaveProperty('reminder');
    expect(body).not.toHaveProperty('approval');

    await waitFor(() => expect(onScheduled).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  test('back arrow calls onBack', () => {
    const onBack = jest.fn();
    render(
      <ScheduleModal open={true} onClose={() => {}} onBack={onBack} contact={contact} onScheduled={() => {}} />
    );
    fireEvent.click(screen.getByLabelText(/Indietro/i));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('X close button calls onClose', () => {
    const onClose = jest.fn();
    render(
      <ScheduleModal open={true} onClose={onClose} onBack={() => {}} contact={contact} onScheduled={() => {}} />
    );
    fireEvent.click(screen.getByLabelText(/Chiudi/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('falls back to formatted phone when name missing', () => {
    render(
      <ScheduleModal
        open={true}
        onClose={() => {}}
        onBack={() => {}}
        contact={{ number: '393331234567' }}
        onScheduled={() => {}}
      />
    );
    expect(screen.getByText(/Messaggio per \+393331234567/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/schedule-modal.test.tsx`
Expected: FAIL — most assertions miss because the current ScheduleModal has different UI text/labels.

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `components/ScheduleModal.tsx`:

```tsx
'use client';

import React, { useState, useEffect } from 'react';
import { X, ArrowLeft, Calendar as CalendarIcon, UserCheck, Bell, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { DarkCalendarDialog } from './schedule/DarkCalendarDialog';
import { AnalogClockDialog } from './schedule/AnalogClockDialog';
import { ReminderBottomSheet, ReminderValue } from './schedule/ReminderBottomSheet';
import { SendFab } from './schedule/SendFab';

interface ScheduleModalProps {
  open: boolean;
  onClose: () => void;
  onBack: () => void;
  contact: { number: string; name?: string } | null;
  onScheduled: () => void;
}

const REMINDER_LABELS: Record<ReminderValue, string> = {
  '15min': '15 min prima',
  '30min': '30 min prima',
  '1h': '1 ora prima',
  '1day': '1 giorno prima',
  'never': 'Mai',
};

function defaultDateTime(): { date: Date; time: string } {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return {
    date: d,
    time: `${String(d.getHours()).padStart(2, '0')}:00`,
  };
}

function combineDateTime(date: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

function translateError(code: string): string {
  switch (code) {
    case 'invalid_phone': return 'Numero non valido.';
    case 'invalid_message': return 'Messaggio non valido (vuoto o oltre 3500 caratteri).';
    case 'invalid_datetime': return 'Data/ora non valida (deve essere almeno 1 minuto nel futuro).';
    case 'self_target': return 'Non puoi schedulare a te stesso.';
    default: return 'Errore: ' + code;
  }
}

export default function ScheduleModal({ open, onClose, onBack, contact, onScheduled }: ScheduleModalProps) {
  const init = defaultDateTime();
  const [selectedDate, setSelectedDate] = useState<Date>(init.date);
  const [selectedTime, setSelectedTime] = useState<string>(init.time);
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState('');
  const [reminder, setReminder] = useState<ReminderValue>('never');
  const [approval, setApproval] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [clockOpen, setClockOpen] = useState(false);
  const [reminderSheetOpen, setReminderSheetOpen] = useState(false);

  useEffect(() => {
    if (open) {
      const d = defaultDateTime();
      setSelectedDate(d.date);
      setSelectedTime(d.time);
      setDescription('');
      setMessage('');
      setReminder('never');
      setApproval(false);
      setError(null);
      setSubmitting(false);
      setCalendarOpen(false);
      setClockOpen(false);
      setReminderSheetOpen(false);
    }
  }, [open]);

  if (!open || !contact) return null;

  const scheduledDate = combineDateTime(selectedDate, selectedTime);
  const isValidDate = scheduledDate.getTime() >= Date.now() + 60_000;
  const isValidMessage = message.trim().length > 0 && message.length <= 3500;
  const canSubmit = isValidDate && isValidMessage && !submitting;

  const contactLabel = contact.name || `+${contact.number}`;
  const dateLabel = format(scheduledDate, 'EEE d MMM', { locale: it });

  async function handleSubmit() {
    if (!canSubmit || !contact) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_number: contact.number,
          recipient_name: contact.name || undefined,
          message: message.trim(),
          scheduled_at: scheduledDate.toISOString(),
        }),
      });

      if (res.status === 200) {
        onScheduled();
        onClose();
        return;
      }

      const body = await res.json().catch(() => ({}));
      if (res.status === 403 && body.error === 'plan_contacts_limit_exceeded') {
        setError(`Hai raggiunto il limite di ${body.limit} contatti del piano ${body.plan}.`);
      } else if (body.error) {
        setError(translateError(body.error));
      } else {
        setError('Errore inatteso. Riprova.');
      }
    } catch {
      setError('Errore di rete. Riprova.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative bg-text-primary w-full h-full sm:w-[400px] sm:h-[700px] sm:max-h-[90vh] sm:rounded-3xl sm:shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-3 h-14 bg-[#202C33] shrink-0">
          <button
            onClick={onBack}
            aria-label="Indietro"
            className="p-2 rounded-full hover:bg-white/10 text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="text-white font-medium text-base">Programma un messaggio</div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto pb-24">
          {/* Title + close */}
          <div className="flex items-start justify-between px-4 pt-5 pb-3">
            <div className="text-white font-bold text-xl">
              Messaggio per {contactLabel}
            </div>
            <button
              onClick={onClose}
              aria-label="Chiudi"
              className="p-1 rounded-full hover:bg-white/10 text-white -mr-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Description */}
          <div className="px-4 pb-3">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrizione (facoltativa)"
              className="w-full bg-transparent text-white placeholder-gray-500 outline-none text-base py-1"
            />
          </div>

          <div className="border-t border-[#2A3942] mx-4" />

          {/* Date row */}
          <div className="flex items-center gap-4 px-4 py-4">
            <CalendarIcon className="w-5 h-5 text-gray-400 shrink-0" />
            <div className="flex items-center gap-2 text-white text-base">
              <button
                type="button"
                onClick={() => setCalendarOpen(true)}
                className="capitalize hover:text-primary"
              >
                {dateLabel}
              </button>
              <span className="text-gray-500">·</span>
              <button
                type="button"
                onClick={() => setClockOpen(true)}
                className="hover:text-primary"
              >
                {selectedTime}
              </button>
            </div>
          </div>

          {/* Approval row */}
          <div className="flex items-start gap-4 px-4 py-3">
            <UserCheck className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-white text-base">Richiedi approvazione per l'invio</div>
              <div className="text-gray-400 text-sm mt-0.5">
                Prima dell'invio riceverai una notifica di conferma
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={approval}
              aria-label="Richiedi approvazione"
              onClick={() => setApproval((v) => !v)}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                approval ? 'bg-primary' : 'bg-gray-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  approval ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>

          {/* Reminder row */}
          <button
            type="button"
            onClick={() => setReminderSheetOpen(true)}
            className="w-full flex items-center gap-4 px-4 py-3 hover:bg-white/5 text-left"
          >
            <Bell className="w-5 h-5 text-gray-400 shrink-0" />
            <div className="flex-1 text-white text-base">Promemoria</div>
            <div className="text-primary text-base">{REMINDER_LABELS[reminder]}</div>
            <ChevronRight className="w-5 h-5 text-gray-500" />
          </button>

          {/* Message textarea */}
          <div className="px-4 pt-4">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Scrivi il messaggio…"
              rows={5}
              maxLength={3500}
              className="w-full bg-[#1F2C33] text-white placeholder-gray-500 rounded-xl px-3 py-2 outline-none resize-none"
            />
            <div className="text-xs text-gray-500 text-right mt-1">{message.length}/3500</div>
          </div>

          {/* Error */}
          {error && (
            <div className="mx-4 mt-3 p-3 rounded-xl bg-red-900/40 text-red-200 text-sm">
              {error}
              {error.includes('limite') && (
                <a href="#prezzi" className="underline ml-2">Aggiorna piano</a>
              )}
            </div>
          )}
        </div>

        {/* FAB */}
        <SendFab disabled={!canSubmit} loading={submitting} onClick={handleSubmit} />

        {/* Sub-dialogs */}
        <DarkCalendarDialog
          open={calendarOpen}
          onClose={() => setCalendarOpen(false)}
          value={selectedDate}
          onConfirm={(d) => setSelectedDate(d)}
        />
        <AnalogClockDialog
          open={clockOpen}
          onClose={() => setClockOpen(false)}
          value={selectedTime}
          onConfirm={(s) => setSelectedTime(s)}
        />
        <ReminderBottomSheet
          open={reminderSheetOpen}
          onClose={() => setReminderSheetOpen(false)}
          value={reminder}
          onChange={(v) => setReminder(v)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the new test + full unit test suite**

Run: `npx jest __tests__/schedule-modal.test.tsx`
Expected: PASS, 8 tests.

Run: `npm test`
Expected: full suite still green (except `mini-calendar.test.tsx` which still passes since we haven't deleted it yet).

- [ ] **Step 5: Commit**

```bash
git add components/ScheduleModal.tsx __tests__/schedule-modal.test.tsx
git commit -m "feat(schedule): rewrite ScheduleModal with WhatsApp-native UI"
```

---

### Task 6: Delete MiniCalendar and its test

**Files:**
- Delete: `components/MiniCalendar.tsx`
- Delete: `__tests__/mini-calendar.test.tsx`

- [ ] **Step 1: Verify nothing else imports MiniCalendar**

Run: `grep -rn "MiniCalendar" --include="*.tsx" --include="*.ts" .`
Expected: only matches in `components/MiniCalendar.tsx` and `__tests__/mini-calendar.test.tsx`. The new `ScheduleModal.tsx` should not reference it.

If anything else references it, stop and resolve before deleting.

- [ ] **Step 2: Delete files**

Run:
```bash
git rm components/MiniCalendar.tsx __tests__/mini-calendar.test.tsx
```

- [ ] **Step 3: Run unit suite**

Run: `npm test`
Expected: full unit suite green (no missing references).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove unused MiniCalendar component and tests"
```

---

### Task 7: Update e2e test for new selectors

**Files:**
- Modify: `__tests__/e2e/contact-picker.spec.ts:115-128`

- [ ] **Step 1: Read the current test block**

Open `__tests__/e2e/contact-picker.spec.ts` and locate lines 115-128. Current relevant lines:

```ts
await page.getByPlaceholder(/Nome \(opzionale\)/i).fill('Test Persona');
await page.getByPlaceholder(/Numero/i).fill('3331234567');
await page.getByRole('button', { name: /Continua/i }).click();

await expect(page.getByText('Test Persona')).toBeVisible();
await page.getByRole('button', { name: /Domani 9:00/i }).click();
await page.getByPlaceholder(/Scrivi il messaggio/i).fill('Messaggio di test e2e');
await page.getByRole('button', { name: /^Schedula$/i }).click();
```

- [ ] **Step 2: Apply the edit**

Replace the block above (`await expect(page.getByText('Test Persona')...` through `await page.getByRole('button', { name: /^Schedula$/i }).click();`) with:

```ts
await expect(page.getByText(/Messaggio per Test Persona/i)).toBeVisible();
await page.getByPlaceholder(/Scrivi il messaggio/i).fill('Messaggio di test e2e');
await page.getByRole('button', { name: /Invia/i }).click();
```

Rationale:
- The body now shows "Messaggio per Test Persona" instead of a plain `Test Persona` chip.
- No more "Domani 9:00" preset — the modal opens with a default time (now + 1h, rounded), which is already a valid future time so we skip the preset click.
- Submit button is now the FAB with `aria-label="Invia"`.

- [ ] **Step 3: Run unit tests once more**

Run: `npm test`
Expected: still green.

E2E tests are not run here (require `npm run test:e2e` with a running server) — they're updated for the next CI cycle.

- [ ] **Step 4: Commit**

```bash
git add __tests__/e2e/contact-picker.spec.ts
git commit -m "test(e2e): update selectors for new ScheduleModal UI"
```

---

### Task 8: Final smoke verification

**Files:** none

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: zero errors. If errors appear, fix them and commit before continuing.

- [ ] **Step 2: Full unit test run**

Run: `npm test`
Expected: all green. Per CLAUDE.md the project had 88 passing tests; you removed 4 (mini-calendar) and added approximately 27 (4 + 4 + 6 + 8 + 8 in tasks 1-5), netting around 111 passing.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke (browser)**

Start dev server: `npm run dev`. In a browser:

1. Open `/dashboard` (you must be authenticated — if you can't auth, skip this step and rely on tests).
2. Click "Nuovo contatto" → pick or add a contact → modal opens.
3. Verify header "← Programma un messaggio".
4. Verify body title "Messaggio per [name]" and X close.
5. Click description, type, verify text appears.
6. Click the date → dark calendar dialog opens. Navigate months. Pick a future day. Click OK. Verify date in row updates.
7. Click the time → analog clock dialog opens at hour phase. Click hour 7 → phase advances to minute, hour reads 07. Click minute 30. Click OK. Verify time in row reads "07:30".
8. Toggle approval switch on/off.
9. Click "Promemoria" → bottom sheet slides up. Pick "1 ora prima". Verify sheet closes and value reads "1 ora prima" in green.
10. Type a message. Verify counter increments.
11. Click FAB → message submits, modal closes, queue refreshes.
12. Re-open modal, click X → modal closes without submit.
13. Re-open modal, click back arrow → goes back to contact picker.

If any step fails, stop and fix before declaring done.

- [ ] **Step 5: Final commit (only if any docs change)**

If no other changes are needed, skip. Otherwise commit any tidying.

---

## Self-review notes (writer)

**Spec coverage:** every spec section maps to a task — SendFab (Task 1), ReminderBottomSheet (Task 2), DarkCalendarDialog (Task 3), AnalogClockDialog (Task 4), orchestrator rewrite + submit + state + accessibility (Task 5), MiniCalendar cleanup (Task 6), e2e update (Task 7), verification (Task 8). UI-only fields (description, reminder, approval) are state in Task 5 and explicitly NOT in the payload — Task 5 test asserts they're absent.

**Type consistency:** `ReminderValue` defined in Task 2 and imported in Task 5. Sub-component prop names (`open`, `onClose`, `value`, `onConfirm`, `onChange`, `disabled`, `loading`, `onClick`, `minDate`) match between definitions and call sites.

**Theme reuse:** uses existing Tailwind tokens (`bg-text-primary`, `bg-primary`, `text-primary`); one-off hex values stay inline as planned.
