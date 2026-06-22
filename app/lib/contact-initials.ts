// #2: initials from a contact name, or '' when there's no real name.
//
// We deliberately do NOT fall back to the phone digits — a digit "avatar" reads as
// "the photo is a number", especially for unsynced contacts that have neither a name
// nor a photo. ContactAvatar renders a neutral person glyph when this returns ''.
export function computeInitials(name: string | undefined): string {
  const n = (name || '').trim();
  if (!n) return '';
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return words[0][0].toUpperCase();
}
