import { useState } from 'react';
import type { PawContext } from '../state/paw-machine-types';
import { fingerText } from '../state/paw-selectors';
import styles from './PawStateText.module.css';

export interface PawStateTextProps {
  readonly ctx: PawContext;
  readonly className?: string;
}

/** The label that persists under reduced motion, where the finger itself moves at once (Req 8.2). */
type Cue = 'curled' | 'open';

const CUE_TEXT: Readonly<Record<Cue, string>> = {
  curled: 'Finger curled.',
  open: 'Finger open.',
};

/**
 * The paw's text equivalent: a visible engraved caption under the paw ("3 fingers curled."). It is the cue for
 * reduced motion and for the no-WebGL case (Req 2.9, 2.10, 8.2). It is not a live region: LiveRegion carries the
 * announcements.
 *
 * Under reduced motion a second engraved line follows each change of the curled count: "Finger curled." after a curl,
 * "Finger open." after an open. It stays until the next change and is cleared by a rewrite (no Grant). Without reduced
 * motion nothing extra is shown. The preference is `ctx.reducedMotion`, which `SessionProvider` keeps in step with the
 * media query.
 */
export function PawStateText({ ctx, className }: PawStateTextProps) {
  const count = ctx.grant === null ? 0 : ctx.curled.length;
  const reduced = ctx.reducedMotion;

  // The count the cue was last computed for. Derived during render, so the line appears in the same commit as the
  // change and never one frame late.
  const [seen, setSeen] = useState<{ readonly count: number; readonly cue: Cue | null }>({ count, cue: null });
  let cue: Cue | null = seen.cue;
  if (ctx.grant === null || !reduced) cue = null;
  else if (count !== seen.count) cue = count > seen.count ? 'curled' : 'open';
  if (count !== seen.count || cue !== seen.cue) setSeen({ count, cue });

  return (
    <>
      <p className={className ? `${styles.caption} ${className}` : styles.caption} data-paw-state-text>
        {fingerText(ctx)}
      </p>
      {cue !== null && (
        <p className={styles.cue} data-paw-finger-cue>
          {CUE_TEXT[cue]}
        </p>
      )}
    </>
  );
}
