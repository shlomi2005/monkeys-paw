// @vitest-environment jsdom
// ExportButtons: "Take the scroll" (zip contents, file name, status, error, double click) and "Open in Kiro" (the export
// error opens no dialog; Escape and Close give focus back to the button). jsdom has no inert page: the real focus trap
// is left to Playwright (tasks 42-43).

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failure, ok, deferred } from '../state/paw-session-test-support';
import { sampleGrant, sampleSpecExport, sampleWish } from '../api/api-test-support';
import { RESTING_MESSAGE, SCROLL_LOST_MESSAGE } from '../api/api-messages';
import type { ApiClient } from '../api/api-client';
import { downloadZip } from '../export/download';
import { ExportButtons } from './ExportButtons';
import type { ExportButtonsProps } from './ExportButtons';

vi.mock('../export/download', () => ({ downloadZip: vi.fn() }));
const download = vi.mocked(downloadZip);

const SPEC = {
  ...sampleSpecExport(),
  wishId: 'wish/../1',
  requirementsMd: '# Requirements\nWHEN a THEN b\n',
  propertiesMd: '# Properties\nfor all x\n',
};

function setup(overrides: Partial<ExportButtonsProps> = {}) {
  const postExport = vi.fn<ApiClient['postExport']>(() => Promise.resolve(ok(SPEC)));
  const props: ExportButtonsProps = {
    show: true,
    wish: sampleWish('Only the owner can delete a project'),
    grant: sampleGrant(),
    api: { postExport },
    ...overrides,
  };
  const view = render(<ExportButtons {...props} />);
  return { postExport, props, ...view };
}

const scrollButton = (): HTMLElement => screen.getByRole('button', { name: 'Take the scroll' });
const kiroButton = (): HTMLElement => screen.getByRole('button', { name: 'Open in Kiro' });
const status = (): string => (document.querySelector('[role="status"]')?.textContent ?? '').replace(/\u200B/g, '');
const dialogOpen = (): boolean => document.querySelector('dialog')?.hasAttribute('open') ?? false;

beforeEach(() => download.mockReset());
afterEach(cleanup);

describe('ExportButtons: Take the scroll', () => {
  it('renders nothing while the medal is hidden', () => {
    setup({ show: false });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('exports the current wish and grant, saves a zip with both files, and says "Scroll saved!"', async () => {
    const { postExport, props } = setup();
    fireEvent.click(scrollButton());
    await waitFor(() => expect(status()).toBe('Scroll saved!'));

    expect(postExport).toHaveBeenCalledTimes(1);
    expect(postExport.mock.calls[0]?.[0]).toEqual({ wish: props.wish, grant: props.grant });
    expect(download).toHaveBeenCalledTimes(1);
    const [bytes, fileName] = download.mock.calls[0] as [Uint8Array, string];
    expect(fileName).toBe('monkeys-paw-wish1.zip');
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(['properties.md', 'requirements.md']);
    expect(strFromU8(files['requirements.md'] as Uint8Array)).toBe(SPEC.requirementsMd);
    expect(strFromU8(files['properties.md'] as Uint8Array)).toBe(SPEC.propertiesMd);
    expect(dialogOpen()).toBe(false);
  });

  it('shows the in-character error line and saves nothing when the export fails', async () => {
    const { postExport } = setup();
    postExport.mockResolvedValueOnce(failure('resting', RESTING_MESSAGE, 503));
    fireEvent.click(scrollButton());
    await waitFor(() => expect(status()).toBe(RESTING_MESSAGE));
    expect(download).not.toHaveBeenCalled();
    expect(scrollButton().getAttribute('aria-disabled')).toBe('false');
  });

  it('says so when the browser refuses the download', async () => {
    setup();
    download.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    fireEvent.click(scrollButton());
    await waitFor(() => expect(status()).toBe(SCROLL_LOST_MESSAGE));
  });

  it('is busy and aria-disabled while the request runs, and a second click does nothing', async () => {
    const { postExport } = setup();
    const pending = deferred<Awaited<ReturnType<ApiClient['postExport']>>>();
    postExport.mockReturnValueOnce(pending.promise);

    fireEvent.click(scrollButton());
    fireEvent.click(scrollButton());
    fireEvent.click(kiroButton());
    expect(postExport).toHaveBeenCalledTimes(1);
    expect(scrollButton().getAttribute('aria-disabled')).toBe('true');
    expect(scrollButton().getAttribute('aria-busy')).toBe('true');
    expect(kiroButton().getAttribute('aria-disabled')).toBe('true');

    await act(async () => pending.resolve(ok(SPEC)));
    await waitFor(() => expect(status()).toBe('Scroll saved!'));
    expect(download).toHaveBeenCalledTimes(1);
    expect(scrollButton().getAttribute('aria-disabled')).toBe('false');
  });

  it('drops the answer when the buttons hide (a rewrite) while the request runs', async () => {
    const { postExport, props, rerender } = setup();
    const pending = deferred<Awaited<ReturnType<ApiClient['postExport']>>>();
    postExport.mockReturnValueOnce(pending.promise);
    fireEvent.click(kiroButton());
    rerender(<ExportButtons {...props} show={false} />);
    await act(async () => pending.resolve(ok(SPEC)));
    rerender(<ExportButtons {...props} show />);
    expect(dialogOpen()).toBe(false);
  });
});

describe('ExportButtons: Open in Kiro', () => {
  it('shows the error line and opens no dialog when the export fails', async () => {
    const { postExport } = setup();
    postExport.mockResolvedValueOnce(failure('server', 'The paw stumbles. Try again in a moment.', 500));
    fireEvent.click(kiroButton());
    await waitFor(() => expect(status()).toBe('The paw stumbles. Try again in a moment.'));
    expect(dialogOpen()).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the dialog after the export; Escape and Close each give focus back to the button', async () => {
    setup();
    kiroButton().focus();
    fireEvent.click(kiroButton());
    await waitFor(() => expect(dialogOpen()).toBe(true));
    expect(screen.getByRole('dialog', { name: 'Open in Kiro' })).toBeTruthy();
    expect(document.activeElement).not.toBe(kiroButton());

    fireEvent(document.querySelector('dialog') as HTMLElement, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(dialogOpen()).toBe(false));
    expect(document.activeElement).toBe(kiroButton());

    fireEvent.click(kiroButton());
    await waitFor(() => expect(dialogOpen()).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(dialogOpen()).toBe(false));
    expect(document.activeElement).toBe(kiroButton());
  });
});
