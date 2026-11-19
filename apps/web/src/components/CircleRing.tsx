import type { Curse } from 'paw-core';
import type { CircleIndex, CircleView } from '../state/paw-selectors';
import { CIRCLE_INDEXES } from './circle-layout';
import { CurseCircle } from './CurseCircle';
import styles from './CircleRing.module.css';

export interface CircleRingProps {
  /** One view per finger (`PawView.circles`). A missing index renders as an empty circle. */
  readonly circles: readonly CircleView[];
  /** The Grant's curses. Curse i belongs to circle i. Empty when there is no Grant. */
  readonly curses: readonly Curse[];
  readonly onActivate: (index: CircleIndex) => void;
}

const emptyView = (index: CircleIndex): CircleView => ({ index, status: 'empty', ariaLabel: '' });

/**
 * The five curse circles. Desktop (768 px and up): a pentagon around the paw centre, three above its centre line and
 * two below. Mobile: a vertical list under the paw. The DOM order is index 0 to 4 in both, so it is also the tab order.
 *
 * The ring anchors at the centre of its positioned parent, as RayDisc does, so put it in the same box as the paw stage.
 */
export function CircleRing({ circles, curses, onActivate }: CircleRingProps) {
  const views = CIRCLE_INDEXES.map((index) => circles.find((view) => view.index === index) ?? emptyView(index));
  // With nothing to show, the whole ring is decoration: hide it so no empty list is announced.
  const allEmpty = views.every((view) => view.status === 'empty');

  return (
    <ul className={styles.ring} aria-label="Curses" aria-hidden={allEmpty ? true : undefined} data-circle-ring>
      {views.map((view) => (
        <CurseCircle key={view.index} view={view} curse={curses[view.index]} onActivate={onActivate} />
      ))}
    </ul>
  );
}
