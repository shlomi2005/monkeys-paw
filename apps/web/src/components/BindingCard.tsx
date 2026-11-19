// BindingCard: the parchment dialog where the user binds one curse (paw-web design.md sections 2 and 7, Req 4.2 to
// 4.6, 8.4). A controlled component: the parent passes the open card (or null) and wires the three callbacks to the
// session (task 27). The `card` prop alone decides when the dialog opens and closes. Focus trap and focus restore
// come from the native modal and are covered by Playwright and task 32.

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import {
  EMPTY_CLAUSE_MESSAGE,
  JUDGE_RESTING_MESSAGE,
  JUDGE_STIRS_MESSAGE,
  PAW_REMEMBERS_MESSAGE,
} from '../api/api-messages';
import { curseTypeLabel } from '../state/paw-selectors';
import type { CardView } from '../state/paw-selectors';
import type { Notice } from '../state/use-paw-session';
import { cx } from './class-names';
import styles from './BindingCard.module.css';
import { suggestClause } from './suggest-clause';

export interface BindingCardProps {
  /** The open card, or null when no card is open. */
  readonly card: CardView | null;
  /** Examples-only play (design.md A9): no bind request is ever sent, so Accept is disabled. */
  readonly judgeResting: boolean;
  /** The session's in-character line, shown inside the card as text only. */
  readonly notice: Notice | null;
  /** A non-blank clause, trimmed. The parent sends `bind_submitted` with kind `ears-clause`. */
  readonly onAccept: (clause: string) => void;
  /** The parent sends `rewrite`. */
  readonly onRewrite: () => void;
  /** Cancel or Escape. The parent sends `card_closed`. */
  readonly onCancel: () => void;
}

/** jsdom has no `showModal`: fall back to the `open` attribute so the content is reachable. */
function openDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

export function BindingCard({ card, judgeResting, notice, onAccept, onRewrite, onCancel }: BindingCardProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isOpen = card !== null;
  const judging = card?.judging ?? false;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null || !isOpen) return;
    openDialog(dialog);
    // Initial focus goes to the clause (design.md section 7), also where `showModal` is missing.
    dialog.querySelector('textarea')?.focus();
    return () => closeDialog(dialog);
  }, [isOpen]);

  // The dialog is always in the DOM and closed while `card` is null. Its content exists only while a card is open,
  // and is keyed by curse id so a different curse re-seeds the clause.
  const labelId = useId();
  const describedId = useId();

  function handleCancelEvent(event: SyntheticEvent<HTMLDialogElement>): void {
    // The browser must never close the dialog itself: the parent's `card` prop decides.
    event.preventDefault();
    if (!judging) onCancel();
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.card}
      aria-labelledby={isOpen ? labelId : undefined}
      aria-describedby={isOpen ? describedId : undefined}
      onCancel={handleCancelEvent}
    >
      {card !== null && (
        <CardBody
          key={card.curse.id}
          card={card}
          labelId={labelId}
          describedId={describedId}
          judgeResting={judgeResting}
          notice={notice}
          onAccept={onAccept}
          onRewrite={onRewrite}
          onCancel={onCancel}
        />
      )}
    </dialog>
  );
}

interface CardBodyProps extends Omit<BindingCardProps, 'card'> {
  readonly card: CardView;
  readonly labelId: string;
  readonly describedId: string;
}

function CardBody({
  card,
  labelId,
  describedId,
  judgeResting,
  notice,
  onAccept,
  onRewrite,
  onCancel,
}: CardBodyProps) {
  const { curse, judging, remembers } = card;
  const clauseId = useId();
  const blankId = useId();

  // Seeded once per curse (the parent keys this component by curse id). Edits survive a "not closed" verdict.
  const [clause, setClause] = useState(() => suggestClause(curse));
  const [blankTried, setBlankTried] = useState(false);

  const acceptDisabled = judging || judgeResting;
  const showBlank = blankTried && clause.trim() === '';
  // The session also reports the resting line when Accept is tried. Show it once.
  const noticeText = notice !== null && !(judgeResting && notice.text === JUDGE_RESTING_MESSAGE) ? notice : null;

  function accept(): void {
    if (acceptDisabled) return;
    const trimmed = clause.trim();
    if (trimmed === '') {
      setBlankTried(true);
      return;
    }
    onAccept(trimmed);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      accept();
    }
  }

  return (
    <div className={styles.body}>
      <h2 id={labelId} className={styles.type}>
        {curseTypeLabel(curse.type)}
      </h2>

      <div id={describedId} className={styles.described}>
        <p className={styles.story}>{curse.story}</p>
        <blockquote className={styles.loophole}>{curse.loophole}</blockquote>
      </div>

      {remembers && <p className={styles.remembers}>{PAW_REMEMBERS_MESSAGE}</p>}

      <label className={styles.clauseLabel} htmlFor={clauseId}>
        Your clause (EARS)
      </label>
      <textarea
        id={clauseId}
        className={styles.clause}
        rows={4}
        spellCheck={false}
        value={clause}
        readOnly={judging}
        aria-invalid={showBlank ? true : undefined}
        aria-describedby={showBlank ? blankId : undefined}
        onChange={(event) => {
          setClause(event.target.value);
          setBlankTried(false);
        }}
        onKeyDown={handleKeyDown}
      />

      {showBlank && (
        <p id={blankId} className={styles.blank} role="alert">
          {EMPTY_CLAUSE_MESSAGE}
        </p>
      )}

      {/* DOM order is the tab order (design.md section 7): clause, Accept, Rewrite, Cancel. */}
      <div className={styles.buttons}>
        <button
          type="button"
          className={cx(styles.accept, acceptDisabled && styles.inactive)}
          aria-disabled={acceptDisabled}
          onClick={accept}
        >
          Accept this clause
        </button>
        <button
          type="button"
          className={cx(styles.secondary, judging && styles.inactive)}
          aria-disabled={judging}
          onClick={() => {
            if (!judging) onRewrite();
          }}
        >
          Rewrite the whole wish
        </button>
        <button
          type="button"
          className={cx(styles.secondary, judging && styles.inactive)}
          aria-disabled={judging}
          onClick={() => {
            if (!judging) onCancel();
          }}
        >
          Cancel
        </button>
      </div>

      <p className={styles.status} role="status">
        {judging ? JUDGE_STIRS_MESSAGE : ''}
      </p>
      {judgeResting && <p className={styles.resting}>{JUDGE_RESTING_MESSAGE}</p>}
      {noticeText !== null && (
        <p
          className={cx(styles.notice, noticeText.kind === 'error' && styles.error)}
          role={noticeText.kind === 'error' ? 'alert' : undefined}
        >
          {noticeText.text}
        </p>
      )}
    </div>
  );
}
