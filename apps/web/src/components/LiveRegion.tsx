import { useState } from 'react';
import styles from './LiveRegion.module.css';

/** Appended to every other message so a repeated line still changes the DOM text. It is silent in a screen reader. */
export const LIVE_REPEAT_MARK = '\u200B';

export interface LiveRegionProps {
  /** `session.liveText`. */
  readonly text: string;
  /** `session.liveSeq`. Changes with every message, even when the text repeats. */
  readonly seq: number;
}

/**
 * The one polite live region (design.md section 7). Visually hidden, atomic. A screen reader only announces a change
 * of the DOM text, so when a new message (a new `seq`) has the same text as the last, a trailing zero-width space is
 * toggled to make the text differ.
 */
export function LiveRegion({ text, seq }: LiveRegionProps) {
  // Flip on every new message (state adjusted during render, no effect needed).
  const [seen, setSeen] = useState({ seq, marked: false });
  if (seen.seq !== seq) setSeen({ seq, marked: !seen.marked });

  const shown = text !== '' && seen.marked ? `${text}${LIVE_REPEAT_MARK}` : text;
  return (
    <div className={styles.visuallyHidden} aria-live="polite" aria-atomic="true" data-live-region>
      {shown}
    </div>
  );
}
