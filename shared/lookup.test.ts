import { describe, it, expect } from 'vitest';
import { joinSenses, type LookupResult } from './lookup';

const result: LookupResult = {
  source: 'Wiktionary (EN)',
  lemma: 'lopen',
  senses: [
    { definition: 'to walk', examples: ['Ik loop naar huis.'] },
    { definition: 'to run', examples: ['Hij liep hard.'] },
  ],
};

describe('joinSenses', () => {
  it('numbers the definitions and keeps each example inline under it', () => {
    expect(joinSenses(result)).toBe('1. to walk\n„Ik loop naar huis.”\n2. to run\n„Hij liep hard.”');
  });

  it('a single sense is not numbered', () => {
    expect(joinSenses({ ...result, senses: [{ definition: 'to walk', examples: [] }] })).toBe(
      'to walk',
    );
  });

  it('null result -> empty string', () => {
    expect(joinSenses(null)).toBe('');
  });
});
