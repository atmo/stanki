import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a notice stays up. Long enough to read the word it names without
 * having to catch it, short enough not to sit over the next card. */
const TOAST_MS = 6000;

export type ToastMsg = { front: string; why: string };

/**
 * A non-blocking corner notice: it names the card it is about and goes away on
 * its own. A toast rather than a modal because these fire many times in a
 * sitting, and blocking each time would undo the very interruption the rest of
 * the flow is built to avoid.
 *
 * The timer is a ref, not state, so re-rendering the screen underneath never
 * restarts it, and a second notice replaces the first rather than queueing —
 * the latest word is the one worth reading.
 */
export function useToast(ms = TOAST_MS) {
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const showToast = useCallback(
    (front: string, why: string) => {
      setToast({ front, why });
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setToast(null), ms);
    },
    [ms],
  );
  const dismissToast = useCallback(() => setToast(null), []);

  return { toast, showToast, dismissToast };
}

/** Renders nothing until there is something to say. Tap to dismiss early. */
export function Toast({ toast, onDismiss }: { toast: ToastMsg | null; onDismiss: () => void }) {
  if (!toast) return null;
  return (
    <div className="toast" role="status" onClick={onDismiss}>
      <strong className="toast-front">{toast.front}</strong>
      <span className="toast-why">{toast.why}</span>
    </div>
  );
}
