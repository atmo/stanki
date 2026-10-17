import type { CardContext } from './types';

// Suffixes that are themselves two labels, so the registrable domain needs a
// third. Not a public suffix list — just the ones likely to turn up here. A
// miss only ever over-splits a group, and a display url can override it.
const MULTI_SUFFIX = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'co.za', 'co.jp', 'co.kr', 'co.il',
  'com.br', 'com.mx', 'com.tr', 'com.cn', 'co.in', 'com.sg',
  // Hosting suffixes, where the interesting part is the label in front: without
  // these, every project page collapses into one "github.io" heap.
  'github.io', 'pages.dev', 'vercel.app', 'netlify.app',
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Hostname of something that may or may not be a url. A display url is free
 * text, so this has to cope with a bare host, a host with a note after it, or
 * prose — returning null rather than throwing when there is no host to find.
 */
export function hostOf(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // The raw form first: prefixing a scheme onto an already-absolute url parses
  // as hostname "https". Then a bare host, then its first word, so a label like
  // "nos.nl - item over X" still files under the site.
  for (const candidate of [s, `https://${s}`, `https://${s.split(/\s/)[0]}`]) {
    try {
      const h = new URL(candidate).hostname.toLowerCase().replace(/^www\./, '');
      if (h.includes('.')) return h; // "https", "localhost" and prose have none
    } catch {
      /* not a url in this form; try the next */
    }
  }
  return null;
}

/** The part of a host that names the site: `old.reddit.com` -> `reddit.com`. */
export function registrableDomain(host: string): string {
  if (IPV4.test(host)) return host; // 1.2.3.4 is not "3.4"
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  return MULTI_SUFFIX.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

/**
 * A link without its `#fragment`. The extension anchors each captured sentence
 * with one (`#selection-1631.54-1631.64`), so every card citing the same page
 * stores a different url: 249 archive links on cards are 17 actual articles. An
 * index of links wants the article, and relabelling one should cover them all.
 * The fragment stays on the card, so a card's own link still jumps to its
 * sentence.
 */
export const withoutFragment = (u: string): string => u.split('#')[0] || u;

/** Whether two links point at the same document, fragments aside. */
export const sameDocument = (a: string, b: string): boolean =>
  withoutFragment(a) === withoutFragment(b);

/** What to show for a context's link, and what grouping is keyed on. */
export const contextDisplay = (c: CardContext): string =>
  (c.displayUrl ?? withoutFragment(c.url ?? '')).trim();

/** Which site group a context's link belongs to, or null if it has no host. */
export function contextSite(c: CardContext): string | null {
  const host = hostOf(contextDisplay(c));
  return host && registrableDomain(host);
}
