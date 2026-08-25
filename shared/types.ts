// Core domain types shared between the PWA and the browser extension.

export type Grade = 'again' | 'good' | 'easy';

// Which way a card is shown during review.
//  forward = prompt with front, guess back; reverse = prompt with back, guess front.
export type CardDirection = 'forward' | 'reverse';
export type ReviewDirection = CardDirection | 'both';

export interface Deck {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  reviewDirection?: ReviewDirection; // default 'forward'
  description?: string; // optional free-text notes about the deck
  settings?: SrSettings; // per-deck scheduling/limit overrides; absent = use global
  deleted?: boolean; // soft-delete tombstone for sync convergence
}

/** Spaced-repetition tuning. Held globally, optionally overridden per deck. */
export interface SrSettings {
  startingEase: number; // default 2.5
  easyBonus: number; // multiplier applied to interval on "easy"
  easyFirstInterval: number; // days a new card jumps to when graded "easy"
  againInterval: number; // minutes to wait after "again" (min 1)
  newCardsPerDay: number; // max brand-new cards introduced per deck per day
  maxReviewsPerDay: number; // max review (non-new) cards per deck per day
}

/** A captured usage sentence, optionally with the page URL it came from. A
 * capture with no sentence stores a descriptive `text` (e.g. the page title). */
export interface CardContext {
  text: string;
  url?: string;
  addedAt?: number;
}

/** Legacy provenance shape (pre-fold); read only for migration/import. */
export interface CardSource {
  url: string;
  title: string;
  addedAt: number;
}

// SM-2 scheduling state for one review direction.
export interface CardSchedule {
  interval: number; // days until next review (fraction of a day for sub-day lapses)
  easeFactor: number; // starts at 2.5
  repetitions: number; // consecutive correct count
  dueDate: number; // epoch ms
}

export interface Card extends CardSchedule {
  id: string;
  deckId: string;
  front: string;
  back: string; // definitions, with any dictionary examples inline
  explanation?: string; // dictionary explanation (e.g. ANW), filled via lookup
  contexts?: CardContext[]; // captured sentences (+ their URL), one per capture (accumulate)
  // Legacy shapes, read via cardContexts() and migrated away locally: string[]
  // contexts, the retired separate sources[], and the older single fields.
  sources?: CardSource[];
  context?: string;
  examples?: string[];
  source?: CardSource;
  // Monotonic authority for `contexts`: on merge, a higher `rev` *replaces* it
  // (rather than unioning), so an authoritative import/restore can drop entries.
  // Equal `rev` still unions, so normal accumulation works.
  rev?: number;

  // Inline CardSchedule fields above are the *forward* schedule (prompt = front).
  reverse?: CardSchedule; // independent schedule for the reverse direction (prompt = back)

  createdAt: number;
  updatedAt: number; // last edit OR last review (drives LWW merge)
  deleted?: boolean; // tombstone
}

/**
 * Captured contexts as {text, url?} objects, folding every legacy shape:
 * already-migrated objects pass through; older `string[]` contexts pair with the
 * retired `sources[]` by index (a leftover source with no sentence becomes a
 * url-only context whose text is the source title); the oldest single
 * `context`/`source` and retired `examples[]` fold in too. De-duped by text.
 */
export function cardContexts(
  card: Pick<Card, 'contexts' | 'context' | 'examples' | 'sources' | 'source'>,
): CardContext[] {
  const raw = card.contexts as CardContext[] | string[] | undefined;
  if (raw && raw.length && typeof raw[0] === 'object') {
    return dedupeContexts(raw as CardContext[]);
  }
  const texts = [
    ...((raw as string[] | undefined) ?? []),
    ...(card.examples ?? []),
    ...(card.context ? [card.context] : []),
  ];
  const srcs = card.sources ?? (card.source ? [card.source] : []);
  const out: CardContext[] = [];
  for (let i = 0; i < Math.max(texts.length, srcs.length); i++) {
    const text = texts[i];
    const s = srcs[i];
    if (text != null) out.push({ text, ...(s ? { url: s.url, addedAt: s.addedAt } : {}) });
    else if (s) out.push({ text: s.title || s.url, url: s.url, addedAt: s.addedAt });
  }
  return dedupeContexts(out);
}

function dedupeContexts(list: CardContext[]): CardContext[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = c.text.trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * One recorded change to the scheduling settings. Reviews only say what the
 * scheduler did, never what it was configured to do, so without this a later
 * analysis cannot tell which regime a stretch of study was produced under —
 * or whether changing a limit actually helped.
 */
export interface SettingsChange {
  ts: number;
  deckId?: string; // absent = the global set
  changes: Record<string, [from: number | undefined, to: number | undefined]>;
}

export interface ReviewLog {
  id: string;
  cardId: string;
  ts: number;
  grade: Grade;
  prevInterval: number;
  newInterval: number;
  direction?: CardDirection; // omitted on old logs == forward
  // All added after the fact, hence optional: mergeReviews never rewrites an
  // existing entry, so logs written earlier keep their original shape forever
  // and every reader must tolerate these being absent.
  deckId?: string; // denormalized — survives the card being moved or deleted
  prevDue?: number; // scheduled due date, so lateness = ts - prevDue
  prevEase?: number; // ease factor before this review
  reps?: number; // consecutive successes before this review
  thinkMs?: number; // shown -> answer revealed (recall latency)
  durationMs?: number; // shown -> graded
  schedVer?: number; // SCHEDULER_VERSION that produced this schedule
  posInSession?: number; // 1-based position within the sitting, for fatigue analysis
  overLimit?: boolean; // studied past the daily cap, rather than inside it
}

export const SCHEMA_VERSION = 1 as const;

// One snapshot file per deck, stored in Google Drive's appDataFolder.
export interface DeckSnapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  deck: Deck;
  cards: Card[]; // includes tombstones
  exportedAt: number;
  deviceId: string;
}

// A single shared file holding recent review-log entries across all decks, so
// the per-day new/review limits are tracked across devices. Kept separate from
// the per-deck snapshots (which the extension rewrites) so it is never clobbered.
export interface ReviewSnapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  reviews: ReviewLog[]; // recent only — trimmed to a rolling window on upload
  exportedAt: number;
  deviceId: string;
}

// The special deck the extension appends captured words to.
export const INBOX_DECK_ID = 'inbox';
export const INBOX_DECK_NAME = 'Inbox';
