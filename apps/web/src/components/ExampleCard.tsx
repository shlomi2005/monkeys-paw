// ExampleCard: one cached example wish as a calling card (Req 3.5, 3.6, 3.8).
// A <button>, so Enter and Space both select it. `aria-pressed` carries the highlight for assistive tech.

import { useId } from 'react';
import type { ExampleEntry } from '../api/api-schemas';
import { cx } from './class-names';
import { snippet } from './snippet';
import styles from './ExampleCard.module.css';

export interface ExampleCardProps {
  readonly entry: ExampleEntry;
  readonly index: number;
  readonly selected: boolean;
  readonly onSelect: (entry: ExampleEntry, index: number) => void;
  /** After the Grant, until Rewrite (Req 13.11): `aria-disabled`, and a click does nothing. */
  readonly locked?: boolean;
}

/**
 * The accessible name is the visible text, in the visible order: "Example", the wish snippet, the context snippet. A
 * name that adds or drops words fails WCAG 2.5.3 (Label in Name): a voice user says what is on the card. The whole
 * wish and context are not lost when the snippet cut them: a visually hidden description carries them.
 */
export function ExampleCard({ entry, index, selected, onSelect, locked = false }: ExampleCardProps) {
  const { text, context } = entry.wish;
  const descriptionId = useId();
  const wishLine = snippet(text);
  const contextLine = context !== undefined && context.trim() !== '' ? snippet(context) : null;

  const name = ['Example', wishLine, contextLine].filter((part) => part !== null).join('. ');
  const cleanText = text.replace(/\s+/g, ' ').trim();
  const cleanContext = context?.replace(/\s+/g, ' ').trim() ?? '';
  const cut = wishLine !== cleanText || (contextLine !== null && contextLine !== cleanContext);
  const description = [`Whole wish: ${cleanText}.`, contextLine !== null ? `Context: ${cleanContext}.` : null]
    .filter((part) => part !== null)
    .join(' ');

  return (
    <>
      <button
        type="button"
        className={cx(styles.card, selected && styles.selected)}
        aria-label={name}
        aria-describedby={cut ? descriptionId : undefined}
        aria-pressed={selected}
        aria-disabled={locked ? true : undefined}
        onClick={() => {
          if (!locked) onSelect(entry, index);
        }}
      >
        {/* The spaces keep the words apart where the stylesheet does not make the spans blocks (no CSS, text mode). */}
        <span className={styles.label}>Example</span>{' '}
        <span className={styles.wish}>{wishLine}</span>
        {contextLine !== null && (
          <>
            {' '}
            <span className={styles.context}>{contextLine}</span>
          </>
        )}
      </button>
      {cut && (
        <span id={descriptionId} className={styles.fullText}>
          {description}
        </span>
      )}
    </>
  );
}
