// WishLine: the ruled band under the plate (paw-web design.md section 1, Req 3.1 to 3.3).
// A controlled <form>: the parent owns the text and the context and wires `onSubmit` to the session (task 27).

import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ADULT_LABEL,
  ADULT_REQUIRED_MESSAGE,
  EMPTY_WISH_MESSAGE,
  OUTSIDE_NOTE_MESSAGE,
  PAW_STIRS_MESSAGE,
  SEAL_USED_MESSAGE,
  WISH_SENT_TO_GEMINI_MESSAGE,
} from '../api/api-messages';
import type { Notice, SubmitOutcome } from '../state/use-paw-session';
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
  /**
   * Called only for a non-blank wish while neither granting nor sealed. The parent reads its own `text` and `context`.
   * `adult-required` asks for the age alert and focus on the checkbox (Req 13.3).
   */
  readonly onSubmit: () => SubmitOutcome | void;
  /** A Grant is on its way: the controls are disabled and the status line shows "The Paw stirs…". */
  readonly granting: boolean;
  /** The session's in-character line. Rendered as text only. */
  readonly notice: Notice | null;
  /** Live wishes are outside (Req 13.6): no checkbox, and the outside note replaces the privacy note. */
  readonly outside: boolean;
  /** The 18+ tick (Req 13.2). */
  readonly adultConfirmed: boolean;
  readonly onAdultChange: (value: boolean) => void;
  /** After the Grant, until Rewrite (Req 13.11): an inert seal, `readOnly` inputs and an `aria-disabled` checkbox. */
  readonly sealed: boolean;
}

export function WishLine({
  text,
  context,
  onTextChange,
  onContextChange,
  onSubmit,
  granting,
  notice,
  outside,
  adultConfirmed,
  onAdultChange,
  sealed,
}: WishLineProps) {
  const ids = useId();
  const wishId = `${ids}-wish`;
  const contextId = `${ids}-context`;
  const messageId = `${ids}-message`;
  const noteId = `${ids}-note`;
  const adultId = `${ids}-adult`;
  const usedId = `${ids}-used`;
  const inputRef = useRef<HTMLInputElement>(null);
  const adultRef = useRef<HTMLInputElement>(null);

  const [blankTried, setBlankTried] = useState(false);
  // Set when a live wish was made without the tick. It ends when the box is ticked or a wish goes out.
  const [adultTried, setAdultTried] = useState(false);
  const [focusAdult, setFocusAdult] = useState(false);
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
  // The server's 403 `adult_confirmation_required` unticks the box and sends the same line as a notice (Req 13.5).
  const showAdult = !outside && !adultConfirmed && !showBlank && (adultTried || notice?.text === ADULT_REQUIRED_MESSAGE);
  // A blank wish keeps priority over the age alert. A notice wins the message row over the \"Granted already\" line.
  const message = showBlank ? EMPTY_WISH_MESSAGE : showAdult ? ADULT_REQUIRED_MESSAGE : (notice?.text ?? null);
  const shown = message ?? (sealed ? SEAL_USED_MESSAGE : null);
  const alertRole = showBlank || (showAdult && adultTried);

  // Focus moves to the checkbox only for the age alert, after the alert is in the DOM.
  useEffect(() => {
    if (!focusAdult) return;
    setFocusAdult(false);
    adultRef.current?.focus();
  }, [focusAdult]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (granting || sealed) return;
    if (blank) {
      setBlankTried(true);
      inputRef.current?.focus();
      return;
    }
    setBlankTried(false);
    const outcome = onSubmit();
    if (outcome === 'adult-required') {
      setAdultTried(true);
      setFocusAdult(true);
    } else {
      setAdultTried(false);
    }
  }

  return (
    <form className={styles.band} onSubmit={handleSubmit} noValidate data-wish-line>
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
        aria-describedby={shown === null ? noteId : `${messageId} ${noteId}`}
        autoComplete="off"
        maxLength={WISH_MAX_LENGTH}
        value={text}
        readOnly={sealed}
        disabled={granting}
        onChange={(event) => onTextChange(event.target.value)}
      />

      {/* Where the wish goes (Req 3.9). Not focusable. The wish input is described by it, after the message. */}
      <p id={noteId} className={styles.note}>
        {outside ? OUTSIDE_NOTE_MESSAGE : WISH_SENT_TO_GEMINI_MESSAGE}
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
            readOnly={sealed}
            disabled={granting}
            onChange={(event) => onContextChange(event.target.value)}
          />
        )}
      </div>

      {/* Unless live wishes are outside: the 18+ box, after the context and before the seal (Req 13.2). It is
          not legal advice and not proof of age, and it is kept in memory only. */}
      {!outside && (
        <label className={styles.adult}>
          <input
            ref={adultRef}
            id={adultId}
            className={styles.adultBox}
            type="checkbox"
            autoComplete="off"
            checked={adultConfirmed}
            disabled={granting}
            aria-disabled={sealed ? true : undefined}
            aria-invalid={showAdult ? true : undefined}
            aria-describedby={showAdult ? messageId : undefined}
            onChange={(event) => {
              if (sealed) return;
              if (event.target.checked) setAdultTried(false);
              onAdultChange(event.target.checked);
            }}
          />
          <span>{ADULT_LABEL}</span>
        </label>
      )}

      <button
        className={cx(styles.seal, sealed && styles.sealInert)}
        type="submit"
        aria-label="Make the wish"
        aria-disabled={sealed ? true : undefined}
        aria-describedby={sealed ? (message === null ? messageId : usedId) : undefined}
        disabled={granting}
      >
        Make the wish
      </button>

      <p
        id={messageId}
        className={cx(styles.message, notice?.kind === 'error' && !showBlank && !showAdult && styles.error)}
        role={alertRole ? 'alert' : undefined}
      >
        {shown}
      </p>
      {/* The seal's description is never empty: when a notice has the row, the reason stays here for assistive tech. */}
      {sealed && message !== null && (
        <span id={usedId} className={styles.visuallyHidden}>
          {SEAL_USED_MESSAGE}
        </span>
      )}

      <p className={styles.status} role="status">
        {granting ? PAW_STIRS_MESSAGE : ''}
      </p>
    </form>
  );
}
