import { isFakeDoorActive, isFakeDoorAnswer, FAKE_DOOR_ANSWERS, FAKE_DOOR_FEATURE } from '../app/lib/fake-door';

const ORIGINAL = process.env.FAKE_DOOR_CALENDAR_UNTIL;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.FAKE_DOOR_CALENDAR_UNTIL;
  else process.env.FAKE_DOOR_CALENDAR_UNTIL = ORIGINAL;
});

describe('isFakeDoorActive', () => {
  test('off without the variable', () => {
    delete process.env.FAKE_DOOR_CALENDAR_UNTIL;
    expect(isFakeDoorActive(new Date('2026-10-01T10:00:00Z'))).toBe(false);
  });

  test.each(['domani', '2026-10-1', '01-10-2026', '2026-13-01', '2026-10-00', ' '])('off with a malformed variable %p', (v) => {
    process.env.FAKE_DOOR_CALENDAR_UNTIL = v;
    expect(isFakeDoorActive(new Date('2026-10-01T10:00:00Z'))).toBe(false);
  });

  test('on until the date included, Rome time', () => {
    process.env.FAKE_DOOR_CALENDAR_UNTIL = '2026-11-15';
    expect(isFakeDoorActive(new Date('2026-10-01T10:00:00Z'))).toBe(true);
    // 15 nov 23:30 a Roma (22:30 UTC, ora solare): ancora il 15.
    expect(isFakeDoorActive(new Date('2026-11-15T22:30:00Z'))).toBe(true);
  });

  test('off the day after, Rome time (even when UTC is still the day before)', () => {
    process.env.FAKE_DOOR_CALENDAR_UNTIL = '2026-11-15';
    // 23:30 UTC del 15 = 00:30 del 16 a Roma.
    expect(isFakeDoorActive(new Date('2026-11-15T23:30:00Z'))).toBe(false);
    expect(isFakeDoorActive(new Date('2026-11-16T10:00:00Z'))).toBe(false);
  });
});

describe('answers', () => {
  test("'no' (Non mi serve) is a valid answer, with the three sizes", () => {
    expect([...FAKE_DOOR_ANSWERS]).toEqual(['lt10', '10_30', 'gt30', 'no']);
    expect(isFakeDoorAnswer('no')).toBe(true);
    expect(isFakeDoorAnswer('gt30')).toBe(true);
    expect(isFakeDoorAnswer('forse')).toBe(false);
    expect(isFakeDoorAnswer(10)).toBe(false);
    expect(FAKE_DOOR_FEATURE).toBe('calendar_photo');
  });
});
