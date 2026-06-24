/**
 * Unit tests for the contact "active window" helpers.
 * The contact cap counts ACTIVE recipients (in-flight, or messaged within the
 * last 90 days), not lifetime — so a Free user is never locked out forever by
 * contacts they messaged once months ago.
 */
import {
  CONTACT_ACTIVE_WINDOW_DAYS,
  contactActiveCutoffIso,
  isRecipientActive,
} from '../app/lib/contact-window';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-06-24T12:00:00.000Z');

describe('contactActiveCutoffIso', () => {
  test('window is 90 days', () => {
    expect(CONTACT_ACTIVE_WINDOW_DAYS).toBe(90);
  });

  test('returns the ISO timestamp exactly 90 days before now', () => {
    const iso = contactActiveCutoffIso(NOW);
    expect(Date.parse(iso)).toBe(NOW - 90 * DAY);
  });
});

describe('isRecipientActive', () => {
  test('in-flight (pending) counts regardless of dates', () => {
    expect(isRecipientActive({ status: 'pending', sent_at: null, scheduled_at: null }, NOW)).toBe(true);
  });

  test('in-flight (awaiting_confirm) counts — recipient is being set up', () => {
    expect(isRecipientActive({ status: 'awaiting_confirm', sent_at: null, scheduled_at: null }, NOW)).toBe(true);
  });

  test('future-dated paused send counts', () => {
    expect(isRecipientActive({ status: 'paused', sent_at: null, scheduled_at: new Date(NOW + 30 * DAY).toISOString() }, NOW)).toBe(true);
  });

  test('sent within the window counts', () => {
    expect(isRecipientActive({ status: 'sent', sent_at: new Date(NOW - 10 * DAY).toISOString(), scheduled_at: new Date(NOW - 11 * DAY).toISOString() }, NOW)).toBe(true);
  });

  test('sent before the window does NOT count', () => {
    expect(isRecipientActive({ status: 'sent', sent_at: new Date(NOW - 100 * DAY).toISOString(), scheduled_at: new Date(NOW - 101 * DAY).toISOString() }, NOW)).toBe(false);
  });

  test('failed within the window counts (a recent attempted relationship)', () => {
    expect(isRecipientActive({ status: 'failed', sent_at: null, scheduled_at: new Date(NOW - 5 * DAY).toISOString() }, NOW)).toBe(true);
  });

  test('failed before the window does NOT count', () => {
    expect(isRecipientActive({ status: 'failed', sent_at: null, scheduled_at: new Date(NOW - 120 * DAY).toISOString() }, NOW)).toBe(false);
  });

  test('sent anchors on sent_at, not scheduled_at (overdue send still recent)', () => {
    // scheduled long ago, but actually sent recently → active.
    expect(isRecipientActive({ status: 'sent', sent_at: new Date(NOW - 3 * DAY).toISOString(), scheduled_at: new Date(NOW - 200 * DAY).toISOString() }, NOW)).toBe(true);
  });

  test('cancelled never counts (defensive; DB query already excludes it)', () => {
    expect(isRecipientActive({ status: 'cancelled', sent_at: new Date(NOW).toISOString(), scheduled_at: new Date(NOW).toISOString() }, NOW)).toBe(false);
  });

  test('exactly at the cutoff counts (inclusive boundary)', () => {
    expect(isRecipientActive({ status: 'sent', sent_at: new Date(NOW - 90 * DAY).toISOString(), scheduled_at: null }, NOW)).toBe(true);
  });
});
