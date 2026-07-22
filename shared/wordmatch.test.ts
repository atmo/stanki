import { describe, it, expect } from 'vitest';
import { matchedWords, NO_MATCH } from './wordmatch';

describe('wordMatcher — simple words', () => {
  it('matches an inflected form and the infinitive', () => {
    expect(matchedWords('lopen', 'Ik liep gisteren hard')).toEqual(['liep']);
    expect(matchedWords('lopen', 'We gaan lopen')).toEqual(['lopen']);
  });

  it('is case-insensitive and catches every occurrence', () => {
    expect(matchedWords('lopen', 'LIEP hij? Hij loopt en liep weer')).toEqual(['LIEP', 'loopt', 'liep']);
  });

  it('ignores unrelated words', () => {
    expect(matchedWords('lopen', 'Het huis is groot')).toEqual([]);
  });

  it('strips a leading article from the front (noun cards)', () => {
    expect(matchedWords('het huis', 'Het huis is mooi')).toEqual(['huis']);
  });

  it('matches nothing for phrase (multi-word) fronts', () => {
    expect(matchedWords('rekening houden met', 'Je moet rekening houden met hem')).toEqual([]);
  });

  it('matches nothing for an empty or too-short front', () => {
    expect(matchedWords('', 'wat dan ook')).toEqual([]);
    expect(matchedWords('a', 'a b c')).toEqual([]);
  });
});

describe('wordMatcher — separable verbs', () => {
  it('masks the prefix and the base verb when both occur, but not "te"', () => {
    expect(matchedWords('aanhouden', 'Ik probeer hem aan te houden')).toEqual(['aan', 'houden']);
  });

  it('catches the conjugated split form (prefix + finite base verb)', () => {
    expect(matchedWords('aanhouden', 'De politie hield hem aan')).toEqual(['hield', 'aan']);
    expect(matchedWords('opnemen', 'Neem de telefoon op')).toEqual(['Neem', 'op']);
  });

  it('does NOT mask the base verb when the prefix is absent (a different verb)', () => {
    expect(matchedWords('aanhouden', 'Ik wil het geld houden')).toEqual([]);
  });

  it('does NOT mask a stray prefix/preposition when the base verb is absent', () => {
    expect(matchedWords('aanhouden', 'De deur staat aan')).toEqual([]);
  });

  it('matches the joined infinitive and participle on their own', () => {
    expect(matchedWords('aanhouden', 'Ik moet hem aanhouden')).toEqual(['aanhouden']);
    expect(matchedWords('aanhouden', 'Hij werd aangehouden')).toEqual(['aangehouden']);
  });

  it('does not mask a standalone base verb sitting next to the joined form', () => {
    expect(matchedWords('opnemen', 'geld opnemen en iets nemen')).toEqual(['opnemen']);
  });

  it('prefers the longest prefix (tegemoet, not toe/tegen)', () => {
    expect(matchedWords('tegemoetkomen', 'Ik zal je tegemoet komen')).toEqual(['tegemoet', 'komen']);
  });

  it('handles mee-nemen', () => {
    expect(matchedWords('meenemen', 'Wil je dit mee nemen')).toEqual(['mee', 'nemen']);
  });
});

describe('wordMatcher — separable verb sharing a sentence with its base verb', () => {
  it('joined form + a standalone base verb: only the joined form is masked', () => {
    // No standalone prefix token, so the split never activates and the plain
    // "houden" (a different verb) is safe.
    expect(matchedWords('aanhouden', 'Ik wil hem aanhouden maar het geld houden')).toEqual([
      'aanhouden',
    ]);
  });

  it('KNOWN LIMIT: split form + standalone base verb over-masks the base verb', () => {
    // Once prefix + a base form co-occur the split activates, so *every* base
    // form is masked — including the unrelated standalone one. Safe for a spoiler
    // (it only ever hides more), just imperfect; true fixing needs parsing.
    expect(matchedWords('aanhouden', 'Ik probeer hem aan te houden en het geld te houden')).toEqual([
      'aan',
      'houden',
      'houden',
    ]);
    expect(matchedWords('aanhouden', 'De agent houdt hem aan terwijl wij het geld houden')).toEqual([
      'houdt',
      'aan',
      'houden',
    ]);
  });
});

describe('wordMatcher — no false separable split', () => {
  it('a noun starting with a prefix string is not split', () => {
    expect(matchedWords('aanbod', 'Het aanbod is goed')).toEqual(['aanbod']);
    expect(matchedWords('aanbod', 'kijk eens aan de kant')).toEqual([]); // stray "aan" not masked
  });

  it('a plain motion verb is not treated as separable', () => {
    // "lopen" starts with no prefix; only its own forms match.
    expect(matchedWords('lopen', 'De loop van de rivier')).toEqual([]); // "loop" (noun) ≠ lemma
  });
});

describe('NO_MATCH', () => {
  it('never matches', () => {
    expect(NO_MATCH('any sentence')('any')).toBe(false);
  });
});
