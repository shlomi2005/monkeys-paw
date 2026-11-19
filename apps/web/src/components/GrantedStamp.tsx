import type { Grant } from 'paw-core';
import styles from './GrantedStamp.module.css';
import { cx } from './class-names';

export interface GrantedStampProps {
  /** The active Grant, or null: nothing is shown without one. */
  readonly grant: Grant | null;
  /** `session.grantedSeq`. The stamp is a fresh element, and so plays again, whenever this changes. */
  readonly grantedSeq: number;
  readonly reducedMotion: boolean;
  readonly className?: string;
}

/**
 * The red "Granted." stamp and the Genie's narration as an engraved caption (ui-brief moment 1). The stamp text is
 * `aria-hidden`: the live region already says "Granted.". The narration is plain text, so React escapes it.
 */
export function GrantedStamp({ grant, grantedSeq, reducedMotion, className }: GrantedStampProps) {
  if (grant === null) return null;
  return (
    <div
      className={cx(styles.frame, reducedMotion && styles.reduced, className)}
      data-granted-stamp
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
    >
      {/* Keyed on grantedSeq: a new element restarts the CSS animation. */}
      <span
        key={grantedSeq}
        className={cx(styles.stamp, !reducedMotion && styles.animate)}
        aria-hidden="true"
        data-stamp
        data-stamp-seq={grantedSeq}
      >
        Granted.
      </span>
      <p className={styles.caption} data-narration>
        {grant.narration}
      </p>
    </div>
  );
}
