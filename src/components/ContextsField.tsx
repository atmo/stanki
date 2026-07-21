/** Edit a card's context sentences: one editable row each with an ✕ to remove,
 * plus a button to append a new (empty) one. Shared by the add and edit forms. */
export function ContextsField({
  contexts,
  onChange,
}: {
  contexts: string[];
  onChange: (next: string[]) => void;
}) {
  const set = (i: number, value: string) => onChange(contexts.map((c, j) => (j === i ? value : c)));
  const remove = (i: number) => onChange(contexts.filter((_, j) => j !== i));
  return (
    <div className="contexts-field">
      {contexts.map((c, i) => (
        <div key={i} className="context-row">
          <textarea
            className="input"
            rows={1}
            placeholder="Context sentence"
            value={c}
            onChange={(e) => set(i, e.target.value)}
          />
          <button type="button" className="ctx-x" aria-label="Remove context" onClick={() => remove(i)}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-add-ctx" onClick={() => onChange([...contexts, ''])}>
        + Add context
      </button>
    </div>
  );
}
