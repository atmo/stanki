import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { createCard, ensureInboxDeck, getLastAddDeck, setLastAddDeck } from '../../db/repo';
import { lookupWord, anwExplanation, joinSenses, type Lookups } from '@shared/lookup';
import { lemmatize } from '@shared/lemma';
import { dedupKey } from '@shared/dedup';
import type { CardContext } from '@shared/types';
import { LookupResults } from '../lookup/LookupResults';
import { ContextsField } from '../../components/ContextsField';
import { AutoTextarea } from '../../components/AutoTextarea';
import { Toast, useToast } from '../../components/Toast';

export function AddWord() {
  const [params] = useSearchParams();
  const sharedText = (params.get('text') ?? '').trim();

  const [front, setFront] = useState(sharedText);
  const [back, setBack] = useState('');
  const [explanation, setExplanation] = useState('');
  const initialContext = (params.get('context') ?? '').trim();
  const [contexts, setContexts] = useState<CardContext[]>(initialContext ? [{ text: initialContext }] : []);
  const [deckId, setDeckId] = useState('');
  const [lookupTerm, setLookupTerm] = useState(sharedText);
  const [lookups, setLookups] = useState<Lookups | null>(lookupTerm ? null : { anw: null, free: null });
  const [frontFocused, setFrontFocused] = useState(false);
  // Adding is a run, not a single act: the form stays put and a corner notice
  // confirms the word, rather than a screen that has to be dismissed before the
  // next one can be typed. The notice names the deck too, since that is the one
  // thing a saved card can quietly get wrong.
  const { toast, showToast, dismissToast } = useToast();
  const frontRef = useRef<HTMLInputElement>(null);

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
      // Dictionary examples stay inline in the back; the examples array is for
      // sentences captured from real pages by the extension.
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
      contexts: contexts.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text),
    });
    await setLastAddDeck(deckId);
    showToast(front.trim(), `Added to ${deckName(deckId)}`);
    reset();
    frontRef.current?.focus();
  }

  // Save from anywhere in the form. The textareas need plain Enter for newlines,
  // so the commit key is the usual ⌘/Ctrl+Enter. Guarded by the same condition as
  // the button, so the shortcut can't save a card the button would refuse.
  function onFormKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    if (!front.trim() || !deckId) return;
    e.preventDefault();
    void save();
  }

  /** Clear the fields for the next word, keeping the deck. */
  function reset() {
    setFront('');
    setBack('');
    setExplanation('');
    setContexts([]);
    setLookupTerm('');
    setLookups({ anw: null, free: null });
  }

  const term = lemmatize(lookupTerm || front);

  return (
    <div className="add-screen">
      <Toast toast={toast} onDismiss={dismissToast} />
      <h2 className="add-title">Add word</h2>

      <div className="card-form" onKeyDown={onFormKeyDown}>
        <div className="ac-wrap">
          <div className="row">
            <input
              ref={frontRef}
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
        <AutoTextarea className="input" placeholder="Back (answer / translation)" value={back} onChange={(e) => setBack(e.target.value)} />
        <AutoTextarea className="input" placeholder="Explanation" value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        <ContextsField contexts={contexts} onChange={setContexts} />
        <div className="row">
          <select className="input sel-move" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            {decks?.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <button
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={!front.trim() || !deckId}
            title="⌘↵ / Ctrl+↵"
          >
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
