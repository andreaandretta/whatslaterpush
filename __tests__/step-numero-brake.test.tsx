/**
 * @jest-environment jsdom
 */
/**
 * TDD — Task 58: freno anti-martellamento in StepNumero.
 * Con cooldown attivo il CTA è disabilitato e mostra il countdown; il card
 * d'errore usa il copy della classificazione (rate-limit vs problema nostro).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StepNumero from '../app/components/connect/StepNumero';

function typeValidNumber() {
  const input = screen.getByPlaceholderText('333 123 4567');
  fireEvent.change(input, { target: { value: '3331234567' } });
}

describe('StepNumero — freno anti-martellamento (Task 58)', () => {
  test('cooldown attivo → CTA disabilitato con countdown anche a numero valido', () => {
    render(
      <StepNumero
        onSubmit={jest.fn()}
        cooldownUntil={Date.now() + 90_000}
        error={{ kind: 'rate_limited', title: 'Troppi tentativi ravvicinati', message: 'WhatsApp limita i tentativi: aspetta il timer.', cooldownSec: 90 }}
      />
    );
    typeValidNumber();
    const btn = screen.getByRole('button', { name: /riprova tra/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/troppi tentativi ravvicinati/i)).toBeInTheDocument();
    expect(screen.getByText(/aspetta il timer/i)).toBeInTheDocument();
  });

  test('errore "problema nostro" → copy che scagiona l\'utente', () => {
    render(
      <StepNumero
        onSubmit={jest.fn()}
        cooldownUntil={Date.now() + 60_000}
        error={{ kind: 'ours', title: 'Problema dal lato nostro', message: 'Non sei tu: abbiamo un problema tecnico e siamo già stati avvisati.', cooldownSec: 60 }}
      />
    );
    expect(screen.getByText(/non sei tu/i)).toBeInTheDocument();
  });

  test('cooldown scaduto → CTA torna abilitato (nessun lucchetto permanente)', () => {
    render(
      <StepNumero
        onSubmit={jest.fn()}
        cooldownUntil={Date.now() - 1000}
        error={null}
      />
    );
    typeValidNumber();
    const btn = screen.getByRole('button', { name: /genera il codice|continua|avanti/i });
    expect(btn).toBeEnabled();
  });

  test('senza props nuove il componente resta identico (retro-compatibilità)', () => {
    render(<StepNumero onSubmit={jest.fn()} />);
    typeValidNumber();
    const btn = screen.getByRole('button', { name: /genera il codice|continua|avanti/i });
    expect(btn).toBeEnabled();
  });
});
