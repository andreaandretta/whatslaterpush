/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ContactAvatar } from '../components/ContactAvatar';

describe('ContactAvatar', () => {
  test('uses two-letter initials from a two-word name', () => {
    render(<ContactAvatar name="Mario Rossi" number="393331234567" />);
    expect(screen.getByText('MR')).toBeInTheDocument();
  });

  test('uses single-letter initial from a one-word name', () => {
    render(<ContactAvatar name="Anna" number="393339998877" />);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  test('#2: renders a neutral person glyph (NOT the last 3 digits) when the name is missing', () => {
    const { container } = render(<ContactAvatar number="393339998877" />);
    expect(container.querySelector('svg')).toBeInTheDocument(); // person glyph
    expect(screen.queryByText('877')).not.toBeInTheDocument();  // no digit "avatar"
  });

  test('#2: renders the neutral person glyph when the name is an empty string', () => {
    const { container } = render(<ContactAvatar name="" number="393331234567" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.queryByText('567')).not.toBeInTheDocument();
  });

  // Positive lock-in for the #2 fix: an unsynced contact (no name AND no photo) must
  // render the glyph and ZERO phone digits, so it never looks like "the photo is a number".
  test('#2: a contact with NO name and NO photo shows the glyph and zero digits', () => {
    const { container } = render(<ContactAvatar number="393331239999" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.textContent || '').not.toMatch(/\d/);
  });

  test('assigns deterministic color from number hash', () => {
    const { container: c1 } = render(<ContactAvatar name="A" number="393331111111" />);
    const { container: c2 } = render(<ContactAvatar name="B" number="393331111111" />);
    const bg1 = (c1.firstChild as HTMLElement).className;
    const bg2 = (c2.firstChild as HTMLElement).className;
    expect(bg1).toEqual(bg2);
  });

  test('uppercases initials', () => {
    render(<ContactAvatar name="mario rossi" number="393331234567" />);
    expect(screen.getByText('MR')).toBeInTheDocument();
  });
  test('variant="group" senza nome → icona Users, fondo di gruppo, nessuna cifra del JID', () => {
    const { container } = render(<ContactAvatar number="120363000000000001@g.us" variant="group" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('bg-[#1F5A45]');
    expect(root.className).toContain('text-[#BFF0D5]');
    expect(container.querySelector('svg.lucide-users')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide-user')).not.toBeInTheDocument();
    expect(container.textContent || '').not.toMatch(/\d/);
  });

  // B6/T34: con le iniziali ("PW") un gruppo sembrava una persona. Ora sempre
  // l'icona con due persone, come WhatsApp.
  test('variant="group" con nome → icona Users, niente iniziali, mai la foto', () => {
    const { container } = render(<ContactAvatar name="🏀 Under 12" number="120363000000000001@g.us" variant="group" photoSrc="https://example.test/p.jpg" />);
    expect(screen.queryByText('U1')).not.toBeInTheDocument();
    expect(container.querySelector('svg.lucide-users')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
