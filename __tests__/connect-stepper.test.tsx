/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ConnectStepper from '../components/ConnectStepper';

describe('ConnectStepper', () => {
  test('step 1 active: labels show "1 · Numero" green, others neutral', () => {
    render(<ConnectStepper currentStep={1} />);
    expect(screen.getByText(/1\s*·\s*Numero/i)).toHaveAttribute('data-state', 'active');
    expect(screen.getByText(/2\s*·\s*QR/i)).toHaveAttribute('data-state', 'pending');
    expect(screen.getByText(/3\s*·\s*Dashboard/i)).toHaveAttribute('data-state', 'pending');
  });

  test('step 2 active: step 1 shows ✓ (completed), step 2 active, step 3 pending', () => {
    render(<ConnectStepper currentStep={2} />);
    expect(screen.getByText(/✓\s*Numero/i)).toBeInTheDocument();
    expect(screen.getByText(/2\s*·\s*QR/i)).toHaveAttribute('data-state', 'active');
    expect(screen.getByText(/3\s*·\s*Dashboard/i)).toHaveAttribute('data-state', 'pending');
  });

  test('step 3 active: steps 1 and 2 show ✓, step 3 active', () => {
    render(<ConnectStepper currentStep={3} />);
    expect(screen.getByText(/✓\s*Numero/i)).toBeInTheDocument();
    expect(screen.getByText(/✓\s*QR/i)).toBeInTheDocument();
    expect(screen.getByText(/3\s*·\s*Dashboard/i)).toHaveAttribute('data-state', 'active');
  });

  test('done state: all 3 steps completed', () => {
    render(<ConnectStepper currentStep="done" />);
    expect(screen.getByText(/✓\s*Numero/i)).toBeInTheDocument();
    expect(screen.getByText(/✓\s*QR/i)).toBeInTheDocument();
    expect(screen.getByText(/✓\s*Dashboard/i)).toBeInTheDocument();
  });

  test('error on step 2: shows ⚠ on step 2, progress bar has data-variant=error', () => {
    render(<ConnectStepper currentStep="error" errorOnStep={2} />);
    expect(screen.getByText(/⚠\s*QR/i)).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('data-variant', 'error');
  });

  test('progress bar fills proportionally (step 2 => ~67%)', () => {
    render(<ConnectStepper currentStep={2} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '67');
  });

  test('has nav with aria-label "Progresso connessione"', () => {
    render(<ConnectStepper currentStep={1} />);
    expect(screen.getByRole('navigation', { name: /Progresso connessione/i })).toBeInTheDocument();
  });
});
