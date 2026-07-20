import { describe, it, expect } from 'vitest';
import { joinSenses, senseExamples, type LookupResult } from './lookup';

const result: LookupResult = {
  source: 'Wiktionary (EN)',
  lemma: 'lopen',
  senses: [
    { definition: 'to walk', examples: ['Ik loop naar huis.'] },
    { definition: 'to run', examples: ['Hij liep hard.'] },
  ],
};

describe('joinSenses', () => {
  it('joins definitions only, numbered, without examples', () => {
    expect(joinSenses(result)).toBe('1. to walk\n2. to run');
  });

  it('a single sense is not numbered', () => {
    expect(joinSenses({ ...result, senses: [{ definition: 'to walk', examples: ['x'] }] })).toBe(
      'to walk',
    );
  });

  it('null result -> empty string', () => {
    expect(joinSenses(null)).toBe('');
  });
});

describe('senseExamples', () => {
  it('flattens all example sentences across senses', () => {
    expect(senseExamples(result)).toEqual(['Ik loop naar huis.', 'Hij liep hard.']);
  });

  it('null result -> empty array', () => {
    expect(senseExamples(null)).toEqual([]);
  });
});
