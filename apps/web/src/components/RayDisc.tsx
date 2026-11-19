import { useState } from 'react';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import styles from './RayDisc.module.css';
import { cx } from './class-names';

export interface RayDiscProps {
  /** Change this value to play the pulse once. The value seen on mount does not pulse. */
  readonly pulseKey?: string | number;
  readonly className?: string;
}

/**
 * A blood-red ray disc centred behind the paw. It centres itself in its positioned parent and is sized from the
 * shared --paw-size. Decoration only.
 */
export function RayDisc({ pulseKey, className }: RayDiscProps) {
  const reduced = useReducedMotion();
  // Count key changes (state adjusted during render, no effect needed). The count keys the disc element.
  const [seen, setSeen] = useState({ key: pulseKey, pulses: 0 });
  if (seen.key !== pulseKey) setSeen({ key: pulseKey, pulses: seen.pulses + 1 });
  const pulsing = !reduced && seen.pulses > 0;

  return (
    <div
      className={cx(styles.frame, reduced && styles.reduced, className)}
      aria-hidden="true"
      data-decoration="ray-disc"
      data-reduced-motion={reduced ? 'true' : 'false'}
    >
      {/* A fresh element per pulse restarts the CSS animation. */}
      <div
        key={seen.pulses}
        className={cx(styles.disc, pulsing && styles.pulse)}
        data-pulse={pulsing ? 'true' : 'false'}
        data-pulse-count={seen.pulses}
      />
    </div>
  );
}
