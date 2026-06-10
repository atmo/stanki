// Word-lookup providers, shared by the extension bubble and the PWA "Add word"
// screen.
//
// Primary:  ANW (Algemeen Nederlands Woordenboek) — authoritative, monolingual
//           Dutch definitions. Its /backend/search endpoint returns JSON with a
//           short gloss ("snippet") per sense.
// Fallback: freedictionaryapi.com (Wiktionary data) — English glosses of Dutch
//           words plus Dutch examples, for words ANW doesn't cover.
//
// All three sources send permissive CORS headers, so this works both from the
// extension background (host_permissions) and directly from the PWA in-browser.

export interface Sense {
  sense?: string; // e.g. "1.0"
  definition: string;
  examples?: string[];
}

export interface LookupResult {
  source: string; // 'ANW' | 'Wiktionary (EN)'
  lemma: string;
  senses: Sense[];
}

export interface Lookups {
  anw: LookupResult | null;
  free: LookupResult | null;
}

// External "full entry" links.
export const anwUrl = (lemma: string) => `https://anw.ivdnt.org/article/${encodeURIComponent(lemma)}`;
export const wiktionaryUrl = (word: string) =>
  `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}#Dutch`;
export const vanDaleUrl = (term: string) =>
  `https://zoeken.vandale.nl/?query=${encodeURIComponent(term)}`;

/** Normalize a selection to a single lookup term (first word, trimmed of punctuation). */
export function firstWord(s: string): string {
  const cleaned = s.trim().toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  return cleaned.split(/\s+/)[0] ?? '';
}

interface AnwSearch {
  articleResults?: Array<{
    lemma: string;
    results?: Array<{ articlePart?: string; senseNumber?: string; snippet?: string }>;
  }>;
}

async function lookupAnw(word: string): Promise<LookupResult | null> {
  const url =
    'https://anw.ivdnt.org/backend/search?searchtype=' +
    encodeURIComponent(`funqy:search_form('${word}')`) +
    '&output=json';
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = (await res.json()) as AnwSearch;
  const articles = data.articleResults ?? [];
  if (!articles.length) return null;

  // Prefer the exact-lemma article; otherwise the top hit (handles inflections).
  const article = articles.find((a) => a.lemma?.toLowerCase() === word) ?? articles[0];

  const senses: Sense[] = [];
  for (const r of article.results ?? []) {
    if (r.articlePart === 'Betekenis' && r.snippet) {
      senses.push({ sense: r.senseNumber, definition: r.snippet });
    }
  }
  if (!senses.length) return null;
  return { source: 'ANW', lemma: article.lemma ?? word, senses: senses.slice(0, 10) };
}

interface FreeDict {
  word?: string;
  entries?: Array<{ senses?: Array<{ definition?: string; examples?: string[] }> }>;
}

async function lookupFreeDict(word: string): Promise<LookupResult | null> {
  const res = await fetch(`https://freedictionaryapi.com/api/v1/entries/nl/${encodeURIComponent(word)}`);
  if (!res.ok) return null;

  const data = (await res.json()) as FreeDict;
  const senses: Sense[] = [];
  for (const e of data.entries ?? []) {
    for (const s of e.senses ?? []) {
      if (s.definition) senses.push({ definition: s.definition, examples: (s.examples ?? []).slice(0, 1) });
    }
  }
  if (!senses.length) return null;
  return { source: 'Wiktionary (EN)', lemma: data.word ?? word, senses: senses.slice(0, 6) };
}

/** Look up a word in both sources (ANW + Wiktionary) in parallel. */
export async function lookupWord(raw: string): Promise<Lookups> {
  const word = firstWord(raw);
  if (!word) return { anw: null, free: null };
  const [anw, free] = await Promise.all([
    lookupAnw(word).catch(() => null),
    lookupFreeDict(word).catch(() => null),
  ]);
  return { anw, free };
}

/** Join ANW senses into a single explanation string (one per line). */
export function anwExplanation(anw: LookupResult | null): string {
  if (!anw) return '';
  return anw.senses
    .map((s, i) => `${s.sense ? s.sense.replace(/\.0$/, '') : String(i + 1)}. ${s.definition}`)
    .join('\n');
}

/** All of a result's sense definitions joined (one per line; numbered if many). */
export function joinSenses(result: LookupResult | null): string {
  if (!result) return '';
  const ss = result.senses;
  if (ss.length <= 1) return ss[0]?.definition ?? '';
  return ss.map((s, i) => `${i + 1}. ${s.definition}`).join('\n');
}
