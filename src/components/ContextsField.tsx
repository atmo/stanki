import type { CardContext } from '@shared/types';

/** Edit a card's contexts: one editable sentence per row with an ✕ to remove and,
 * if the context was captured from a page, a small link to its source. Plus a
 * button to append a new (empty) one. Shared by the add and edit forms. */
export function ContextsField({
  contexts,
  onChange,
}: {
  contexts: CardContext[];
  onChange: (next: CardContext[]) => void;
}) {
  const set = (i: number, text: string) => onChange(contexts.map((c, j) => (j === i ? { ...c, text } : c)));
  const remove = (i: number) => onChange(contexts.filter((_, j) => j !== i));
  return (
    <div className="contexts-field">
      {contexts.map((c, i) => (
        <div key={i} className="context-row">
          <textarea
            className="input"
            rows={1}
            placeholder="Context sentence"
            value={c.text}
            onChange={(e) => set(i, e.target.value)}
          />
          {c.url && (
            <a className="ctx-src" href={c.url} target="_blank" rel="noreferrer" title={c.url}>
              link
            </a>
          )}
          <button type="button" className="ctx-x" aria-label="Remove context" onClick={() => remove(i)}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-add-ctx" onClick={() => onChange([...contexts, { text: '' }])}>
        + Add context
      </button>
    </div>
  );
}
