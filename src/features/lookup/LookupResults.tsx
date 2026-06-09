import { anwUrl, wiktionaryUrl, vanDaleUrl, type Lookups, type LookupResult } from '@shared/lookup';

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
export function LookupResults({ lookups, term }: { lookups: Lookups | null; term: string }) {
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
