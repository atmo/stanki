import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { createCard, ensureInboxDeck, getLastAddDeck, setLastAddDeck } from '../../db/repo';
import { lookupWord, anwExplanation, joinSenses, type Lookups } from '@shared/lookup';
import { lemmatize } from '@shared/lemma';
import { dedupKey } from '@shared/dedup';
import { LookupResults } from '../lookup/LookupResults';

export function AddWord() {
  const [params] = useSearchParams();
  const sharedText = (params.get('text') ?? '').trim();

  const [front, setFront] = useState(sharedText);
  const [back, setBack] = useState('');
  const [explanation, setExplanation] = useState('');
  const [context, setContext] = useState((params.get('context') ?? '').trim());
  const [deckId, setDeckId] = useState('');
  const [lookupTerm, setLookupTerm] = useState(sharedText);
  const [lookups, setLookups] = useState<Lookups | null>(lookupTerm ? null : { anw: null, free: null });
  const [saved, setSaved] = useState(false);
  const [frontFocused, setFrontFocused] = useState(false);

  const decks = useLiveQuery(async () => {
    await ensureInboxDeck();
    return (await db.decks.filter((d) => !d.deleted).toArray()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, []);

  // All existing cards, for duplicate detection / autocomplete as the user types.
  const existing = useLiveQuery(
    () =>
      db.cards
        .filter((c) => !c.deleted)
        .toArray()
        .then((cs) => cs.map((c) => ({ id: c.id, front: c.front, deckId: c.deckId }))),
    [],
  );

  // Existing entries whose word matches what's being typed (article-insensitive):
  // a substring match for autocomplete, plus the exact matches that are true dups.
  const deckName = (id: string) => decks?.find((d) => d.id === id)?.name ?? '';
  const frontKey = dedupKey(front);
  const matches =
    frontKey.length >= 2 && existing
      ? existing
          .filter((c) => dedupKey(c.front).includes(frontKey))
          .sort((a, b) => {
            const ak = dedupKey(a.front);
            const bk = dedupKey(b.front);
            const ae = Number(ak.startsWith(frontKey));
            const be = Number(bk.startsWith(frontKey));
            return be - ae || ak.localeCompare(bk);
          })
          .slice(0, 6)
      : [];
  const exact = matches.filter((c) => dedupKey(c.front) === frontKey);

  // Default the deck to the last one used (else the first deck).
  useEffect(() => {
    if (!decks || deckId) return;
    void getLastAddDeck().then((last) => {
      setDeckId((last && decks.some((d) => d.id === last) ? last : decks[0]?.id) ?? '');
    });
  }, [decks, deckId]);

  // Run the lookup and pre-fill empty fields from it.
  useEffect(() => {
    if (!lookupTerm) {
      setLookups({ anw: null, free: null });
      return;
    }
    let cancelled = false;
    setLookups(null);
    void lookupWord(lookupTerm).then((l) => {
      if (cancelled) return;
      setLookups(l);
      setBack((p) => p || joinSenses(l.free));
      setExplanation((p) => p || anwExplanation(l.anw));
    });
    return () => {
      cancelled = true;
    };
  }, [lookupTerm]);

  async function save() {
    if (!front.trim() || !deckId) return;
    await createCard({
      deckId,
      front: front.trim(),
      back: back.trim(),
      explanation: explanation.trim() || undefined,
      context: context.trim() || undefined,
    });
    await setLastAddDeck(deckId);
    setSaved(true);
  }

  function reset() {
    setSaved(false);
    setFront('');
    setBack('');
    setExplanation('');
    setContext('');
    setLookupTerm('');
    setLookups({ anw: null, free: null });
  }

  if (saved) {
    return (
      <div className="add-done">
        <h2>✓ Added</h2>
        <p className="muted">“{front}” saved to {decks?.find((d) => d.id === deckId)?.name}.</p>
        <div className="row">
          <Link className="btn btn-primary" to="/">Done</Link>
          <button className="btn" onClick={reset}>Add another</button>
        </div>
      </div>
    );
  }

  const term = lemmatize(lookupTerm || front);

  return (
    <div className="add-screen">
      <h2 className="add-title">Add word</h2>

      <div className="card-form">
        <div className="ac-wrap">
          <div className="row">
            <input
              className="input"
              placeholder="Front (word)"
              value={front}
              onChange={(e) => setFront(e.target.value)}
              onFocus={() => setFrontFocused(true)}
              onBlur={() => setTimeout(() => setFrontFocused(false), 150)}
            />
            <button className="btn" type="button" onClick={() => setLookupTerm(front.trim())} disabled={!front.trim()}>
              Look up
            </button>
          </div>
          {frontFocused && matches.length > 0 && (
            <ul className="ac-list">
              {matches.map((c) => (
                <li key={c.id}>
                  <Link className="ac-item" to={`/deck/${c.deckId}`}>
                    <span className="ac-front">{c.front}</span>
                    <span className="ac-deck">{deckName(c.deckId)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {exact.length > 0 && (
          <p className="dup-warn">
            ⚠ Already in {[...new Set(exact.map((c) => deckName(c.deckId)))].join(', ')} —{' '}
            <Link to={`/deck/${exact[0].deckId}`}>edit instead?</Link>
          </p>
        )}
        <textarea className="input" placeholder="Back (answer / translation)" rows={2} value={back} onChange={(e) => setBack(e.target.value)} />
        <textarea className="input" placeholder="Explanation" rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        <textarea className="input" placeholder="Context" rows={2} value={context} onChange={(e) => setContext(e.target.value)} />
        <div className="row">
          <select className="input sel-move" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            {decks?.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={() => void save()} disabled={!front.trim() || !deckId}>
            Save
          </button>
          <Link className="btn" to="/">Cancel</Link>
        </div>
      </div>

      <LookupResults
        lookups={lookups}
        term={term}
        front={front}
        onUseLemma={(lemma, frontForm) => {
          setFront(frontForm);
          setLookupTerm(lemma);
        }}
      />
    </div>
  );
}
