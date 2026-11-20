// Screenshot receipts (paw-web task 49). Each helper plays one part of a round and saves full-page pictures to
// e2e/receipts/<project>-<phase>.png. The PNGs are gitignored (see e2e/receipts/README.md).
//
// A shot is taken only in a settled state, never after a fixed delay: the DOM says what it should say, the fonts are
// loaded, and with WebGL the canvas has taken over from the poster and two pictures of the paw in a row are the same
// (the animation has finished).

import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { settledPaw } from './canvas';
import type { PawPage } from './paw-page';

const RECEIPT_DIR = join(import.meta.dirname, '..', 'receipts');

/** A full-page picture of this app is far above this. A blank page compresses to well under it. */
const MIN_BYTES = 8_000;

const clauseFor = (index: number): string =>
  `WHEN the owner of project ${index + 1} has left, THE SYSTEM SHALL let an admin delete it.`;

/** A clause the stubbed Judge does not accept. */
const WEAK_CLAUSE = 'The owner can delete.';

/** The path of a receipt: `<project>-<phase>.png`. */
export function receiptPath(testInfo: TestInfo, phase: string): string {
  return join(RECEIPT_DIR, `${testInfo.project.name}-${phase}.png`);
}

/** Saves the page as a receipt and checks that the file is not blank. */
async function shoot(page: Page, testInfo: TestInfo, phase: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const path = receiptPath(testInfo, phase);
  await mkdir(RECEIPT_DIR, { recursive: true });
  await page.screenshot({ path, fullPage: true, animations: 'disabled', caret: 'hide' });
  expect((await stat(path)).size, `${phase} receipt is not blank`).toBeGreaterThan(MIN_BYTES);
}

/** Settled with WebGL: the scene has taken over and the paw has stopped moving. `after` waits for a change first. */
async function settle(paw: PawPage, after?: Buffer): Promise<Buffer> {
  await paw.expectScene();
  return settledPaw(paw.page, after);
}

/** The whole round: idle, curses landed, card open, not closed, closed, rested with the medal. */
export async function roundReceipts(paw: PawPage, testInfo: TestInfo): Promise<void> {
  const { page, stub } = paw;
  stub.behavior.closes = (_curseId, clause) => clause !== WEAK_CLAUSE;

  await paw.open();
  await expect(paw.stateText).toHaveText('The paw rests, all fingers open.');
  const idle = await settle(paw);
  await shoot(page, testInfo, 'idle');

  await paw.makeWish();
  await expect(paw.stamp).toHaveText('Granted.');
  await paw.expectCurled(5);
  const curled = await settle(paw, idle);
  await shoot(page, testInfo, 'curses-landed');

  await paw.openCard(1);
  await settle(paw);
  await shoot(page, testInfo, 'card-open');

  await paw.submitClause(WEAK_CLAUSE);
  await expect(paw.dialog.getByText('The paw remembers.')).toBeVisible();
  await expect(paw.dialog.getByText('The Judge stirs')).toBeHidden();
  await settle(paw);
  await shoot(page, testInfo, 'not-closed');

  await paw.dialog.getByRole('textbox').fill(clauseFor(1));
  await paw.dialog.getByRole('button', { name: 'Accept this clause' }).click();
  await expect(paw.dialog).toBeHidden();
  await expect(paw.slot(1)).toHaveAttribute('data-status', 'closed');
  await expect(paw.stateText).toHaveText('4 fingers curled.');
  await settle(paw, curled);
  await shoot(page, testInfo, 'closed');

  for (const index of [3, 0, 4, 2]) await paw.bindAndClose(index, clauseFor(index));
  await expect(paw.medal).toBeVisible();
  await expect(paw.medal).toHaveAttribute('data-score', '5');
  await expect(paw.stateText).toHaveText('The paw rests.');
  await settle(paw);
  await shoot(page, testInfo, 'rested');
}

/** Stop with three curses open: the medal shows 2/5 and the paw keeps three fingers curled. */
export async function stoppedReceipt(paw: PawPage, testInfo: TestInfo): Promise<void> {
  const { page } = paw;
  await paw.open();
  await paw.makeWish();
  await paw.expectCurled(5);
  await paw.bindAndClose(1, clauseFor(1));
  await paw.bindAndClose(3, clauseFor(3));
  await expect(paw.stateText).toHaveText('3 fingers curled.');
  await paw.stopButton.click();
  await expect(paw.medal).toBeVisible();
  await expect(paw.medal).toHaveAttribute('data-score', '2');
  await expect(paw.stateText).toHaveText('3 fingers stay curled.');
  await settle(paw);
  await shoot(page, testInfo, 'stopped');
}

/** Reduced motion: the circles land at once and a close opens its finger at once. Four fingers stay curled. */
export async function reducedMotionReceipt(paw: PawPage, testInfo: TestInfo): Promise<void> {
  const { page } = paw;
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await paw.open();
  await paw.makeWish();
  await paw.expectCurled(5);
  await paw.bindAndClose(2, clauseFor(2));
  await expect(paw.stateText).toHaveText('4 fingers curled.');
  await expect(page.locator('[data-paw-finger-cue]')).toHaveText('Finger open.');
  await settle(paw);
  await shoot(page, testInfo, 'reduced-motion');
}

/** No WebGL: the poster stays, the text state says what the paw does, and the UI works. */
export async function posterOnlyReceipt(paw: PawPage, testInfo: TestInfo): Promise<void> {
  const { page } = paw;
  await page.goto('/');
  await expect(page.locator('[data-state="ready"]')).toBeVisible();
  await paw.makeWish();
  await expect(paw.stamp).toHaveText('Granted.');
  await paw.expectCurled(5);
  await paw.bindAndClose(3, clauseFor(3));
  await expect(paw.stateText).toHaveText('4 fingers curled.');
  // Settled without WebGL: no canvas, and the poster picture is decoded and visible.
  await expect(page.locator('[data-canvas-slot] canvas')).toHaveCount(0);
  await expect(page.locator('[data-poster]')).toBeVisible();
  await expect
    .poll(() => page.locator('[data-poster]').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await shoot(page, testInfo, 'poster-only');
}
