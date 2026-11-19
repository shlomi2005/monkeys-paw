import { useReducedMotion } from '../hooks/use-reduced-motion';
import styles from './Curtain.module.css';
import { cx } from './class-names';

export interface CurtainProps {
  /** Which top corner it hangs in. The right one is the left one mirrored. */
  readonly side: 'left' | 'right';
  readonly className?: string;
}

/** A heavy drape in a top corner. Decoration only: hidden from assistive technology, breathing off under reduced motion. */
export function Curtain({ side, className }: CurtainProps) {
  const reduced = useReducedMotion();
  return (
    <div
      className={cx(styles.curtain, side === 'left' ? styles.left : styles.right, reduced && styles.reduced, className)}
      aria-hidden="true"
      data-decoration="curtain"
      data-reduced-motion={reduced ? 'true' : 'false'}
    >
      <svg className={styles.drape} viewBox="0 0 160 220" focusable="false" aria-hidden="true">
        {/* Body of the drape, swept back to a tie in the lower corner. */}
        <path
          className={styles.cloth}
          d="M0 0 H150 C150 40 120 80 86 110 C62 130 42 150 36 176 C32 196 16 208 0 214 Z"
          strokeWidth="2.5"
        />
        {/* Folds. */}
        <path
          className={styles.fold}
          d="M30 14 C34 66 26 124 18 196 M62 14 C70 60 60 106 40 154 M96 14 C104 52 92 86 70 122 M126 14 C132 40 120 64 104 88"
          fill="none"
          strokeWidth="1.25"
        />
        {/* Valance with a scalloped edge and a blood-red trim. */}
        <path
          className={styles.valance}
          d="M0 0 H160 V14 Q140 26 120 14 Q100 26 80 14 Q60 26 40 14 Q20 26 0 14 Z"
          strokeWidth="2"
        />
        <path className={styles.trim} d="M0 20 Q20 30 40 20 Q60 30 80 20 Q100 30 120 20 Q140 30 160 20" fill="none" strokeWidth="1.5" />
        {/* Tie-back cord and tassel. */}
        <path className={styles.cord} d="M20 168 C36 170 54 174 72 182" fill="none" strokeWidth="2.5" strokeLinecap="round" />
        <path className={styles.tassel} d="M38 172 L33 196 H43 Z" />
        <circle className={styles.knot} cx="38" cy="171" r="3.5" />
      </svg>
    </div>
  );
}
