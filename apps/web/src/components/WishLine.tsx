// WishLine: the ruled band under the plate (paw-web design.md section 1, Req 3.1 to 3.3).
// A controlled <form>: the parent owns the text and the context and wires `onSubmit` to the session (task 27).

import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { EMPTY_WISH_MESSAGE, PAW_STIRS_MESSAGE, WISH_SENT_TO_GEMINI_MESSAGE } from '../api/api-messages';
import type { Notice } from '../state/use-paw-session';
import { cx } from './class-names';
import styles from './WishLine.module.css';

/** The server sets no limit. These keep a pasted essay out of the model prompt. */
const WISH_MAX_LENGTH = 500;
const CONTEXT_MAX_LENGTH = 200;

export interface WishLineProps {
  readonly text: string;
  readonly context: string;
  readonly onTextChange: (text: string) => void;
  readonly onContextChange: (context: string) => void;
  /** Called only for a non-blank wish while not granting. The parent reads its own `text` and `context`. */
  readonly onSubmit: () => void;
  /** A Grant is on its way: the controls are disabled and the status line shows "The Paw stirs…". */
  readonly granting: boolean;
  /** The session's in-character line. Rendered as text only. */
  readonly notice: Notice | null;
}

export function WishLine({
  text,
  context,
  onTextChange,
  onContextChange,
  onSubmit,
  granting,
  notice,
}: WishLineProps) {
  const ids = useId();
  const wishId = `${ids}-wish`;
  const contextId = `${ids}-context`;
  const messageId = `${ids}-message`;
  const noteId = `${ids}-note`;
  const inputRef = useRef<HTMLInputElement>(null);

  const [blankTried, setBlankTried] = useState(false);
  const [open, setOpen] = useState(context !== '');
  const [previousContext, setPreviousContext] = useState(context);
  if (context !== previousContext) {
    // The collapsed field cannot be typed in, so a change here comes from the parent (an example was picked).
    // Show it, so the user sees what will be sent.
    setPreviousContext(context);
    if (context !== '') setOpen(true);
  }

  const blank = text.trim() === '';
  const showBlank = blankTried && blank;
  const message = showBlank ? EMPTY_WISH_MESSAGE : (notice?.text ?? null);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (granting) return;
    if (blank) {
      setBlankTried(true);
      inputRef.current?.focus();
      return;
    }
    setBlankTried(false);
    onSubmit();
  }

  return (
    <form className={styles.band} onSubmit={handleSubmit} noValidate>
      {/* DOM order is the tab order (Req 8.1): wish, "for…" disclosure and context, then the seal.
          CSS grid areas put the seal at the end of the wish row. No positive tabindex. */}
      <label className={styles.prefix} htmlFor={wishId}>
        I wish that…
      </label>
      <input
        ref={inputRef}
        id={wishId}
        className={styles.wishInput}
        type="text"
        aria-label="I wish that"
        aria-invalid={showBlank ? true : undefined}
        aria-describedby={message === null ? noteId : `${messageId} ${noteId}`}
        autoComplete="off"
        maxLength={WISH_MAX_LENGTH}
        value={text}
        disabled={granting}
        onChange={(event) => onTextChange(event.target.value)}
      />

      {/* Where the wish goes (Req 3.9). Not focusable. The wish input is described by it, after the message. */}
      <p id={noteId} className={styles.note}>
        {WISH_SENT_TO_GEMINI_MESSAGE}
      </p>

      <div className={styles.contextRow}>
        <button
          className={styles.disclosure}
          type="button"
          aria-expanded={open}
          aria-controls={open ? contextId : undefined}
          disabled={granting}
          onClick={() => setOpen((value) => !value)}
        >
          for… (optional context)
        </button>
        {open && (
          <input
            id={contextId}
            className={styles.contextInput}
            type="text"
            aria-label="for…"
            autoComplete="off"
            maxLength={CONTEXT_MAX_LENGTH}
            value={context}
            disabled={granting}
            onChange={(event) => onContextChange(event.target.value)}
          />
        )}
      </div>

      <button className={styles.seal} type="submit" aria-label="Make the wish" disabled={granting}>
        Make the wish
      </button>

      <p
        id={messageId}
        className={cx(styles.message, notice?.kind === 'error' && !showBlank && styles.error)}
        role={showBlank ? 'alert' : undefined}
      >
        {message}
      </p>

      <p className={styles.status} role="status">
        {granting ? PAW_STIRS_MESSAGE : ''}
      </p>
    </form>
  );
}
