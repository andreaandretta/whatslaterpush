/**
 * @jest-environment jsdom
 *
 * Lista messaggi — correzioni rapide del rapporto 360 (2 ott 2026):
 * A6 il numero stesso come "nome" vale come nessun nome (anche nel cerchio; in
 * {nome} si toglie qualsiasi nome di cifre), A11 la pressione lunga non seleziona il testo, A12 parole intere
 * al posto delle sigle ("23 minuti fa", "tra 2 giorni", "Tieni premuto").
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MessagesSection, { type ScheduledMessage } from '../app/components/MessagesSection';
import { formatCountdown, formatRelativePast } from '../app/components/StatusBadge';
import { MessageActionsSheet } from '../app/components/MessageActionsSheet';
import { ContactAvatar } from '../components/ContactAvatar';
import { applyTemplateVariables, firstNameOf } from '../app/lib/template-variables';

function msg(over: Partial<ScheduledMessage>): ScheduledMessage {
  return {
    id: 'm1', recipient_name: 'Mario Rossi', recipient_number: '393331234567', parsed_message: 'Allenamento alle 18',
    scheduled_at: new Date(Date.now() + 3 * 3600 * 1000).toISOString(), status: 'pending', ...over,
  };
}

function setup(messages: ScheduledMessage[]) {
  const props = {
    onDelete: jest.fn(), onDuplicate: jest.fn(), onEdit: jest.fn(), onPauseToggle: jest.fn(),
    onRetry: jest.fn(), onSnooze: jest.fn(), onShowToast: jest.fn(), onChooseOtherContact: jest.fn(),
    connected: true,
  };
  render(<MessagesSection {...(props as any)} messages={messages} />);
}

describe('A11 — pressione lunga', () => {
  test('la riga non è selezionabile e non apre il menu di iOS', () => {
    setup([msg({})]);
    const row = screen.getByTestId('message-row');
    expect(row.className).toMatch(/\bselect-none\b/);
    expect(row.className).toContain('[-webkit-touch-callout:none]');
  });

  test('il foglio dice "Tieni premuto", non "Tap lungo"', () => {
    render(
      <MessageActionsSheet
        open onClose={() => {}} title="Mario"
        onDuplicate={() => {}} onEdit={() => {}} onPauseToggle={() => {}} onRetry={() => {}} onDelete={() => {}}
        isPaused={false} canEdit canPause canRetry={false} canDelete
      />,
    );
    const hint = screen.getByText('Tieni premuto un messaggio per riaprire questo menu.');
    expect(screen.queryByText(/Tap lungo/)).not.toBeInTheDocument();
    // Revisione: si legge (12px #8696A0, 4,7:1), non più 11px gray-500.
    expect(hint.className).toMatch(/\btext-xs\b/);
    expect(hint.className).toMatch(/text-\[#8696A0\]/);
    expect(hint.className).not.toMatch(/text-gray-500|text-\[11px\]/);
  });
});

describe('A6 — nome fatto di cifre nella lista', () => {
  test('riga già salvata con recipient_name "393331234567" → "+39 333 123 4567"', () => {
    setup([msg({ recipient_name: '393331234567' })]);
    expect(screen.getByText('+39 333 123 4567')).toBeInTheDocument();
    expect(screen.queryByText('393331234567')).not.toBeInTheDocument();
  });

  // Revisione: un nome di cifre scelto apposta resta, come sul server.
  test('riga con recipient_name "118" scelto apposta → resta "118"', () => {
    setup([msg({ recipient_name: '118', recipient_number: '393401111111' })]);
    expect(screen.getByText('118')).toBeInTheDocument();
    expect(screen.queryByText('+39 340 111 1111')).not.toBeInTheDocument();
  });

  test('il cerchio di una persona non mostra la prima cifra; un gruppo "2012" tiene le iniziali', () => {
    const { container, rerender } = render(<ContactAvatar name="393331234567" number="393331234567" />);
    expect(container.textContent).toBe('');
    rerender(<ContactAvatar name="Mario Rossi" number="393331234567" />);
    expect(container.textContent).toBe('MR');
    rerender(<ContactAvatar name="118" number="393401111111" />);
    expect(container.textContent).toBe('1');
    rerender(<ContactAvatar name="2012" number="120363000000000001@g.us" variant="group" />);
    expect(container.textContent).toBe('2');
  });

  test('{nome} con un nome fatto di cifre si toglie, non diventa "Ciao 393…"', () => {
    expect(firstNameOf('393331234567')).toBe('');
    expect(firstNameOf('+39 333 123 4567')).toBe('');
    expect(firstNameOf('Marco Rossi')).toBe('Marco');
    expect(applyTemplateVariables('Ciao {nome}, domani allenamento', '393331234567')).toBe('Ciao, domani allenamento');
  });
});

describe('A12 — parole intere al posto delle sigle', () => {
  // Martedì 6 ottobre 2026, 10:00 a Roma.
  const NOW = new Date('2026-10-06T08:00:00Z');
  const at = (iso: string) => new Date(iso).toISOString();
  const fromNow = (m: number) => new Date(NOW.getTime() + m * 60_000 + 5_000).toISOString();
  const agoMin = (m: number) => new Date(NOW.getTime() - m * 60_000 - 5_000).toISOString();

  test('countdown: minuti e ore oggi, poi i giorni del calendario', () => {
    expect(formatCountdown(new Date(NOW.getTime() + 20_000).toISOString(), NOW)).toBe('Parte tra poco');
    expect(formatCountdown(fromNow(1), NOW)).toBe('Parte tra 1 minuto');
    expect(formatCountdown(fromNow(23), NOW)).toBe('Parte tra 23 minuti');
    expect(formatCountdown(fromNow(60), NOW)).toBe('Parte tra 1 ora');
    expect(formatCountdown(fromNow(3 * 60 + 20), NOW)).toBe('Parte tra 3 ore');
    expect(formatCountdown(at('2026-10-06T16:00:00Z'), NOW)).toBe('Parte tra 8 ore');      // oggi 18:00
    expect(formatCountdown(at('2026-10-07T18:00:00Z'), NOW)).toBe('Parte domani');         // mer 20:00, 34 ore
    expect(formatCountdown(at('2026-10-10T07:00:00Z'), NOW)).toBe('Parte tra 4 giorni');
    expect(formatCountdown(fromNow(-1), NOW)).toBeNull();
  });

  // Revisione: 47 ore dicevano "tra 1 giorno" e si capiva "domani".
  test('giovedì alle 9 visto martedì alle 10 (47 ore) è "dopodomani", non "tra 1 giorno"', () => {
    expect(formatCountdown(at('2026-10-08T07:00:00Z'), NOW)).toBe('Parte dopodomani');
  });

  test('la sera tardi, domattina è "domani" anche se mancano meno di 24 ore', () => {
    const late = new Date('2026-10-06T20:00:00Z'); // 22:00 a Roma
    expect(formatCountdown(at('2026-10-07T07:00:00Z'), late)).toBe('Parte domani');
  });

  test('passato contato sul calendario: 47 ore fa è "2 giorni fa", non "ieri"', () => {
    const thu = new Date('2026-10-08T07:00:00Z'); // giovedì 09:00 a Roma
    expect(formatRelativePast(at('2026-10-06T08:00:00Z'), thu)).toBe('2 giorni fa');
    expect(formatRelativePast(at('2026-10-07T06:00:00Z'), thu)).toBe('ieri');
    expect(formatRelativePast(at('2026-10-07T20:00:00Z'), thu)).toBe('11 ore fa');
  });

  test('passato: "23 minuti fa", "ieri", "2 settimane fa", "2 mesi fa", "1 anno fa"', () => {
    expect(formatRelativePast(new Date(NOW.getTime() - 10_000).toISOString(), NOW)).toBe('adesso');
    expect(formatRelativePast(agoMin(1), NOW)).toBe('1 minuto fa');
    expect(formatRelativePast(agoMin(23), NOW)).toBe('23 minuti fa');
    expect(formatRelativePast(agoMin(60), NOW)).toBe('1 ora fa');
    expect(formatRelativePast(agoMin(5 * 60), NOW)).toBe('5 ore fa');
    expect(formatRelativePast(agoMin(24 * 60), NOW)).toBe('ieri');
    expect(formatRelativePast(agoMin(3 * 24 * 60), NOW)).toBe('3 giorni fa');
    expect(formatRelativePast(agoMin(15 * 24 * 60), NOW)).toBe('2 settimane fa');
    expect(formatRelativePast(agoMin(65 * 24 * 60), NOW)).toBe('2 mesi fa');
    expect(formatRelativePast(agoMin(400 * 24 * 60), NOW)).toBe('1 anno fa');
  });

  test('nella lista: niente "2g 14h" né "23m"', () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    try {
      setup([msg({ scheduled_at: at('2026-10-09T07:00:00Z') })]); // venerdì 09:00
      expect(screen.getAllByText(/tra 3 giorni/).length).toBeGreaterThan(0);
      expect(document.body.textContent).not.toMatch(/\d+g \d+h|\d+m\b/);
    } finally {
      jest.useRealTimers();
    }
  });

  test('riga e testata dicono "dopodomani" per un invio tra 47 ore', () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    try {
      setup([msg({ scheduled_at: at('2026-10-08T07:00:00Z') })]);
      expect(screen.getByText('Parte dopodomani')).toBeInTheDocument();
      expect(screen.getByText(/^Prossimo invio/)).toHaveTextContent('Prossimo invio dopodomani');
      expect(document.body.textContent).not.toMatch(/tra 1 giorno/);
    } finally {
      jest.useRealTimers();
    }
  });
});
