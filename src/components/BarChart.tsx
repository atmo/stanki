/** One column of a bar chart: its height, its colour, its axis labels, and the
 * text shown on top when the number itself needs formatting (a percentage, say). */
export type Bar = {
  value: number;
  cls: string;
  title: string;
  label: string;
  sub: string;
  text?: string;
};

/** A single-series vertical-bar chart; every panel's chart shares it. Columns
 * carry their own label/sub so day, week and month axes all render the same way.
 * Value on top of each bar; exact detail on hover. */
export function BarChart({ bars, max, className = '' }: { bars: Bar[]; max: number; className?: string }) {
  return (
    <div className={`bar-chart ${className}`}>
      {bars.map((b, i) => (
        <div className="bar-col" key={i} title={b.title}>
          <div className="bar-stack">
            {b.value > 0 ? (
              <>
                <span className="bar-value">{b.text ?? b.value}</span>
                <div className={`bar-seg ${b.cls}`} style={{ height: `${(b.value / max) * 85}%` }} />
              </>
            ) : null}
          </div>
          <span className="bar-day">{b.label}</span>
          <span className="bar-month">{b.sub}</span>
        </div>
      ))}
    </div>
  );
}
