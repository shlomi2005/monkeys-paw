// useDialogFocus: the open, close and focus behaviour of a native modal <dialog> (paw-web design.md section 7,
// Req 4.6, 8.1, 8.4). Generic on purpose: BindingCard uses it now and OpenInKiroDialog (task 38) will too.
//
// What it does, in order:
//   1. Stores the opener (`document.activeElement`) just before the dialog opens.
//   2. Opens with `showModal()`. Where that is missing (jsdom) it sets the `open` attribute, so the content is
//      reachable by tests and by the accessibility tree.
//   3. Moves initial focus into the dialog.
//   4. Routes `cancel` (Escape) through `onCancel` with `preventDefault`, unless `locked`. The browser never closes the
//      dialog by itself: the parent's `open` flag decides.
//   5. Chrome close-watcher guard. Chrome may close a modal dialog on a second Escape without user activation between
//      the two presses, even though `cancel` was prevented. The dialog then fires `close` while the parent still has it
//      open. If not `locked`, `onCancel` runs so the state and the DOM agree. If `locked` (the Judge is working), the
//      dialog is reopened with `showModal()` and focus goes back inside.
//   6. When `open` becomes false the hook closes the dialog and focuses the opener again, if it is still connected.
//      This close is our own: it dispatches nothing.
//
// The real focus trap (the inert page, Tab and Shift+Tab staying inside the dialog) is verified in Playwright
// (tasks 42 and 43), not in jsdom. jsdom has no inert page and no `showModal`, so component tests here cover only the
// logic above, with stubbed `showModal` and `close`.

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export interface UseDialogFocusOptions {
  /** The parent's decision. The dialog is open exactly while this is true. */
  readonly open: boolean;
  /** While true, Escape and a browser-initiated close are ignored (the Judge is working). */
  readonly locked?: boolean;
  /** Escape, or a browser-initiated close while not locked. The parent sets `open` to false in response. */
  readonly onCancel: () => void;
  /** Element that gets focus after opening. Defaults to the first control inside the dialog. */
  readonly initialFocus?: (dialog: HTMLDialogElement) => HTMLElement | null;
}

const FIRST_CONTROL = 'textarea, input, select, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function defaultInitialFocus(dialog: HTMLDialogElement): HTMLElement | null {
  return dialog.querySelector<HTMLElement>(FIRST_CONTROL);
}

/** `showModal()`, or the `open` attribute where the browser lacks it. Does nothing when already open. */
function openDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

/** Attaches the behaviour above to the dialog behind `dialogRef`. It adds its own listeners, so nothing is spread. */
export function useDialogFocus(dialogRef: RefObject<HTMLDialogElement | null>, options: UseDialogFocusOptions): void {
  const { open } = options;

  // The latest callbacks and lock flag, read inside listeners. Updating them never reopens or recloses the dialog.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null || !open) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusInside = (): void => {
      (latest.current.initialFocus ?? defaultInitialFocus)(dialog)?.focus();
    };

    const handleCancel = (event: Event): void => {
      event.preventDefault();
      if (!(latest.current.locked ?? false)) latest.current.onCancel();
    };

    const handleClose = (): void => {
      // Reopened since (a StrictMode remount, say): this is a late event of an earlier close.
      if (dialog.open) return;
      if (latest.current.locked ?? false) {
        if (!dialog.isConnected) return;
        openDialog(dialog);
        focusInside();
        return;
      }
      latest.current.onCancel();
    };

    openDialog(dialog);
    focusInside();
    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('close', handleClose);

    return () => {
      // Listeners go first: the `close` event of our own close() must reach nobody.
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleClose);
      closeDialog(dialog);
      if (opener !== null && opener.isConnected) opener.focus();
    };
  }, [dialogRef, open]);
}
