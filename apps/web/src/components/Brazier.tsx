import { useReducedMotion } from '../hooks/use-reduced-motion';
import styles from './Brazier.module.css';
import { cx } from './class-names';

export interface BrazierProps {
  /** Which plate edge it stands on. The right one is the left one mirrored. */
  readonly side: 'left' | 'right';
  readonly className?: string;
}

/** A smoking brazier on a plate edge. Decoration only: hidden from assistive technology, loop off under reduced motion. */
export function Brazier({ side, className }: BrazierProps) {
  const reduced = useReducedMotion();
  return (
    <div
      className={cx(styles.brazier, side === 'left' ? styles.left : styles.right, reduced && styles.reduced, className)}
      aria-hidden="true"
      data-decoration="brazier"
      data-reduced-motion={reduced ? 'true' : 'false'}
    >
      <svg viewBox="0 0 100 200" focusable="false" aria-hidden="true">
        {/* Smoke: three wisps, offset in time so they never rise together. */}
        <g fill="none" strokeLinecap="round">
          <path
            className={cx(styles.smoke, styles.smokeA)}
            d="M50 72 C42 60 58 50 48 38 C40 28 54 20 50 8"
            strokeWidth="2.5"
          />
          <path className={cx(styles.smoke, styles.smokeB)} d="M43 72 C35 62 47 54 39 44" strokeWidth="2" />
          <path className={cx(styles.smoke, styles.smokeC)} d="M57 72 C65 60 53 52 61 40" strokeWidth="2" />
        </g>
        {/* Embers: the one touch of blood red. */}
        <ellipse className={styles.ember} cx="50" cy="78" rx="21" ry="4.5" />
        <circle className={styles.ember} cx="40" cy="73" r="1.8" />
        <circle className={styles.ember} cx="58" cy="72" r="1.5" />
        {/* Bowl, with engraved hatching. */}
        <path className={styles.bowl} d="M18 78 H82 C82 102 66 116 50 116 C34 116 18 102 18 78 Z" strokeWidth="3" />
        <path
          className={styles.hatch}
          d="M27 86 C32 100 42 108 50 110 M36 84 C39 96 45 104 50 106 M73 86 C68 100 58 108 50 110 M64 84 C61 96 55 104 50 106"
          fill="none"
          strokeWidth="1"
        />
        <path className={styles.rim} d="M13 78 H87" strokeWidth="5" strokeLinecap="round" />
        {/* Stem with two rings, and a tripod foot. */}
        <path className={styles.bowl} d="M44 116 H56 V152 H44 Z" strokeWidth="2.5" />
        <path className={styles.rim} d="M40 126 H60 M41 140 H59" strokeWidth="4" strokeLinecap="round" />
        <path className={styles.foot} d="M44 150 H56 L74 194 H64 L50 162 L36 194 H26 Z" />
        <path className={styles.rim} d="M22 194 H78" strokeWidth="4" strokeLinecap="round" />
      </svg>
    </div>
  );
}
