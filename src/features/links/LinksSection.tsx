import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { cardContexts, type Card } from '@shared/types';
import { contextDisplay, contextSite } from '@shared/weburl';
import { setLinkDisplay } from '../../db/repo';

interface LinkRow {
  url: string; // the real address — what opens, and the key an edit applies to
  label: string; // displayUrl when set, else the url
  cards: number; // how many cards cite it
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
      const label = contextDisplay(ctx) || ctx.url;
      const site = contextSite(ctx) ?? UNGROUPED;
      let sites = byDeck.get(card.deckId);
      if (!sites) byDeck.set(card.deckId, (sites = new Map()));
      let links = sites.get(site);
      if (!links) sites.set(site, (links = new Map<string, LinkRow>()));
      const row = links.get(ctx.url);
      if (row) row.cards++;
      else links.set(ctx.url, { url: ctx.url, label, cards: 1 });
    }
  }

  const out: DeckGroup[] = [];
  for (const [deckId, sites] of byDeck) {
    const groups: SiteGroup[] = [...sites].map(([site, links]) => ({
      site,
      links: [...links.values()].sort((a, b) => a.label.localeCompare(b.label)),
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
    <li className="link-row">
      <a href={row.url} target="_blank" rel="noreferrer" title={row.url} className="link-label">
        {row.label}
      </a>
      <span className="muted small">
        {row.cards} card{row.cards === 1 ? '' : 's'}
        {saved !== null && ` · relabelled on ${saved}`}
      </span>
      <button className="btn btn-tiny" onClick={() => setEditing(true)}>Rename</button>
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
