import { anwUrl, wiktionaryUrl, vanDaleUrl, firstWord, type Lookups, type LookupResult } from '@shared/lookup';

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

/** Dictionary lookup results (ANW + Wiktionary) shared by the Add and Deck screens. */
export function LookupResults({
  lookups,
  term,
  front,
  onUseLemma,
}: {
  lookups: Lookups | null;
  term: string;
  front?: string; // the current "front" field, to suggest a base form when it differs
  onUseLemma?: (lemma: string) => void;
}) {
  if (lookups === null) return <p className="muted lk-loading">Looking up “{term}”…</p>;
  const { anw, free } = lookups;
  // Canonical headword the dictionary resolved to (ANW preferred). Suggest it as
  // the base form when it differs from what was typed (e.g. huizen -> huis).
  const lemma = anw?.lemma || free?.lemma || '';
  const showBase = !!(lemma && onUseLemma && front && firstWord(front) !== firstWord(lemma));
  return (
    <div className="lookup-results">
      {showBase && (
        <button className="lk-baseform" onClick={() => onUseLemma!(lemma)}>
          Use base form: <b>{lemma}</b>
        </button>
      )}
      {!anw && !free && <p className="muted">No definitions found for “{term}”.</p>}
      {anw ? (
        <Section label="ANW" result={anw} url={anwUrl(anw.lemma)} />
      ) : (
        free && <p className="muted small">No ANW entry for “{term}”.</p>
      )}
      {free && <Section label="Wiktionary (EN)" result={free} url={wiktionaryUrl(free.lemma)} />}
      {term && (
        <a className="lk-vd" href={vanDaleUrl(term)} target="_blank" rel="noreferrer">
          Look up in Van Dale ↗
        </a>
      )}
    </div>
  );
}
