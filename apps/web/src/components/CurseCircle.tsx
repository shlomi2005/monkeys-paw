import { useId } from 'react';
import type { CSSProperties } from 'react';
import type { Curse } from 'paw-core';
import type { CircleIndex, CircleView } from '../state/paw-selectors';
import { curseTypeLabel } from '../state/paw-selectors';
import { LaurelWreath, VignetteFrame, WaxSeal } from './CircleArt';
import { circlePosition } from './circle-layout';
import styles from './CurseCircle.module.css';
import { cx } from './class-names';

export interface CurseCircleProps {
  readonly view: CircleView;
  /** The Grant's curse at this index. Absent for an empty circle. */
  readonly curse: Curse | undefined;
  /**
   * Called with the circle index when the button is activated (click, Enter, Space). The component never decides
   * whether a card opens: the reducer does. The one exception is an arriving circle, which is `aria-disabled`.
   */
  readonly onActivate: (index: CircleIndex) => void;
}

/** Unit-radius offsets from the paw centre. The stylesheet multiplies them by --ring-rx and --ring-ry. */
function slotStyle(index: CircleIndex): CSSProperties {
  const unit = circlePosition(index, 1, 1);
  return { '--dx': Math.round(unit.x * 10000) / 10000, '--dy': Math.round(unit.y * 10000) / 10000 } as CSSProperties;
}

/**
 * One slot of the ring. Empty: a blank parchment disc that is `aria-hidden` and not focusable. Filled: one `<button>`
 * (disc with vignette, type label, seal or laurel) plus the story caption beside or below it (design decision A3).
 */
export function CurseCircle({ view, curse, onActivate }: CurseCircleProps) {
  const base = useId();
  const storyId = `${base}-story`;
  const loopholeId = `${base}-loophole`;
  const style = slotStyle(view.index);

  if (view.status === 'empty' || curse === undefined) {
    return (
      <li className={styles.slot} style={style} data-index={view.index} data-status="empty" aria-hidden="true">
        <span className={cx(styles.disc, styles.blank)} />
      </li>
    );
  }

  const { status } = view;
  const arriving = status === 'arriving';
  const sealClass = status === 'closed' ? styles.sealPress : status === 'open-final' ? styles.sealCrack : undefined;

  return (
    <li className={styles.slot} style={style} data-index={view.index} data-status={status}>
      <button
        type="button"
        className={styles.button}
        aria-label={view.ariaLabel}
        aria-describedby={`${storyId} ${loopholeId}`}
        aria-disabled={arriving ? true : undefined}
        onClick={() => {
          if (!arriving) onActivate(view.index);
        }}
      >
        <span className={styles.disc}>
          {/* The ink layer is mounted when the curse arrives, so its fill animation (centre outwards) runs once. */}
          <span className={styles.ink}>
            <VignetteFrame />
            {status === 'closed' ? <LaurelWreath /> : null}
            <span className={cx(styles.sealSlot, sealClass)}>
              <WaxSeal state={status === 'open-final' ? 'cracked' : 'sealed'} />
            </span>
          </span>
        </span>
        <span className={styles.label}>{curseTypeLabel(curse.type)}</span>
      </button>
      <div className={styles.caption}>
        <p className={styles.story} id={storyId}>
          {curse.story}
        </p>
        <span hidden id={loopholeId}>
          {curse.loophole}
        </span>
        {status === 'open-final' ? <p className={styles.remembers}>The paw remembers.</p> : null}
      </div>
    </li>
  );
}
