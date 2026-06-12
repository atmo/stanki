import { describe, it, expect } from 'vitest';
import { lemmatize, lemmaCandidates, nounArticle, withArticle } from './lemma';

describe('lemmatize', () => {
  it('verb present-tense -t -> infinitive', () => {
    expect(lemmatize('loopt')).toBe('lopen');
    expect(lemmatize('werkt')).toBe('werken');
    expect(lemmatize('maakt')).toBe('maken');
    expect(lemmatize('hoort')).toBe('horen');
  });

  it('past participle -> infinitive', () => {
    expect(lemmatize('gewerkt')).toBe('werken');
    expect(lemmatize('gemaakt')).toBe('maken');
    expect(lemmatize('gehoord')).toBe('horen');
  });

  it('strong verbs and suppletives', () => {
    expect(lemmatize('liep')).toBe('lopen');
    expect(lemmatize('gelopen')).toBe('lopen');
    expect(lemmatize('is')).toBe('zijn');
    expect(lemmatize('heeft')).toBe('hebben');
    expect(lemmatize('ging')).toBe('gaan');
  });

  it('plurals -> singular', () => {
    expect(lemmatize('mannen')).toBe('man');
    expect(lemmatize('brieven')).toBe('brief');
    expect(lemmatize('kinderen')).toBe('kind');
    expect(lemmatize('eieren')).toBe('ei');
  });

  it('diminutives -> base', () => {
    expect(lemmatize('huisje')).toBe('huis');
    expect(lemmatize('boekje')).toBe('boek');
    expect(lemmatize("auto's")).toBe('auto');
  });

  it('follows the map transitively (comparative participle -> verb)', () => {
    expect(lemmatize('opvallend')).toBe('opvallen');
    expect(lemmatize('opvallende')).toBe('opvallen');
    expect(lemmatize('opvallender')).toBe('opvallen');
    expect(lemmatize('opvallendste')).toBe('opvallen');
    // Inflected participle whose -e form lives only in a form-of entry.
    expect(lemmatize('aanhoudend')).toBe('aanhouden');
    expect(lemmatize('aanhoudende')).toBe('aanhouden');
  });

  it('leaves infinitives and bare lemmas unchanged', () => {
    expect(lemmatize('lopen')).toBe('lopen'); // verb default (also a noun plural)
    expect(lemmatize('werken')).toBe('werken');
    expect(lemmatize('huis')).toBe('huis');
    expect(lemmatize('kat')).toBe('kat');
  });

  it('normalizes case and whitespace', () => {
    expect(lemmatize('  Mannen ')).toBe('man');
  });
});

describe('lemmaCandidates', () => {
  it('offers verb vs. noun-plural readings, default first', () => {
    expect(lemmaCandidates('huizen')).toEqual(['huizen', 'huis']);
    expect(lemmaCandidates('lopen')).toEqual(['lopen', 'loop']);
    expect(lemmaCandidates('werken')).toEqual(['werken', 'werk']);
  });

  it('offers each step of a reduction chain, then the original (most-reduced first)', () => {
    expect(lemmaCandidates('opvallender')).toEqual(['opvallen', 'opvallend', 'opvallender']);
  });

  it('candidates[0] matches lemmatize', () => {
    for (const w of ['opvallender', 'huizen', 'mannen', 'loopt', 'huis']) {
      expect(lemmaCandidates(w)[0]).toBe(lemmatize(w));
    }
  });

  it('always includes the original form as a choice', () => {
    expect(lemmaCandidates('mannen')).toEqual(['man', 'mannen']);
    expect(lemmaCandidates('loopt')).toEqual(['lopen', 'loopt']);
  });

  it('collapses to one when the base form is the original with no homograph', () => {
    expect(lemmaCandidates('venster')).toEqual(['venster']);
  });

  it('offers a protected noun plus its verb homograph (noun stays default)', () => {
    // "wens" is the noun (de wens) and the 1sg of the verb "wensen" — offer both.
    expect(lemmaCandidates('wens')).toEqual(['wens', 'wensen']);
    expect(lemmatize('wens')).toBe('wens'); // default stays the headword
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
