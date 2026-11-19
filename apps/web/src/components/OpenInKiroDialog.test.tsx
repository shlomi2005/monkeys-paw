// @vitest-environment jsdom
// OpenInKiroDialog: the strings, the clipboard and its fallback, the folder zip, and the dialog's name. Focus restore on
// Escape and Close is tested with the opener in ExportButtons.test.tsx.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleSpecExport } from '../api/api-test-support';
import { downloadZip } from '../export/download';
import { OpenInKiroDialog } from './OpenInKiroDialog';

vi.mock('../export/download', () => ({ downloadZip: vi.fn() }));
const download = vi.mocked(downloadZip);

const SPEC = { ...sampleSpecExport(), requirementsMd: '# R\n', propertiesMd: '# P\n' };
const WISH = 'Only the owner can delete a Project!';
// The slug is cut at 32 characters.
const FOLDER = 'monkeys-paw-only-the-owner-can-delete-a-proj';
const COMMAND = `kiro open ${FOLDER}`;

function setup(onClose = vi.fn()) {
  render(<OpenInKiroDialog spec={SPEC} wishText={WISH} onClose={onClose} />);
  return { onClose };
}

const status = (): string => (document.querySelector('[role="status"]')?.textContent ?? '').replace(/\u200B/g, '');
const field = (name: string): HTMLInputElement => screen.getByLabelText(name) as HTMLInputElement;

function stubClipboard(writeText: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText === undefined ? undefined : { writeText } });
}

beforeEach(() => download.mockReset());
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('OpenInKiroDialog', () => {
  it('is named by its heading, lists the steps, and shows the folder name and the command', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Open in Kiro' });
    const steps = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
    expect(steps?.textContent).toBe(`Drop the folder ${FOLDER} into .kiro/specs/.Run the command ${COMMAND}.`);
    expect(field('Folder name').value).toBe(FOLDER);
    expect(field('Command').value).toBe(COMMAND);
    expect(field('Command').readOnly).toBe(true);
  });

  it('stays closed and empty without a spec', () => {
    render(<OpenInKiroDialog spec={null} wishText={WISH} onClose={vi.fn()} />);
    expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(false);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('copies the folder name and the command with the Clipboard API and says "Copied."', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Copy folder name' }));
    await waitFor(() => expect(status()).toBe('Copied.'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls).toEqual([[FOLDER], [COMMAND]]);
    expect(status()).toBe('Copied.');
  });

  it.each([
    ['is missing', undefined],
    ['rejects', vi.fn(() => Promise.reject(new Error('denied')))],
  ])('selects the text in the visible field and asks for Ctrl+C when the clipboard %s', async (_label, writeText) => {
    stubClipboard(writeText);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    await waitFor(() => expect(status()).toBe('Press Ctrl+C (Cmd+C) to copy'));
    const input = field('Command');
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, COMMAND.length]);
  });

  it('downloads a zip holding the folder with both files', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Download the folder (.zip)' }));
    expect(download).toHaveBeenCalledTimes(1);
    const [bytes, fileName] = download.mock.calls[0] as [Uint8Array, string];
    expect(fileName).toBe(`${FOLDER}.zip`);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([`${FOLDER}/properties.md`, `${FOLDER}/requirements.md`]);
    expect(strFromU8(files[`${FOLDER}/requirements.md`] as Uint8Array)).toBe('# R\n');
    expect(strFromU8(files[`${FOLDER}/properties.md`] as Uint8Array)).toBe('# P\n');
  });

  it('calls onClose from Close', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
