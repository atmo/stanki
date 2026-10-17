import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import {
  deleteDeck,
  exportDeck,
  getSettings,
  renameDeck,
  setReviewDirection,
  setDeckDescription,
  setDeckSettings,
  effectiveSettings,
} from '../../db/repo';
import { DEFAULT_SETTINGS, type SrSettings } from '@shared/sm2';
import type { ReviewDirection } from '@shared/types';
import { AutoTextarea } from '../../components/AutoTextarea';
import { SettingsFields } from '../../components/SettingsFields';

/** Everything about a deck that is not one of its cards. Split out so the editor
 * is only the add form and the card list — the two things wanted while actually
 * working through a deck. */
export function DeckSettings() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [globalSettings, setGlobalSettings] = useState<SrSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void getSettings().then(setGlobalSettings);
  }, []);

  const data = useLiveQuery(async () => {
    const deck = await db.decks.get(id);
    const count = await db.cards.where('deckId').equals(id).filter((c) => !c.deleted).count();
    return { deck, count };
  }, [id]);

  async function removeDeck(name: string, count: number) {
    if (!confirm(`Delete deck “${name}” and its ${count} card(s)? This cannot be undone.`)) return;
    await deleteDeck(id);
    navigate('/');
  }

  async function doExport() {
    const bundle = await exportDeck(id);
    const name = bundle.decks[0]?.name ?? 'deck';
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'deck';
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stanki-deck-${slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!data) return <p className="muted">Loading…</p>;
  if (!data.deck) return <p className="muted">Deck not found.</p>;
  const deck = data.deck;

  return (
    <div>
      <div className="row editor-head">
        <input
          className="input title-input"
          value={deck.name}
          onChange={(e) => void renameDeck(id, e.target.value)}
        />
        <Link className="btn" to={`/deck/${id}`}>Cards</Link>
        <Link className="btn" to="/">Done</Link>
      </div>

      <label className="field">
        <span>Review direction</span>
        <select
          className="input"
          value={deck.reviewDirection ?? 'forward'}
          onChange={(e) => void setReviewDirection(id, e.target.value as ReviewDirection)}
        >
          <option value="forward">Front → back</option>
          <option value="reverse">Back → front</option>
          <option value="both">Both ways</option>
        </select>
      </label>

      <label className="field">
        <span>Description</span>
        <AutoTextarea
          className="input"
          placeholder="Optional notes about this deck"
          defaultValue={deck.description ?? ''}
          onBlur={(e) => void setDeckDescription(id, e.target.value)}
        />
      </label>

      <div className="field">
        <label className="checkline">
          <input
            type="checkbox"
            checked={!!deck.settings}
            onChange={(e) =>
              void setDeckSettings(id, e.target.checked ? effectiveSettings(deck, globalSettings) : undefined)
            }
          />
          <span>Custom scheduling &amp; limits for this deck</span>
        </label>
        {deck.settings ? (
          <div className="deck-settings">
            {/* Render the *resolved* set, never the stored object: overrides saved
                before a setting existed lack that key, and the type cannot say so.
                Writing the resolved set back also completes it on the next edit. */}
            <SettingsFields
              value={effectiveSettings(deck, globalSettings)}
              onChange={(key, v) =>
                void setDeckSettings(id, { ...effectiveSettings(deck, globalSettings), [key]: v })
              }
            />
          </div>
        ) : (
          <p className="muted small">Using the global settings.</p>
        )}
      </div>

      <div className="row deck-danger">
        <button className="btn" onClick={() => void doExport()}>Export deck</button>
        <button className="btn btn-danger" onClick={() => void removeDeck(deck.name, data.count)}>
          Delete deck
        </button>
      </div>
    </div>
  );
}
