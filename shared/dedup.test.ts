import { describe, it, expect } from 'vitest';
import { dedupKey, sameWord } from './dedup';

describe('dedupKey', () => {
  it('strips a leading article and normalizes case/space', () => {
    expect(dedupKey('het huis')).toBe('huis');
    expect(dedupKey('de wens')).toBe('wens');
    expect(dedupKey("'t kind")).toBe('kind');
    expect(dedupKey('een appel')).toBe('appel');
    expect(dedupKey('  Huis ')).toBe('huis');
  });

  it('only strips a leading article, not one mid-phrase', () => {
    expect(dedupKey('rekening houden met')).toBe('rekening houden met');
    expect(dedupKey('het de het')).toBe('de het'); // only the first is dropped
  });

  it('leaves articleless words untouched', () => {
    expect(dedupKey('lopen')).toBe('lopen');
  });
});

describe('sameWord', () => {
  it('matches across articles and case', () => {
    expect(sameWord('het huis', 'Huis')).toBe(true);
    expect(sameWord('de wens', 'wens')).toBe(true);
  });

  it('distinguishes different words', () => {
    expect(sameWord('huis', 'huizen')).toBe(false);
  });

  it('an empty key never matches', () => {
    expect(sameWord('', '')).toBe(false);
    expect(sameWord('  ', 'huis')).toBe(false);
  });
});
