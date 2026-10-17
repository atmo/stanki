import { describe, it, expect } from 'vitest';
import { hostOf, registrableDomain, contextSite, contextDisplay, withoutFragment, sameDocument } from './weburl';

describe('hostOf', () => {
  it('reads an absolute url', () => {
    expect(hostOf('https://nos.nl/artikel/123')).toBe('nos.nl');
  });

  it('does not mistake a scheme for a host', () => {
    // Prefixing https:// onto an absolute url parses as hostname "https", so the
    // raw form has to be tried first.
    expect(hostOf('https://old.reddit.com/r/x')).toBe('old.reddit.com');
  });

  it('reads a bare host, and drops www', () => {
    expect(hostOf('nos.nl')).toBe('nos.nl');
    expect(hostOf('www.nrc.nl/a')).toBe('nrc.nl');
  });

  it('reads a host with a note after it', () => {
    expect(hostOf('nos.nl — item over de woningmarkt')).toBe('nos.nl');
  });

  it('returns null for prose rather than throwing', () => {
    expect(hostOf('NOS — item over de woningmarkt')).toBeNull();
    expect(hostOf('localhost')).toBeNull();
    expect(hostOf('')).toBeNull();
  });
});

describe('registrableDomain', () => {
  it('keeps two labels and trims deeper ones', () => {
    expect(registrableDomain('nos.nl')).toBe('nos.nl');
    expect(registrableDomain('old.reddit.com')).toBe('reddit.com');
    expect(registrableDomain('zoek.officielebekendmakingen.nl')).toBe('officielebekendmakingen.nl');
  });

  it('allows for two-label suffixes', () => {
    expect(registrableDomain('blog.example.co.uk')).toBe('example.co.uk');
  });

  it('keeps the project name on a hosting suffix', () => {
    // github.io is itself a public suffix: the site is the label in front of it.
    expect(registrableDomain('atmo.github.io')).toBe('atmo.github.io');
  });

  it('leaves an IP address whole', () => {
    expect(registrableDomain('1.2.3.4')).toBe('1.2.3.4');
  });
});

describe('contextSite', () => {
  it('groups by the display url, not the real one', () => {
    // The point of displayUrl: an archive mirror filed under the source site.
    const c = { text: '', url: 'https://archive.is/aBc12', displayUrl: 'https://nos.nl/artikel/123' };
    expect(contextSite(c)).toBe('nos.nl');
    expect(contextDisplay(c)).toBe('https://nos.nl/artikel/123');
  });

  it('falls back to the real url when no display url is set', () => {
    expect(contextSite({ text: '', url: 'https://at5.nl/x' })).toBe('at5.nl');
  });

  it('is null when there is no host to group on', () => {
    expect(contextSite({ text: '', url: 'https://x.test/a', displayUrl: 'my own notes' })).toBeNull();
  });
});

describe('withoutFragment', () => {
  it('drops a captured-sentence anchor', () => {
    // The extension gives each sentence its own anchor, so one article is stored
    // under as many urls as there are cards citing it.
    expect(withoutFragment('https://archive.ph/JtsB0#selection-1631.54-1631.64'))
      .toBe('https://archive.ph/JtsB0');
  });

  it('leaves a url with no fragment alone, and never returns empty', () => {
    expect(withoutFragment('https://nos.nl/a')).toBe('https://nos.nl/a');
    expect(withoutFragment('#only-a-fragment')).toBe('#only-a-fragment');
  });

  it('treats two captures of one page as the same document', () => {
    expect(sameDocument('https://archive.is/xSQ0q#selection-1.2-1.3',
                        'https://archive.is/xSQ0q#selection-9.9-9.9')).toBe(true);
    expect(sameDocument('https://archive.is/xSQ0q', 'https://archive.is/wGy2V')).toBe(false);
  });

  it('shows the document when no label is set, fragment and all removed', () => {
    expect(contextDisplay({ text: '', url: 'https://archive.ph/JtsB0#selection-1.2-1.3' }))
      .toBe('https://archive.ph/JtsB0');
    // An explicit label is used verbatim — it is the user's text, not a url.
    expect(contextDisplay({ text: '', url: 'https://archive.ph/JtsB0#x', displayUrl: 'NRC — huizen' }))
      .toBe('NRC — huizen');
  });
});
