// Word-lookup providers for the in-page "Look up" bubble.
//
// Primary:  ANW (Algemeen Nederlands Woordenboek) — authoritative, monolingual
//           Dutch definitions. Its /backend/search endpoint returns JSON with a
//           short gloss ("snippet") per sense — perfect for a compact bubble.
// Fallback: freedictionaryapi.com (Wiktionary data) — English glosses of Dutch
//           words plus Dutch examples, for words ANW doesn't cover.
//
// Fetched from the background service worker, whose host_permissions bypass CORS.

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

// Normalize a selection to a single lookup term (first word, trimmed of punctuation).
function firstWord(s: string): string {
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
  return { source: 'ANW', lemma: article.lemma ?? word, senses: senses.slice(0, 12) };
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
  return { source: 'Wiktionary (EN)', lemma: data.word ?? word, senses: senses.slice(0, 8) };
}

/** Look up a word: ANW first, then the Wiktionary-based fallback. */
export async function lookupWord(raw: string): Promise<LookupResult | null> {
  const word = firstWord(raw);
  if (!word) return null;
  try {
    const anw = await lookupAnw(word);
    if (anw) return anw;
  } catch {
    /* fall through to fallback */
  }
  try {
    return await lookupFreeDict(word);
  } catch {
    return null;
  }
}
