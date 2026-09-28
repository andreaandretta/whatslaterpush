/**
 * @jest-environment jsdom
 */
/**
 * Hunt fase 1: il campo numero di /connect teneva solo le prime 10 cifre.
 * "+39 347 123 4567" (autofill del telefono o incollato dalla rubrica)
 * diventava "393 471 2345", il pulsante restava grigio senza spiegazioni e,
 * ritoccando una cifra, partiva la richiesta del codice per il numero di uno
 * sconosciuto (39 393…). Qui: il numero si legge tutto, prima di troncare.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StepNumero from '../app/components/connect/StepNumero';
import StepCodice from '../app/components/connect/StepCodice';
import { readPairingNumber } from '../app/lib/phone';

function field() {
  return screen.getByPlaceholderText('333 123 4567') as HTMLInputElement;
}
function cta() {
  return screen.getByRole('button', { name: /continua/i });
}
function typeInto(value: string) {
  fireEvent.change(field(), { target: { value } });
}

describe('StepNumero — numero incollato o suggerito dal telefono', () => {
  test('"+39 347 123 4567" → numero intero, CTA attivo, invia 393471234567', () => {
    const onSubmit = jest.fn();
    render(<StepNumero onSubmit={onSubmit} />);
    typeInto('+39 347 123 4567');
    expect(field().value.replace(/\D/g, '')).toBe('3471234567');
    expect(cta()).toBeEnabled();
    fireEvent.click(cta());
    expect(onSubmit).toHaveBeenCalledWith('393471234567');
  });

  test('"0039 3471234567" e "393471234567" (autofill senza +) → stesso numero', () => {
    const onSubmit = jest.fn();
    render(<StepNumero onSubmit={onSubmit} />);
    typeInto('0039 3471234567');
    fireEvent.click(cta());
    typeInto('393471234567');
    fireEvent.click(cta());
    expect(onSubmit.mock.calls).toEqual([['393471234567'], ['393471234567']]);
  });

  test('il campo non tronca mai: ritoccare una cifra non produce un altro numero', () => {
    const onSubmit = jest.fn();
    render(<StepNumero onSubmit={onSubmit} />);
    typeInto('+39 347 123 4567');
    // l'utente cancella l'ultima cifra e la riscrive
    const shown = field().value;
    typeInto(shown.slice(0, -1));
    typeInto(field().value + '7');
    fireEvent.click(cta());
    expect(onSubmit).toHaveBeenCalledWith('393471234567');
  });

  test('fisso a 9 cifre (06 1234567) è accettato', () => {
    const onSubmit = jest.fn();
    render(<StepNumero onSubmit={onSubmit} />);
    typeInto('06 1234567');
    expect(cta()).toBeEnabled();
    fireEvent.click(cta());
    expect(onSubmit).toHaveBeenCalledWith('39061234567');
  });

  test('numero sbagliato → CTA grigio CON il motivo', () => {
    render(<StepNumero onSubmit={jest.fn()} />);
    typeInto('34712345678');
    expect(cta()).toBeDisabled();
    expect(screen.getByText(/cifra in più/i)).toBeInTheDocument();
  });

  test('mentre si scrive (poche cifre) nessun messaggio d\'errore', () => {
    render(<StepNumero onSubmit={jest.fn()} />);
    typeInto('347 12');
    expect(cta()).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('estero col prefisso: accettato e mostrato come letto', () => {
    const onSubmit = jest.fn();
    render(<StepNumero onSubmit={onSubmit} />);
    typeInto('+41 79 123 45 67');
    expect(screen.getByText(/\+41 79 123 45 67/)).toBeInTheDocument();
    fireEvent.click(cta());
    expect(onSubmit).toHaveBeenCalledWith('41791234567');
  });

  test('autofill chiede la parte nazionale del numero', () => {
    render(<StepNumero onSubmit={jest.fn()} />);
    expect(field()).toHaveAttribute('autocomplete', 'tel-national');
  });
});

describe('StepCodice — ripete il numero prima di andare su WhatsApp', () => {
  test('mostra "+39 347 123 4567" e il modo di tornare indietro', () => {
    const onBack = jest.fn();
    render(
      <StepCodice code="ABCD-EFGH" expiresAt={Date.now() + 60_000} phoneNumber="393471234567" onBack={onBack} onRegenerate={jest.fn()} />
    );
    expect(screen.getByText('+39 347 123 4567')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /non è il tuo/i }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('readPairingNumber', () => {
  test('letture', () => {
    expect(readPairingNumber('+39 347 123 4567')).toMatchObject({ ok: true, digits: '393471234567', national: '3471234567', italian: true });
    expect(readPairingNumber('393471234567')).toMatchObject({ ok: true, digits: '393471234567' });
    expect(readPairingNumber('3934712345')).toMatchObject({ ok: true, digits: '393934712345' }); // un vero 393… scritto per intero resta quello
    expect(readPairingNumber('34712345678')).toEqual({ ok: false, error: 'extra_digit' });
    expect(readPairingNumber('39061234567')).toMatchObject({ ok: true, digits: '39061234567' }); // fisso con 39 senza +
    // un 393… con una cifra in più NON diventa un altro numero più corto
    expect(readPairingNumber('39312345678').ok).toBe(false);
    expect(readPairingNumber('')).toEqual({ ok: false, error: 'empty' });
    // "39" senza + davanti a un numero NON italiano non diventa estero
    expect(readPairingNumber('0041 79 123 45 67')).toMatchObject({ ok: true, digits: '41791234567', italian: false });
    expect(readPairingNumber('0041 79 123 45 67')).not.toHaveProperty('national', expect.anything());
  });
});
