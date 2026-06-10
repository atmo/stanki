import { anwUrl, wiktionaryUrl, vanDaleUrl, type Lookups, type LookupResult } from '@shared/lookup';
import { lemmaCandidates, withArticle } from '@shared/lemma';

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
  onUseLemma?: (lemma: string, frontForm: string) => void; // (bare lemma to look up, front to fill)
}) {
  if (lookups === null) return <p className="muted lk-loading">Looking up “{term}”…</p>;
  const { anw, free } = lookups;
  // Offline base-form readings (huizen -> ["huizen","huis"]; opvallender ->
  // ["opvallen","opvallend"]), each shown with its article for nouns. The user
  // picks which to use; clicking looks the bare lemma up and fills the Front.
  const candidates = front && onUseLemma ? lemmaCandidates(front) : [];
  const choices = candidates.map((c) => ({ lemma: c, label: withArticle(c) }));
  const showChoices =
    choices.length > 1 ||
    (choices.length === 1 && choices[0].label.toLowerCase() !== (front ?? '').trim().toLowerCase());
  return (
    <div className="lookup-results">
      {showChoices && (
        <div className="lk-baseforms">
          <span className="muted small">Base form:</span>
          {choices.map((c) => (
            <button key={c.lemma} className="lk-baseform" onClick={() => onUseLemma!(c.lemma, c.label)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {anw ? (
        <Section label="ANW" result={anw} url={anwUrl(anw.lemma)} />
      ) : (
        <p className="muted small">No ANW entry for “{term}”.</p>
      )}
      {free ? (
        <Section label="Wiktionary (EN)" result={free} url={wiktionaryUrl(free.lemma)} />
      ) : (
        <p className="muted small">No Wiktionary entry for “{term}”.</p>
      )}
      {term && (
        <a className="lk-vd" href={vanDaleUrl(term)} target="_blank" rel="noreferrer">
          Look up in Van Dale ↗
        </a>
      )}
    </div>
  );
}
