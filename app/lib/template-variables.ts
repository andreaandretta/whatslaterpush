/**
 * {nome} template-variable substitution.
 *
 * The queued row keeps the raw token; resolution happens at SEND time in the
 * cron so it covers every origin (dashboard, self-chat parser, recurrences)
 * and always uses the recipient_name saved on the row. Only {nome} exists for
 * now — [Nome] is the self-chat command syntax and must NOT be treated as a
 * variable.
 */

const TOKEN = /\{\s*nome\s*\}/gi;
const TOKEN_SINGLE = /\{\s*nome\s*\}/i;

export function hasTemplateVariables(text: string | null | undefined): boolean {
  if (!text) return false;
  return TOKEN_SINGLE.test(text);
}

export function firstNameOf(recipientName: string | null | undefined): string {
  return (recipientName || '').trim().split(/\s+/)[0] || '';
}

export function applyTemplateVariables<T extends string | null | undefined>(
  text: T,
  recipientName?: string | null
): T {
  if (!text || !hasTemplateVariables(text)) return text;

  const firstName = firstNameOf(recipientName);
  if (firstName) {
    return text.replace(TOKEN, firstName) as T;
  }

  // No name on the row: drop the token without leaving artifacts.
  // " {nome}" collapses into nothing; a leading "{nome}, " loses the comma
  // and the next word is re-capitalized so the message still reads naturally.
  let out = text.replace(/[ \t]*\{\s*nome\s*\}/gi, '');
  out = out.replace(/^[ \t]*,[ \t]*/, '');
  out = out.replace(/[ \t]{2,}/g, ' ').trim();
  if (out && text.trimStart().search(TOKEN_SINGLE) === 0) {
    out = out.charAt(0).toUpperCase() + out.slice(1);
  }
  return out as T;
}
