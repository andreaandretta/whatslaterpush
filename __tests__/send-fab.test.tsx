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

  test('shows spinner when loading', () => {
    const { container } = render(<SendFab disabled={false} loading={true} onClick={() => {}} />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  // Rapporto 360, T3 e T21 (A2, A8).
  test('label: dark text on green (#0B141A), never white', () => {
    render(<SendFab disabled={false} loading={false} onClick={() => {}} label="Invia oggi alle 18:00" />);
    const btn = screen.getByRole('button', { name: /Invia/i });
    expect(btn.className).toMatch(/\bbg-primary\b/);
    expect(btn.className).toMatch(/text-\[#0B141A\]/);
    expect(btn.className).not.toMatch(/\btext-white\b/);
  });

  test('disabled: grey (#2A3942 / #8696A0), not a darker green; the reason is said above', () => {
    render(<SendFab disabled={true} loading={false} onClick={() => {}} label="Invia oggi alle 18:00" hint="Scrivi il messaggio o allega un file." />);
    const btn = screen.getByRole('button', { name: /Invia/i });
    expect(btn.className).toMatch(/disabled:bg-\[#2A3942\]/);
    expect(btn.className).toMatch(/disabled:text-\[#8696A0\]/);
    expect(btn.className).not.toMatch(/disabled:opacity-50/);
    const hint = screen.getByTestId('send-fab-hint');
    expect(hint).toHaveTextContent('Scrivi il messaggio o allega un file.');
    expect(btn).toHaveAttribute('aria-describedby', hint.id);
  });

  test('no hint → no line and no aria-describedby', () => {
    render(<SendFab disabled={false} loading={false} onClick={() => {}} label="Invia" hint={null} />);
    expect(screen.queryByTestId('send-fab-hint')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invia/i })).not.toHaveAttribute('aria-describedby');
  });

  test('while sending it stays green with the spinner (not the grey "missing something" look)', () => {
    render(<SendFab disabled={false} loading={true} onClick={() => {}} label="Invia" />);
    expect(screen.getByRole('button', { name: /Invia/i }).className).not.toMatch(/disabled:bg-\[#2A3942\]/);
  });
});
