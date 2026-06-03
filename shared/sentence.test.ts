import { describe, it, expect } from 'vitest';
import { isSentence, enclosingSentence, extract, normalize } from './sentence';

const PARAGRAPH =
  'The quick brown fox jumps over the lazy dog. ' +
  'She sells seashells by the seashore. ' +
  'Pack my box with five dozen liquor jugs.';

describe('isSentence', () => {
  it('true when starts capital and ends with dot', () => {
    expect(isSentence('The cat sat.')).toBe(true);
  });
  it('tolerates surrounding whitespace', () => {
    expect(isSentence('   Hello world.  ')).toBe(true);
  });
  it('false when no capital start', () => {
    expect(isSentence('the cat sat.')).toBe(false);
  });
  it('false when no trailing dot', () => {
    expect(isSentence('The cat sat')).toBe(false);
    expect(isSentence('Is it raining?')).toBe(false);
  });
  it('false for a bare word', () => {
    expect(isSentence('seashells')).toBe(false);
  });
});

describe('enclosingSentence', () => {
  it('finds the sentence around a mid-paragraph word', () => {
    expect(enclosingSentence('seashells', PARAGRAPH)).toBe(
      'She sells seashells by the seashore.',
    );
  });
  it('finds a word at the start of a sentence', () => {
    expect(enclosingSentence('Pack', PARAGRAPH)).toBe(
      'Pack my box with five dozen liquor jugs.',
    );
  });
  it('finds a word at the end of a sentence', () => {
    expect(enclosingSentence('dog', PARAGRAPH)).toBe(
      'The quick brown fox jumps over the lazy dog.',
    );
  });
  it('falls back to the whole block when no sentence boundary exists', () => {
    expect(enclosingSentence('lower', 'all lower case no period text')).toBe(
      'all lower case no period text',
    );
  });
  it('keeps question/exclamation sentences intact', () => {
    const p = 'Are you sure? Yes I am.';
    expect(enclosingSentence('sure', p)).toBe('Are you sure?');
  });
});

describe('extract', () => {
  it('word selection -> enclosing sentence as context', () => {
    const { word, context } = extract('seashells', PARAGRAPH);
    expect(word).toBe('seashells');
    expect(context).toBe('She sells seashells by the seashore.');
  });

  it('sentence selection -> whole paragraph as context', () => {
    const sel = 'She sells seashells by the seashore.';
    const { word, context } = extract(sel, PARAGRAPH);
    expect(word).toBe(sel);
    expect(context).toBe(normalize(PARAGRAPH));
  });

  it('collapses messy whitespace from the DOM', () => {
    const messy = 'She sells   seashells\n  by the   seashore.';
    expect(extract('seashells', messy).context).toBe(
      'She sells seashells by the seashore.',
    );
  });
});
