// Offline Dutch lemmatizer: maps an inflected form to its dictionary headword
// (plural -> singular, conjugated/participle verb -> infinitive) using a
// frequency map of the most-used inflected words, derived from the Universal
// Dependencies Dutch treebanks (see lemma-data.ts / scripts/gen-lemma.py).
//
// Map-only by design: a known form returns its lemma, an unknown form is
// returned unchanged. No fuzzy rules, so it never emits a wrong guess — it
// either normalizes a word it knows or leaves it alone.

import { LEMMA_MAP, ARTICLE_MAP } from './lemma-data';

/** Best-guess Dutch lemma for a word; returns it lowercased & unchanged if unknown. */
export function lemmatize(raw: string): string {
  const w = raw.trim().toLowerCase();
  if (w.length < 2) return w;
  return LEMMA_MAP[w] ?? w;
}

/** Definite article (de/het) for a noun lemma, or null if not a known noun. */
export function nounArticle(lemma: string): string | null {
  return ARTICLE_MAP[lemma.trim().toLowerCase()] ?? null;
}

/** A lemma with its article for nouns ("het huis"); the bare lemma otherwise. */
export function withArticle(lemma: string): string {
  const art = nounArticle(lemma);
  return art ? `${art} ${lemma}` : lemma;
}
