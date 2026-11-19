import type { PawContext } from '../state/paw-machine-types';
import { fingerText } from '../state/paw-selectors';
import styles from './PawStateText.module.css';

export interface PawStateTextProps {
  readonly ctx: PawContext;
  readonly className?: string;
}

/**
 * The paw's text equivalent: a visible engraved caption under the paw ("3 fingers curled."). It is the cue for
 * reduced motion and for the no-WebGL case (Req 2.9, 2.10, 8.2). It is not a live region: LiveRegion carries the
 * announcements.
 */
export function PawStateText({ ctx, className }: PawStateTextProps) {
  return (
    <p className={className ? `${styles.caption} ${className}` : styles.caption} data-paw-state-text>
      {fingerText(ctx)}
    </p>
  );
}
