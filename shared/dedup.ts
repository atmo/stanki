// Duplicate detection for card fronts, shared by the PWA "Add word" screen and
// the extension bubble. Two fronts are considered the same word when their keys
// match: lowercased, trimmed, with a leading Dutch article (de/het/'t/een)
// dropped — so "het huis", "Huis" and "huis" all collide.

const ARTICLE_RE = /^(?:de|het|'t|een)\s+/i;

/** Comparison key for duplicate detection. */
export function dedupKey(front: string): string {
  return front.trim().toLowerCase().replace(ARTICLE_RE, '').trim();
}

/** Whether two fronts refer to the same word (article-insensitive). */
export function sameWord(a: string, b: string): boolean {
  const ka = dedupKey(a);
  return ka.length > 0 && ka === dedupKey(b);
}
