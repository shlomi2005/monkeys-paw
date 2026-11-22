// ExampleCards: the row of example wishes under the wish line (paw-web design.md section 1, Req 3.2, 3.4, 3.7).
// Fed by the session's `ExamplesState`. The region has one fixed height in every state, so loading, ready and
// unavailable never shift the layout. The parent owns the selection and fills the wish line (task 27).

import { EXAMPLES_SLEEPING_MESSAGE } from '../api/api-messages';
import type { ExampleEntry, ExamplesState } from '../api/api-schemas';
import { cx } from './class-names';
import { ExampleCard } from './ExampleCard';
import styles from './ExampleCards.module.css';

export interface ExampleCardsProps {
  readonly state: ExamplesState;
  /** Index of the highlighted card, or null. */
  readonly selectedIndex: number | null;
  /** The user is typing a wish of their own: the row fades until the next submit. */
  readonly dimmed: boolean;
  readonly onSelect: (entry: ExampleEntry, index: number) => void;
  /** After the Grant, until Rewrite (Req 13.11): the cards are `aria-disabled` and do nothing. */
  readonly locked?: boolean;
}

const GHOST_CARDS = [0, 1, 2];

export function ExampleCards({ state, selectedIndex, dimmed, onSelect, locked = false }: ExampleCardsProps) {
  const className = cx(styles.region, dimmed && styles.dimmed);

  if (state.kind === 'loading') {
    return (
      <div className={className} data-state="loading" aria-busy="true">
        <div className={styles.row} aria-hidden="true">
          {GHOST_CARDS.map((key) => (
            <div key={key} className={cx(styles.item, styles.ghost)} />
          ))}
        </div>
      </div>
    );
  }

  if (state.kind === 'unavailable') {
    return (
      <div className={className} data-state="unavailable">
        <div className={styles.row}>
          <p className={cx(styles.item, styles.placeholder)}>{EXAMPLES_SLEEPING_MESSAGE}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={className} data-state="ready">
      <ul className={styles.row} role="list" aria-label="Example wishes">
        {state.entries.map((entry, index) => (
          <li key={`${entry.wish.id}-${index}`} className={styles.item}>
            <ExampleCard entry={entry} index={index} selected={index === selectedIndex} onSelect={onSelect} locked={locked} />
          </li>
        ))}
      </ul>
    </div>
  );
}
