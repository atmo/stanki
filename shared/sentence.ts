// Sentence / paragraph extraction for the "add word from webpage" feature.
//
// Rules (per spec):
//   - A *sentence* starts with a capital letter AND ends with a dot.
//   - If the user selected a word  -> Context = the sentence containing it.
//   - If the user selected a whole sentence -> Context = the whole paragraph.
//
// This module is pure (no DOM) so it can be unit-tested in Node and reused by
// both the PWA and the browser extension. The DOM work of finding the enclosing
// block ("paragraph") lives in the extension content script.

export interface Capture {
  word: string; // exactly what the user selected (for highlighting)
  context: string; // sentence or paragraph
}

export function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const STARTS_CAPITAL = /^[\p{Lu}]/u;

/**
 * Does the selected text itself constitute a sentence?
 * Spec definition: starts with a capital letter AND ends with a dot.
 */
export function isSentence(selectedText: string): boolean {
  const s = normalize(selectedText);
  return STARTS_CAPITAL.test(s) && s.endsWith('.');
}

// A sentence within a paragraph: a capital-initial run up to a terminator.
// The spec defines a sentence as ending with a dot; we also tolerate ? ! …
// as terminators so questions/quotes aren't truncated when locating context.
const SENTENCE_RE = /[\p{Lu}][^.?!…]*[.?!…]/gu;

/** Find the sentence inside `paragraph` that contains `word`. */
export function enclosingSentence(word: string, paragraph: string): string {
  const text = normalize(paragraph);
  const needle = normalize(word);
  const matches = [...text.matchAll(SENTENCE_RE)];

  const idx = text.indexOf(needle);
  if (idx >= 0) {
    const hit = matches.find(
      (m) => m.index !== undefined && m.index <= idx && idx < m.index + m[0].length,
    );
    if (hit) return hit[0].trim();
  }

  // Fallbacks: first sentence if any, else the whole (normalized) block.
  if (matches.length > 0) return matches[0][0].trim();
  return text;
}

/**
 * Produce the capture from the user's selection and its enclosing block.
 * @param selectedText  the raw selected string
 * @param blockText     textContent of the nearest block-level ancestor
 */
export function extract(selectedText: string, blockText: string): Capture {
  const word = normalize(selectedText);

  if (isSentence(selectedText)) {
    // The selection is itself a sentence -> context is the whole paragraph.
    return { word, context: normalize(blockText) };
  }

  // Otherwise treat the selection as a word/phrase -> enclosing sentence.
  return { word, context: enclosingSentence(word, blockText) };
}
