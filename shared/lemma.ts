// Offline Dutch lemmatizer: maps an inflected form to its dictionary headword
// (plural -> singular, conjugated/participle verb -> infinitive) using a
// frequency map of the most-used inflected words, derived from the Universal
// Dependencies Dutch treebanks (see lemma-data.ts / scripts/gen-lemma.py).
//
// Map-only by design: a known form returns its lemma, an unknown form is
// returned unchanged. No fuzzy rules, so it never emits a wrong guess — it
// either normalizes a word it knows or leaves it alone.

import { LEMMA_MAP, ALT_MAP, ARTICLE_MAP } from './lemma-data';

/**
 * Dutch lemma for a word, from the Wiktionary-derived map. Follows the map
 * transitively (opvallender -> opvallend -> opvallen) with a cycle guard, and
 * returns the input lowercased & unchanged if unknown. For words with more than
 * one reading (e.g. a noun plural vs. a verb), this returns the default; use
 * lemmaCandidates() to offer the choice.
 */
export function lemmatize(raw: string): string {
  let w = raw.trim().toLowerCase();
  if (w.length < 2) return w;
  const seen = new Set<string>();
  while (LEMMA_MAP[w] && !seen.has(w)) {
    seen.add(w);
    w = LEMMA_MAP[w];
  }
  return w;
}

/**
 * Base-form readings to offer the user, default first. Two sources:
 *  - a registered ambiguity (noun plural vs. verb), e.g. "huizen" -> ["huizen","huis"];
 *  - a reduction chain, where each step is a valid stopping point, e.g.
 *    "opvallender" -> opvallend -> opvallen yields ["opvallen","opvallend"]
 *    (most-reduced first; lemmaCandidates(w)[0] === lemmatize(w)).
 * One element when unambiguous.
 */
export function lemmaCandidates(raw: string): string[] {
  const w = raw.trim().toLowerCase();
  if (w.length < 2) return [w];
  if (ALT_MAP[w]) return ALT_MAP[w];

  const chain: string[] = [];
  let cur = w;
  const seen = new Set<string>([w]);
  while (LEMMA_MAP[cur] && !seen.has(LEMMA_MAP[cur])) {
    cur = LEMMA_MAP[cur];
    seen.add(cur);
    chain.push(cur);
  }
  return chain.length ? chain.reverse() : [w];
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
