import type { SrSettings } from '@shared/sm2';

/** The scheduling + daily-limit inputs, shared by global Settings and the
 * per-deck override editor. Purely controlled: it renders `value` and reports
 * each change via `onChange`. */
export function SettingsFields({ value: s, onChange }: { value: SrSettings; onChange: <K extends keyof SrSettings>(key: K, v: SrSettings[K]) => void }) {
  return (
    <>
      <label className="field">
        <span>Starting ease ({s.startingEase.toFixed(2)})</span>
        <input type="range" min={1.3} max={3.5} step={0.1} value={s.startingEase}
          onChange={(e) => onChange('startingEase', Number(e.target.value))} />
      </label>
      <label className="field">
        <span>Easy bonus ({s.easyBonus.toFixed(2)}×)</span>
        <input type="range" min={1} max={2} step={0.05} value={s.easyBonus}
          onChange={(e) => onChange('easyBonus', Number(e.target.value))} />
      </label>
      <label className="field">
        <span>Easy first interval (days)</span>
        <input type="number" className="input" min={1} max={365} value={s.easyFirstInterval}
          onChange={(e) => onChange('easyFirstInterval', Math.max(1, Math.round(Number(e.target.value))))} />
      </label>
      <label className="field">
        <span>Again interval (minutes)</span>
        <input type="number" className="input" min={1} max={1440} value={s.againInterval}
          onChange={(e) => onChange('againInterval', Math.max(1, Math.round(Number(e.target.value))))} />
      </label>
      <label className="field">
        <span>Hard multiplier ({s.hardMultiplier.toFixed(2)}×)</span>
        <input type="range" min={1} max={2} step={0.05} value={s.hardMultiplier}
          onChange={(e) => onChange('hardMultiplier', Number(e.target.value))} />
      </label>
      <label className="field">
        <span>Leech threshold (lapses, 0 = off)</span>
        <input type="number" className="input" min={0} max={50} value={s.leechThreshold}
          onChange={(e) => onChange('leechThreshold', Math.max(0, Math.round(Number(e.target.value))))} />
      </label>
      <label className="checkline">
        <input type="checkbox" checked={s.bothDirectionsPerSession}
          onChange={(e) => onChange('bothDirectionsPerSession', e.target.checked)} />
        <span>Show both directions in one session</span>
      </label>
      <p className="muted small">
        Off, a card's two sides are split across two sittings. On, everything due is one queue —
        but seeing a card's reverse after its forward is an easier test.
      </p>
      <label className="field">
        <span>Cards before a missed card returns</span>
        <input type="number" className="input" min={0} max={500} value={s.againGapCards}
          onChange={(e) => onChange('againGapCards', Math.max(0, Math.round(Number(e.target.value))))} />
      </label>
      <label className="field">
        <span>Misses per day before leaving it until tomorrow</span>
        <input type="number" className="input" min={1} max={20} value={s.againMaxPerDay}
          onChange={(e) => onChange('againMaxPerDay', Math.max(1, Math.round(Number(e.target.value))))} />
      </label>
      <label className="field">
        <span>New cards / day</span>
        <input type="number" className="input" min={0} max={500} value={s.newCardsPerDay}
          onChange={(e) => onChange('newCardsPerDay', Math.max(0, Math.round(Number(e.target.value))))} />
      </label>
      <label className="field">
        <span>Max reviews / day</span>
        <input type="number" className="input" min={0} max={9999} value={s.maxReviewsPerDay}
          onChange={(e) => onChange('maxReviewsPerDay', Math.max(0, Math.round(Number(e.target.value))))} />
      </label>
    </>
  );
}
