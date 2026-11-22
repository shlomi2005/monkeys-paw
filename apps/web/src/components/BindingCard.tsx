// BindingCard: the parchment dialog where the user binds one curse (paw-web design.md sections 2 and 7, Req 4.2 to
// 4.6, 8.4). A controlled component: the parent passes the open card (or null) and wires the three callbacks to the
// session (task 27). The `card` prop alone decides when the dialog opens and closes. Open, Escape, focus restore and
// the Chrome close-watcher guard are in `use-dialog-focus.ts`; the real focus trap is verified in Playwright.

import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  EMPTY_CLAUSE_MESSAGE,
  JUDGE_LIVE_ONLY_MESSAGE,
  JUDGE_RESTING_MESSAGE,
  JUDGE_STIRS_MESSAGE,
  PAW_REMEMBERS_MESSAGE,
} from '../api/api-messages';
import { useDialogFocus } from '../hooks/use-dialog-focus';
import { curseTypeLabel } from '../state/paw-selectors';
import type { CardView } from '../state/paw-selectors';
import type { Notice } from '../state/use-paw-session';
import { cx } from './class-names';
import { hasOwnQuotes } from './quote-marks';
import styles from './BindingCard.module.css';
import { suggestClause } from './suggest-clause';

export interface BindingCardProps {
  /** The open card, or null when no card is open. */
  readonly card: CardView | null;
  /** Examples-only play (design.md A9): no bind request is ever sent, so Accept is disabled. */
  readonly judgeResting: boolean;
  /** A replayed round without a ready verdict (Req 13.9): Accept is `aria-disabled` and the card says why. */
  readonly liveOnly?: boolean;
  /** The ready clause of this curse in a ready round (Req 13.9): the card is pre-filled with it. */
  readonly readyClause?: string | undefined;
  /** The session's in-character line, shown inside the card as text only. */
  readonly notice: Notice | null;
  /** The example note of a ready round. First child of the described block. */
  readonly exampleNote?: string | undefined;
  /** A non-blank clause, trimmed. The parent sends `bind_submitted` with kind `ears-clause`. */
  readonly onAccept: (clause: string) => void;
  /** The parent sends `rewrite`. */
  readonly onRewrite: () => void;
  /** Cancel or Escape. The parent sends `card_closed`. */
  readonly onCancel: () => void;
}

export function BindingCard({ card, judgeResting, liveOnly = false, readyClause, notice, exampleNote, onAccept, onRewrite, onCancel }: BindingCardProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isOpen = card !== null;
  const judging = card?.judging ?? false;

  // Open, initial focus on the clause, Escape through `cancel`, the Chrome close-watcher guard and focus restore all
  // live in the hook. While the Judge works, Escape and a browser-initiated close are ignored (Req 4.6).
  useDialogFocus(dialogRef, {
    open: isOpen,
    locked: judging,
    onCancel,
    initialFocus: (dialog) => dialog.querySelector('textarea'),
  });

  // The dialog is always in the DOM and closed while `card` is null. Its content exists only while a card is open,
  // and is keyed by curse id so a different curse re-seeds the clause.
  const labelId = useId();
  const describedId = useId();

  return (
    <dialog
      ref={dialogRef}
      className={styles.card}
      aria-labelledby={isOpen ? labelId : undefined}
      aria-describedby={isOpen ? describedId : undefined}
    >
      {card !== null && (
        <CardBody
          key={card.curse.id}
          card={card}
          labelId={labelId}
          describedId={describedId}
          exampleNote={exampleNote}
          judgeResting={judgeResting}
          liveOnly={liveOnly}
          readyClause={readyClause}
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
  liveOnly = false,
  readyClause,
  notice,
  exampleNote,
  onAccept,
  onRewrite,
  onCancel,
}: CardBodyProps) {
  const { curse, judging, remembers } = card;
  const clauseId = useId();
  const blankId = useId();

  // Seeded once per curse (the parent keys this component by curse id). Edits survive a "not closed" verdict.
  const [clause, setClause] = useState(() => readyClause ?? suggestClause(curse));
  const [blankTried, setBlankTried] = useState(false);

  const acceptDisabled = judging || judgeResting || liveOnly;
  const showBlank = blankTried && clause.trim() === '';
  // The session also reports the resting line when Accept is tried. Show it once.
  const staticLine = judgeResting ? JUDGE_RESTING_MESSAGE : liveOnly ? JUDGE_LIVE_ONLY_MESSAGE : null;
  const noticeText = notice !== null && notice.text !== staticLine ? notice : null;

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
        {exampleNote ? <p className={styles.resting}>{exampleNote}</p> : null}
        <p className={styles.story}>{curse.story}</p>
        <blockquote className={styles.loophole} data-own-quotes={hasOwnQuotes(curse.loophole) || undefined}>{curse.loophole}</blockquote>
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
      {staticLine !== null && <p className={styles.resting}>{staticLine}</p>}
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
