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

  test('falls back to last 3 digits of number when name missing', () => {
    render(<ContactAvatar number="393339998877" />);
    expect(screen.getByText('877')).toBeInTheDocument();
  });

  test('falls back to last 3 digits when name is empty string', () => {
    render(<ContactAvatar name="" number="393331234567" />);
    expect(screen.getByText('567')).toBeInTheDocument();
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
});
