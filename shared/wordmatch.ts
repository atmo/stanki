// Match the card's word inside a sentence, for spoiler-masking / highlighting in
// review. Lemma-aware (so inflections count) and separable-verb-aware: a
// separable verb ("aanhouden") splits in a clause ("aan te houden", "hield … aan"),
// so its prefix and base-verb forms are matched too — but only when *both* occur
// in the sentence, so a lone base verb (a different word) or a stray preposition
// isn't hit. Phrase (multi-word) fronts match nothing.
import { lemmatize } from './lemma';
import { dedupKey } from './dedup';

/** Given a sentence, a predicate telling whether a token is (part of) the word. */
export type Matcher = (text: string) => (token: string) => boolean;

export const NO_MATCH: Matcher = () => () => false;

// Dutch separable-verb prefixes, longest first so e.g. "tegemoet" wins over "toe".
const SEPARABLE_PREFIXES = [
  'tegemoet', 'voorbij', 'achter', 'binnen', 'boven', 'buiten', 'onder', 'samen',
  'tegen', 'terug', 'thuis', 'tussen', 'voort', 'door', 'langs', 'rond', 'voor',
  'weer', 'aan', 'bij', 'los', 'mee', 'neer', 'vast', 'weg', 'af', 'in', 'na',
  'om', 'op', 'over', 'toe', 'uit',
];

const words = (text: string): string[] => text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);

export function wordMatcher(front: string): Matcher {
  const key = dedupKey(front);
  if (key.length < 2 || key.includes(' ')) return NO_MATCH; // phrase / trivial: no match
  const lemma = lemmatize(key);

  // Detect a separable verb: <prefix><base infinitive>, base a clean infinitive.
  let prefix = '';
  let base = '';
  if (lemma.endsWith('en')) {
    for (const p of SEPARABLE_PREFIXES) {
      const rest = lemma.slice(p.length);
      if (lemma.startsWith(p) && rest.length >= 3 && rest.endsWith('en') && lemmatize(rest) === rest) {
        prefix = p;
        base = rest;
        break;
      }
    }
  }

  return (text: string) => {
    // The separated parts only count when the prefix *and* a base-verb form both
    // appear in this sentence — i.e. the separable verb is actually used here.
    const toks = base ? words(text) : [];
    const splitActive =
      base !== '' && toks.includes(prefix) && toks.some((t) => lemmatize(t) === base);
    return (token: string) => {
      const t = token.toLowerCase();
      if (lemmatize(t) === lemma) return true;
      return splitActive && (t === prefix || lemmatize(t) === base);
    };
  };
}

const WORD_RE = /[\p{L}][\p{L}'’-]*/gu;

/** The words in `text` matched for the card `front` (order preserved). */
export function matchedWords(front: string, text: string): string[] {
  const match = wordMatcher(front)(text);
  return (text.match(WORD_RE) ?? []).filter((w) => match(w));
}
