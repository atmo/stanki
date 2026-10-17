import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { cardContexts, type Card } from '@shared/types';
import { contextDisplay, contextSite, withoutFragment } from '@shared/weburl';
import { setLinkDisplay } from '../../db/repo';

interface CardRef {
  id: string;
  deckId: string;
  front: string;
}
interface LinkRow {
  url: string; // the document, fragment stripped — what opens, and what an edit keys on
  label: string; // displayUrl when set, else the url
  cards: CardRef[]; // the cards citing it, for the expandable list
}
interface SiteGroup {
  site: string;
  links: LinkRow[];
}
interface DeckGroup {
  deckId: string;
  deck: string;
  sites: SiteGroup[];
  total: number;
}

const UNGROUPED = 'no site'; // a label with no host to key on

/** Every link on every card, grouped deck -> site -> link. Deduped by address:
 * the collection holds ~770 contexts carrying a url but only ~174 distinct ones,
 * so listing occurrences rather than addresses would be unreadable. */
export function groupLinks(cards: Card[], deckNames: Map<string, string>): DeckGroup[] {
  const byDeck = new Map<string, Map<string, Map<string, LinkRow>>>();
  for (const card of cards) {
    for (const ctx of cardContexts(card)) {
      if (!ctx.url) continue;
      // Keyed on the document, not the captured sentence: the extension anchors
      // each one with its own #selection, so an index keyed on the stored url
      // lists the same article dozens of times and a relabel reaches only one
      // card. The fragment is left on the card itself.
      const doc = withoutFragment(ctx.url);
      const label = contextDisplay(ctx) || doc;
      const site = contextSite(ctx) ?? UNGROUPED;
      let sites = byDeck.get(card.deckId);
      if (!sites) byDeck.set(card.deckId, (sites = new Map()));
      let links = sites.get(site);
      if (!links) sites.set(site, (links = new Map<string, LinkRow>()));
      const ref: CardRef = { id: card.id, deckId: card.deckId, front: card.front };
      const row = links.get(doc);
      // A card can cite the same document from several captured sentences; it is
      // still one card in the list.
      if (row) {
        if (!row.cards.some((c) => c.id === card.id)) row.cards.push(ref);
      } else {
        links.set(doc, { url: doc, label, cards: [ref] });
      }
    }
  }

  const out: DeckGroup[] = [];
  for (const [deckId, sites] of byDeck) {
    const groups: SiteGroup[] = [...sites].map(([site, links]) => ({
      site,
      links: [...links.values()]
        .map((l) => ({ ...l, cards: l.cards.sort((a, b) => a.front.localeCompare(b.front)) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }));
    // Alphabetical, but anything with no site to group on sits at the end.
    groups.sort((a, b) =>
      a.site === UNGROUPED ? 1 : b.site === UNGROUPED ? -1 : a.site.localeCompare(b.site),
    );
    out.push({
      deckId,
      deck: deckNames.get(deckId) ?? 'Unknown deck',
      sites: groups,
      total: groups.reduce((n, g) => n + g.links.length, 0),
    });
  }
  return out.sort((a, b) => a.deck.localeCompare(b.deck));
}

function LinkItem({ row }: { row: LinkRow }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.label);
  const [saved, setSaved] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  async function save() {
    // Typing the address back in clears the label rather than storing a copy.
    const n = await setLinkDisplay(row.url, draft.trim() === row.url ? undefined : draft);
    setSaved(n);
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="link-row">
        <input className="input" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} />
        <button className="btn" onClick={() => void save()}>Save</button>
        <button className="btn" onClick={() => { setDraft(row.label); setEditing(false); }}>Cancel</button>
      </li>
    );
  }

  return (
    <li className="link-row-wrap">
      <div className="link-row">
        <a href={row.url} target="_blank" rel="noreferrer" title={row.url} className="link-label">
          {row.label}
        </a>
        {/* The count opens the cards: which words came out of this page is the
            question the index invites, and the editor's own search can show
            them. */}
        <button className="link-count" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {row.cards.length} card{row.cards.length === 1 ? '' : 's'} {open ? '▾' : '▸'}
        </button>
        {saved !== null && <span className="muted small">relabelled on {saved}</span>}
        <button className="btn btn-tiny" onClick={() => setEditing(true)}>Rename</button>
      </div>
      {open && (
        <ul className="link-cards">
          {row.cards.map((c) => (
            <li key={c.id}>
              {/* ?q= seeds the deck editor's search, so the card is the one
                  thing on screen rather than somewhere in a thousand rows. */}
              <Link to={`/deck/${c.deckId}?q=${encodeURIComponent(c.front)}`}>{c.front}</Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function LinksSection() {
  const [open, setOpen] = useState(false);
  const data = useLiveQuery(async () => {
    const [cards, decks] = await Promise.all([
      db.cards.filter((c) => !c.deleted).toArray(),
      db.decks.filter((d) => !d.deleted).toArray(),
    ]);
    return groupLinks(cards, new Map(decks.map((d) => [d.id, d.name])));
  }, []);

  const total = useMemo(() => (data ?? []).reduce((n, d) => n + d.total, 0), [data]);
  if (!data || total === 0) return null;

  return (
    <section className="panel links-panel">
      <button className="links-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <h2>Links</h2>
        <span className="muted small">
          {total} across {data.length} deck{data.length === 1 ? '' : 's'}
        </span>
        <span className="links-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open &&
        data.map((d) => (
          <div key={d.deckId} className="link-deck">
            <h3>
              {d.deck} <span className="muted small">{d.total}</span>
            </h3>
            {d.sites.map((g) => (
              <div key={g.site} className="link-site">
                <h4>
                  {g.site} <span className="muted small">{g.links.length}</span>
                </h4>
                <ul className="link-list">
                  {g.links.map((row) => (
                    <LinkItem key={row.url} row={row} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
    </section>
  );
}
