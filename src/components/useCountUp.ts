import { useEffect, useRef, useState } from 'react';

/**
 * Animates an integer from its previous value to `value` (ease-out, ~0.6 s). Presentation only: the final value is
 * always exactly `value`, and with reduced motion it is shown at once.
 */
export function useCountUp(value: number, duration = 650): number {
  const [shown, setShown] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    const from = current.current;
    if (from === value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      current.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - k) ** 3;
      const next = k === 1 ? value : Math.round(from + (value - from) * eased);
      current.current = next;
      setShown(next);
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return shown;
}
