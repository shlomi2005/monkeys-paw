// ExportButtons: "Take the scroll" and "Open in Kiro" (paw-web design.md section 6 "Export", Req 6.2, 6.4, 6.8).
// Both call `postExport` with the session's current wish and the projected Grant. They are only rendered while the
// medal shows (`show`), so the export can never describe a half-finished round.
//
// One request at a time. The guard is a ref, not state, so a second click in the same tick does nothing. While a
// request runs both buttons are `aria-disabled` (not `disabled`), so the focused one keeps focus and a screen reader
// still finds it. Unmounting (a rewrite) aborts the request.
//
// The status line is this component's own polite `role="status"` region, like the medal's and the binding card's. It
// is not the session's live region: the session only announces machine transitions, and a message from here would
// need a second way into it.

import { useEffect, useRef, useState } from 'react';
import type { Grant, SpecExport, Wish } from 'paw-core';
import type { ApiClient } from '../api/api-client';
import { NETWORK_MESSAGE, SCROLL_LOST_MESSAGE, SCROLL_SAVED_MESSAGE } from '../api/api-messages';
import { downloadZip } from '../export/download';
import { buildScrollZip, scrollFileName, withExampleNote } from '../export/spec-files';
import { useStatusLine } from '../hooks/use-status-line';
import { cx } from './class-names';
import styles from './ExportButtons.module.css';
import { OpenInKiroDialog } from './OpenInKiroDialog';

export const TAKE_SCROLL_LABEL = 'Take the scroll';
export const OPEN_IN_KIRO_LABEL = 'Open in Kiro';

type Kind = 'scroll' | 'kiro';

export interface ExportButtonsProps {
  /** `view.showExport`: the round has ended and the medal shows. Renders nothing while false. */
  readonly show: boolean;
  /** `ctx.wish`. */
  readonly wish: Wish | null;
  /** `projectGrant(ctx)`: the Grant with each curse's status set from the closed ids. */
  readonly grant: Grant | null;
  readonly api: Pick<ApiClient, 'postExport'>;
  /** The example note of a ready round: written into both files and shown in the dialog. */
  readonly note?: string | undefined;
}

export function ExportButtons({ show, wish, grant, api, note }: ExportButtonsProps) {
  const [pending, setPending] = useState<Kind | null>(null);
  const [spec, setSpec] = useState<SpecExport | null>(null);
  const [status, say] = useStatusLine();
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);

  // Unmounting, or the buttons hiding (a rewrite), abandons a request in flight: its answer is dropped.
  useEffect(() => {
    if (!show) controller.current?.abort();
  }, [show]);
  useEffect(() => () => controller.current?.abort(), []);

  // Hidden again (a rewrite): forget the exported spec so a later round starts clean.
  const [wasShown, setWasShown] = useState(show);
  if (wasShown !== show) {
    setWasShown(show);
    if (!show) {
      setSpec(null);
      setPending(null);
    }
  }

  async function run(kind: Kind): Promise<void> {
    if (running.current || wish === null || grant === null) return;
    running.current = true;
    setPending(kind);
    say('');
    const mine = new AbortController();
    controller.current = mine;

    let result: Awaited<ReturnType<ApiClient['postExport']>>;
    try {
      result = await api.postExport({ wish, grant }, mine.signal);
    } catch {
      result = { ok: false, error: { kind: 'network', message: NETWORK_MESSAGE } };
    }
    running.current = false;
    if (mine.signal.aborted) return;
    setPending(null);

    if (!result.ok) {
      say(result.error.message);
      return;
    }
    const value = note ? withExampleNote(result.value, note) : result.value;
    if (kind === 'kiro') {
      setSpec(value);
      return;
    }
    try {
      downloadZip(buildScrollZip(value), scrollFileName(value.wishId));
      say(SCROLL_SAVED_MESSAGE);
    } catch {
      say(SCROLL_LOST_MESSAGE);
    }
  }

  if (!show) return null;
  const busy = pending !== null;

  return (
    <div className={styles.root}>
      <div className={styles.row}>
        <button
          type="button"
          className={cx(styles.button, busy && styles.inactive)}
          aria-disabled={busy}
          aria-busy={pending === 'scroll'}
          onClick={() => void run('scroll')}
        >
          {TAKE_SCROLL_LABEL}
        </button>
        <button
          type="button"
          className={cx(styles.button, busy && styles.inactive)}
          aria-disabled={busy}
          aria-busy={pending === 'kiro'}
          onClick={() => void run('kiro')}
        >
          {OPEN_IN_KIRO_LABEL}
        </button>
      </div>
      <p className={styles.status} role="status" aria-live="polite">
        {status}
      </p>
      <OpenInKiroDialog spec={spec} note={note} wishText={wish?.text ?? ''} onClose={() => setSpec(null)} />
    </div>
  );
}
