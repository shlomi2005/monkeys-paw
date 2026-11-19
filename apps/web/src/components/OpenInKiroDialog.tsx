// OpenInKiroDialog: the native modal <dialog> behind "Open in Kiro" (paw-web design.md sections 6 and 7, Req 6.2, 8.4).
// A controlled component: `spec` non-null means open. Open, Escape, focus restore and the Chrome close-watcher guard
// are `use-dialog-focus.ts`, the same hook BindingCard uses, so Escape closes it and focus returns to "Open in Kiro".
// The real focus trap is verified in Playwright (tasks 42-43).
//
// It shows the steps, the folder name and the command (each in a visible read-only field with a Copy button), a button
// that saves a zip holding the folder, and Close. Copy uses `navigator.clipboard.writeText`. Where that is missing or
// rejects, the field's text is selected and the status line says to press Ctrl+C (Cmd+C).

import { useId, useRef } from 'react';
import type { RefObject } from 'react';
import type { SpecExport } from 'paw-core';
import { downloadZip } from '../export/download';
import { buildFolderZip, kiroCommand, specFolderName } from '../export/spec-files';
import { useDialogFocus } from '../hooks/use-dialog-focus';
import { useStatusLine } from '../hooks/use-status-line';
import { SCROLL_LOST_MESSAGE } from '../api/api-messages';
import styles from './OpenInKiroDialog.module.css';

export const COPIED_MESSAGE = 'Copied.';
export const COPY_FALLBACK_MESSAGE = 'Press Ctrl+C (Cmd+C) to copy';
export const FOLDER_SAVED_MESSAGE = 'Folder saved!';

export interface OpenInKiroDialogProps {
  /** The exported spec, or null while the dialog is closed. */
  readonly spec: SpecExport | null;
  /** `wish.text`. The folder name is `monkeys-paw-<slugify(wishText)>`. */
  readonly wishText: string;
  readonly onClose: () => void;
}

export function OpenInKiroDialog({ spec, wishText, onClose }: OpenInKiroDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isOpen = spec !== null;
  const labelId = useId();
  const describedId = useId();

  useDialogFocus(dialogRef, {
    open: isOpen,
    onCancel: onClose,
    initialFocus: (dialog) => dialog.querySelector('button'),
  });

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={isOpen ? labelId : undefined}
      aria-describedby={isOpen ? describedId : undefined}
    >
      {spec !== null && (
        <Body spec={spec} wishText={wishText} labelId={labelId} describedId={describedId} onClose={onClose} />
      )}
    </dialog>
  );
}

interface BodyProps {
  readonly spec: SpecExport;
  readonly wishText: string;
  readonly labelId: string;
  readonly describedId: string;
  readonly onClose: () => void;
}

function Body({ spec, wishText, labelId, describedId, onClose }: BodyProps) {
  const folder = specFolderName(wishText);
  const command = kiroCommand(folder);
  const [status, say] = useStatusLine();
  const folderRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLInputElement>(null);
  const folderId = useId();
  const commandId = useId();

  async function copy(text: string, field: RefObject<HTMLInputElement | null>): Promise<void> {
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      say(COPIED_MESSAGE);
    } catch {
      field.current?.focus();
      field.current?.select();
      say(COPY_FALLBACK_MESSAGE);
    }
  }

  function download(): void {
    try {
      downloadZip(buildFolderZip(folder, spec), `${folder}.zip`);
      say(FOLDER_SAVED_MESSAGE);
    } catch {
      say(SCROLL_LOST_MESSAGE);
    }
  }

  return (
    <div className={styles.body}>
      <h2 id={labelId} className={styles.title}>
        Open in Kiro
      </h2>

      <ol id={describedId} className={styles.steps}>
        <li>
          Drop the folder <code>{folder}</code> into <code>.kiro/specs/</code>.
        </li>
        <li>
          Run the command <code>{command}</code>.
        </li>
      </ol>

      <label className={styles.label} htmlFor={folderId}>
        Folder name
      </label>
      <div className={styles.field}>
        <input id={folderId} ref={folderRef} className={styles.input} readOnly value={folder} />
        <button type="button" className={styles.button} onClick={() => void copy(folder, folderRef)}>
          Copy folder name
        </button>
      </div>

      <label className={styles.label} htmlFor={commandId}>
        Command
      </label>
      <div className={styles.field}>
        <input id={commandId} ref={commandRef} className={styles.input} readOnly value={command} />
        <button type="button" className={styles.button} onClick={() => void copy(command, commandRef)}>
          Copy command
        </button>
      </div>

      <div className={styles.buttons}>
        <button type="button" className={styles.button} onClick={download}>
          Download the folder (.zip)
        </button>
        <button type="button" className={styles.button} onClick={onClose}>
          Close
        </button>
      </div>

      <p className={styles.status} role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
