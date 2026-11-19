import type { Medal } from '../state/paw-selectors';
import styles from './IntegrityMedal.module.css';
import { cx } from './class-names';

/** One laurel per point of the score, always five. */
const LAUREL_COUNT = 5;

const round = (n: number): number => Math.round(n * 100) / 100;

/** Two sprigs climbing from the bottom centre of a 40 unit box, like the wreath on a closed circle. */
const LEAVES = [-1, 1].flatMap((side) =>
  Array.from({ length: 5 }, (_, t) => {
    const deg = 180 + side * (22 + t * 24);
    const rad = (deg * Math.PI) / 180;
    const x = round(20 + 14 * Math.sin(rad));
    const y = round(20 - 14 * Math.cos(rad));
    return { key: `${side}-${t}`, x, y, rotate: round(deg + 90 - side * 28), scale: round(1 - t * 0.06) };
  }),
);

function Laurel({ filled }: { readonly filled: boolean }) {
  return (
    <svg
      className={cx(styles.laurel, filled ? styles.filled : styles.outlined)}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
      data-laurel={filled ? 'filled' : 'outlined'}
    >
      {LEAVES.map((leaf) => (
        <ellipse
          key={leaf.key}
          className={styles.leaf}
          cx={leaf.x}
          cy={leaf.y}
          rx={round(2.4 * leaf.scale)}
          ry={round(5.2 * leaf.scale)}
          transform={`rotate(${leaf.rotate} ${leaf.x} ${leaf.y})`}
        />
      ))}
    </svg>
  );
}

export interface IntegrityMedalProps {
  /** `view.medal`: null until the round has ended and the machine is quiescent. */
  readonly medal: Medal | null;
  readonly className?: string;
}

/**
 * The Wish Integrity medal: five laurels, `medal.score` of them filled, and one polite status line with the exact text
 * "Integrity N/5: M closed, O open" (Req 6.8, 8.4). `selectView` only returns a medal once the round has ended and
 * the animation queue is empty.
 *
 * The status element is always in the DOM, empty while `medal` is null, so the text is inserted into an existing live
 * region and is announced (a region that is mounted together with its content is often not). It keeps the same place
 * in the tree in both states, so React updates its text instead of remounting it. Only the frame and the laurels
 * depend on `medal`. While empty, the root is taken out of the flow and has no size: no visible space, no layout shift.
 */
export function IntegrityMedal({ medal, className }: IntegrityMedalProps) {
  return (
    <div
      className={medal === null ? styles.empty : cx(styles.medal, className)}
      data-medal={medal === null ? undefined : ''}
      data-score={medal === null ? undefined : medal.score}
    >
      {medal === null ? null : (
        <div className={styles.laurels} aria-hidden="true" data-decoration="laurels">
          {Array.from({ length: LAUREL_COUNT }, (_, i) => (
            <Laurel key={i} filled={i < medal.score} />
          ))}
        </div>
      )}
      <p className={styles.text} role="status" aria-live="polite">
        {medal === null ? '' : medal.text}
      </p>
    </div>
  );
}
