import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { createCard, ensureInboxDeck, getLastAddDeck, setLastAddDeck } from '../../db/repo';
import { lookupWord, anwExplanation, type Lookups } from '@shared/lookup';
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

  const decks = useLiveQuery(async () => {
    await ensureInboxDeck();
    return (await db.decks.filter((d) => !d.deleted).toArray()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, []);

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
      setBack((p) => p || (l.free?.senses[0]?.definition ?? ''));
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

  const term = lookups?.anw?.lemma || lookups?.free?.lemma || lookupTerm || front;

  return (
    <div className="add-screen">
      <h2 className="add-title">Add word</h2>

      <div className="card-form">
        <div className="row">
          <input
            className="input"
            placeholder="Front (word)"
            value={front}
            onChange={(e) => setFront(e.target.value)}
          />
          <button className="btn" type="button" onClick={() => setLookupTerm(front.trim())} disabled={!front.trim()}>
            Look up
          </button>
        </div>
        <input className="input" placeholder="Back (answer / translation)" value={back} onChange={(e) => setBack(e.target.value)} />
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
        onUseLemma={(lemma) => {
          setFront(lemma);
          setLookupTerm(lemma);
        }}
      />
    </div>
  );
}
