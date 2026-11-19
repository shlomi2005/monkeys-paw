// ExampleCard: one cached example wish as a calling card (Req 3.5, 3.6, 3.8).
// A <button>, so Enter and Space both select it. `aria-pressed` carries the highlight for assistive tech.

import type { ExampleEntry } from '../api/api-schemas';
import { cx } from './class-names';
import { snippet } from './snippet';
import styles from './ExampleCard.module.css';

export interface ExampleCardProps {
  readonly entry: ExampleEntry;
  readonly index: number;
  readonly selected: boolean;
  readonly onSelect: (entry: ExampleEntry, index: number) => void;
}

export function ExampleCard({ entry, index, selected, onSelect }: ExampleCardProps) {
  const { text, context } = entry.wish;
  return (
    <button
      type="button"
      className={cx(styles.card, selected && styles.selected)}
      aria-label={`Example wish: ${text}`}
      aria-pressed={selected}
      onClick={() => onSelect(entry, index)}
    >
      <span className={styles.label}>Example</span>
      <span className={styles.wish}>{snippet(text)}</span>
      {context !== undefined && context.trim() !== '' && <span className={styles.context}>{snippet(context)}</span>}
    </button>
  );
}
