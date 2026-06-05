import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { createCard, ensureInboxDeck, getLastAddDeck, setLastAddDeck } from '../../db/repo';
import {
  lookupWord,
  anwExplanation,
  anwUrl,
  wiktionaryUrl,
  vanDaleUrl,
  type Lookups,
  type LookupResult,
} from '@shared/lookup';

function Section({ label, result, url }: { label: string; result: LookupResult; url: string }) {
  return (
    <div className="lk-section">
      <div className="lk-head">
        <span>{label}</span>
        <a href={url} target="_blank" rel="noreferrer">open ↗</a>
      </div>
      {result.senses.map((s, i) => (
        <div key={i} className="lk-sense">
          <span className="lk-n">{(s.sense ? s.sense.replace(/\.0$/, '') : String(i + 1))}.</span>
          {s.definition}
          {s.examples?.[0] && <div className="lk-ex">„{s.examples[0]}”</div>}
        </div>
      ))}
    </div>
  );
}

function LookupResults({ lookups, term }: { lookups: Lookups | null; term: string }) {
  if (lookups === null) return <p className="muted lk-loading">Looking up “{term}”…</p>;
  const { anw, free } = lookups;
  return (
    <div className="lookup-results">
      {!anw && !free && <p className="muted">No definitions found for “{term}”.</p>}
      {anw && <Section label="ANW" result={anw} url={anwUrl(anw.lemma)} />}
      {free && <Section label="Wiktionary (EN)" result={free} url={wiktionaryUrl(free.lemma)} />}
      {term && (
        <a className="lk-vd" href={vanDaleUrl(term)} target="_blank" rel="noreferrer">
          Look up in Van Dale ↗
        </a>
      )}
    </div>
  );
}

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

      <LookupResults lookups={lookups} term={term} />
    </div>
  );
}
