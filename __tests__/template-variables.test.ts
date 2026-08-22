/**
 * Unit tests for {nome} template-variable substitution.
 * Resolution happens at SEND time in the cron (covers both dashboard and
 * self-chat messages): the queued row keeps the raw "{nome}" token and the
 * recipient sees their own first name. A missing recipient_name must degrade
 * gracefully (token removed, no double spaces / stray commas), never leak
 * the literal "{nome}" to the recipient.
 */
import { applyTemplateVariables, hasTemplateVariables } from '@/app/lib/template-variables';

describe('applyTemplateVariables', () => {
  it('replaces {nome} with the first name of the recipient', () => {
    expect(applyTemplateVariables('Ciao {nome}, allenamento domani alle 18', 'Marco Rossi'))
      .toBe('Ciao Marco, allenamento domani alle 18');
  });

  it('is case-insensitive and tolerates spaces inside the braces', () => {
    expect(applyTemplateVariables('Ciao {Nome}!', 'Luca')).toBe('Ciao Luca!');
    expect(applyTemplateVariables('Ciao { nome }!', 'Luca')).toBe('Ciao Luca!');
    expect(applyTemplateVariables('Ciao {NOME}!', 'Luca')).toBe('Ciao Luca!');
  });

  it('replaces every occurrence', () => {
    expect(applyTemplateVariables('{nome}, confermi? Rispondi {nome} se ci sei', 'Anna'))
      .toBe('Anna, confermi? Rispondi Anna se ci sei');
  });

  it('uses only the first word of a multi-word recipient name', () => {
    expect(applyTemplateVariables('Ciao {nome}', 'Maria Grazia De Luca')).toBe('Ciao Maria');
  });

  it('trims whitespace around the recipient name', () => {
    expect(applyTemplateVariables('Ciao {nome}', '  Paolo  ')).toBe('Ciao Paolo');
  });

  it('removes the token cleanly when the recipient name is missing', () => {
    expect(applyTemplateVariables('Ciao {nome}, ci vediamo domani', null))
      .toBe('Ciao, ci vediamo domani');
    expect(applyTemplateVariables('Ciao {nome}, ci vediamo domani', ''))
      .toBe('Ciao, ci vediamo domani');
    expect(applyTemplateVariables('Ciao {nome}, ci vediamo domani', undefined))
      .toBe('Ciao, ci vediamo domani');
  });

  it('removes a leading token without leaving a stray comma or space', () => {
    expect(applyTemplateVariables('{nome}, ti aspetto alle 9', null)).toBe('Ti aspetto alle 9');
  });

  it('never leaves double spaces after removing a mid-sentence token', () => {
    expect(applyTemplateVariables('Ciao {nome} come stai?', null)).toBe('Ciao come stai?');
  });

  it('returns the text unchanged when there is no token', () => {
    expect(applyTemplateVariables('Nessuna variabile qui', 'Marco')).toBe('Nessuna variabile qui');
  });

  it('handles null/empty text without throwing', () => {
    expect(applyTemplateVariables('', 'Marco')).toBe('');
    expect(applyTemplateVariables(null as unknown as string, 'Marco')).toBe(null);
    expect(applyTemplateVariables(undefined as unknown as string, 'Marco')).toBe(undefined);
  });

  it('does not treat unrelated braces or [Nome] (self-chat syntax) as tokens', () => {
    expect(applyTemplateVariables('Usa {altro} e [Nome] cosi come sono', 'Marco'))
      .toBe('Usa {altro} e [Nome] cosi come sono');
  });

  it('keeps emoji and accented names intact', () => {
    expect(applyTemplateVariables('Ciao {nome} 👋', 'Nicolò')).toBe('Ciao Nicolò 👋');
  });
});

describe('hasTemplateVariables', () => {
  it('detects the token in any casing', () => {
    expect(hasTemplateVariables('Ciao {nome}')).toBe(true);
    expect(hasTemplateVariables('Ciao {Nome}')).toBe(true);
    expect(hasTemplateVariables('Ciao { NOME }')).toBe(true);
  });

  it('returns false for plain text, [Nome] and other braces', () => {
    expect(hasTemplateVariables('Ciao a tutti')).toBe(false);
    expect(hasTemplateVariables('Invia a [Nome] domani')).toBe(false);
    expect(hasTemplateVariables('Ciao {altro}')).toBe(false);
    expect(hasTemplateVariables('')).toBe(false);
  });
});
