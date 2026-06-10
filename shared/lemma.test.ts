import { describe, it, expect } from 'vitest';
import { lemmatize, nounArticle, withArticle } from './lemma';

describe('lemmatize (UD Dutch map)', () => {
  it('noun plural -> singular', () => {
    expect(lemmatize('huizen')).toBe('huis');
    expect(lemmatize('boeken')).toBe('boek');
    expect(lemmatize('kinderen')).toBe('kind');
    expect(lemmatize('steden')).toBe('stad');
  });

  it('conjugated / participle verb -> infinitive', () => {
    expect(lemmatize('loopt')).toBe('lopen');
    expect(lemmatize('werkt')).toBe('werken');
    expect(lemmatize('gewerkt')).toBe('werken');
    expect(lemmatize('liep')).toBe('lopen');
    expect(lemmatize('gelopen')).toBe('lopen');
  });

  it('inflected adjective -> base', () => {
    expect(lemmatize('mooie')).toBe('mooi');
  });

  it('leaves headwords / unknown words unchanged', () => {
    expect(lemmatize('lopen')).toBe('lopen'); // already a lemma
    expect(lemmatize('huis')).toBe('huis');
    expect(lemmatize('qwxyz')).toBe('qwxyz'); // unknown
  });

  it('normalizes case and whitespace', () => {
    expect(lemmatize('  Huizen ')).toBe('huis');
  });
});

describe('noun articles', () => {
  it('returns de/het for known nouns', () => {
    expect(nounArticle('huis')).toBe('het');
    expect(nounArticle('hond')).toBe('de');
    expect(nounArticle('kind')).toBe('het');
  });

  it('returns null for non-nouns / unknown', () => {
    expect(nounArticle('lopen')).toBeNull();
    expect(nounArticle('qwxyz')).toBeNull();
  });

  it('withArticle prepends the article for nouns only', () => {
    expect(withArticle('huis')).toBe('het huis');
    expect(withArticle('hond')).toBe('de hond');
    expect(withArticle('lopen')).toBe('lopen');
  });
});
