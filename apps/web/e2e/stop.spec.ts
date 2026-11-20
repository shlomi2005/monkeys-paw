// Task 44: the Stop paths and Rewrite on desktop (Req 6.6, 6.7, 6.9, 6.10, 4.4).
//
// Stop ends the round at once: no open, no rest moment (no sink, no tilt). What stays curled is a picture of the
// paw, so these tests compare pictures (support/canvas.ts). The DOM shows the end screen: the medal, the export
// buttons, the final circles and the live region.

import { CURL_MS } from '../src/scene/anim-sampler';
import { diffPictures, framesPass, settledPaw } from './support/canvas';
import { OPEN_IN_KIRO, REWRITE, TAKE_SCROLL } from './support/paw-page';
import type { PawPage } from './support/paw-page';
import { expect, test } from './support/test';
import { markTimeline, readTimeline, requireEvent, statusOf } from './support/timeline';

const clauseFor = (index: number): string =>
  `WHEN the owner of project ${index + 1} has left, THE SYSTEM SHALL let an admin delete it.`;

/** The state after "Rewrite" (Req 4.4, 6.1): no Grant, an upright open paw, an empty and focused wish line. */
async function expectUnmade(paw: PawPage, idle: Buffer): Promise<void> {
  const { page } = paw;
  await expect(paw.stamp).toHaveCount(0);
  await expect(page.locator('[data-narration]')).toHaveCount(0);
  await expect(paw.medal).toHaveCount(0);
  await expect(paw.stopButton).toHaveCount(0);
  for (const name of [TAKE_SCROLL, OPEN_IN_KIRO, REWRITE]) await expect(page.getByRole('button', { name })).toHaveCount(0);
  await expect(paw.dialog).toHaveCount(0);
  for (let i = 0; i < 5; i += 1) {
    await expect(paw.slot(i)).toHaveAttribute('data-status', 'empty');
    await expect(paw.circle(i)).toHaveCount(0);
  }
  await expect(paw.stateText).toHaveText('The paw rests, all fingers open.');
  await expect(paw.liveRegion).toContainText('The wish is unmade.');
  await expect(paw.wishInput).toHaveValue('');
  await expect(paw.wishInput).toBeFocused();
  // Upright, every digit open: the same picture as before the wish.
  const upright = await settledPaw(page);
  expect((await diffPictures(page, idle, upright)).changed, 'the paw is upright and open again').toBe(0);
}

/** Starts a round and closes the circles in `closing` (quickly), leaving the rest open. */
async function roundWithClosed(paw: PawPage, closing: readonly number[]): Promise<void> {
  await paw.makeWish();
  await paw.expectCurled(5);
  for (const index of closing) await paw.bindAndClose(index, clauseFor(index));
}

test('Stop with open curses ends without sink or tilt, and locks the circles', async ({ paw }) => {
  test.setTimeout(120_000);
  const { page, stub } = paw;

  await paw.open();
  const idle = await settledPaw(page);
  await roundWithClosed(paw, [1, 3]);
  const binds = stub.to('bind').length;
  expect(binds).toBe(2);
  // Two digits have opened (the last two curled, the little finger and the ring finger); three stay curled.
  await expect(paw.stateText).toHaveText('3 fingers curled.');
  const beforeStop = await settledPaw(page, idle);
  await expect(paw.medal).toHaveCount(0);

  // Stop with the keyboard (Req 6.6: Enter and Space work).
  await paw.stopButton.focus();
  await markTimeline(page, 'stop');
  await page.keyboard.press('Space');

  // End screen at once: medal 2/5, both export buttons, Rewrite, and no Stop.
  await expect(paw.medal).toBeVisible();
  await expect(paw.medal).toHaveAttribute('data-score', '2');
  await expect(paw.medal).toContainText('Integrity 2/5: 2 closed, 3 open');
  await expect(paw.medal.locator('[data-laurel="filled"]')).toHaveCount(2);
  await expect(paw.medal.locator('[data-laurel="outlined"]')).toHaveCount(3);
  for (const name of [TAKE_SCROLL, OPEN_IN_KIRO, REWRITE]) await expect(page.getByRole('button', { name })).toBeVisible();
  await expect(paw.stopButton).toHaveCount(0);
  await expect(paw.stateText).toHaveText('3 fingers stay curled.');
  await expect(paw.liveRegion).toContainText('You stopped. 3 curses are still open.');

  // Closed circles keep their laurel. Open circles show the cracked seal and "The paw remembers."
  for (const index of [1, 3]) await expect(paw.slot(index)).toHaveAttribute('data-status', 'closed');
  for (const index of [0, 2, 4]) {
    await expect(paw.slot(index)).toHaveAttribute('data-status', 'open-final');
    await expect(paw.slot(index)).toContainText('The paw remembers.');
    await expect(paw.circle(index)).toHaveAccessibleName(/curse, open, the paw remembers$/);
  }

  const events = await readTimeline(page);
  const stopMark = requireEvent(events, 'mark', (value) => value === 'stop');
  const medal = requireEvent(events, 'medal', (value) => value.startsWith('2|'), events.indexOf(stopMark));
  expect(medal.t - stopMark.t, 'no rest moment: the medal does not wait for sink and tilt').toBeLessThan(1_000);

  // No sink, no tilt, nothing opens: the picture is the one from before Stop, now and after a long window of frames.
  // (A rest moment lasts about two seconds, so 150 frames are enough to catch one. This waits for something not to happen.)
  expect((await diffPictures(page, beforeStop, await settledPaw(page))).changed, 'right after Stop').toBe(0);
  await framesPass(page, 150);
  expect((await diffPictures(page, beforeStop, await settledPaw(page))).changed, 'after the window').toBe(0);

  // Circles are focusable and say their final state, but open no card and send no bind request.
  for (const index of [0, 1, 2, 3, 4]) {
    await paw.circle(index).focus();
    await expect(paw.circle(index)).toBeFocused();
  }
  await paw.circle(0).click();
  await paw.circle(1).focus();
  await page.keyboard.press('Enter');
  await paw.circle(2).focus();
  await page.keyboard.press('Space');
  await paw.circle(3).click();
  await paw.circle(4).click();
  await framesPass(page, 10); // a card would open in the commit after the click
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(stub.to('bind'), 'no POST /api/bind after the end').toHaveLength(binds);
  await expect(paw.medal).toContainText('Integrity 2/5: 2 closed, 3 open');
});

test('Stop during queued curls shows one curled digit per open curse', async ({ paw }) => {
  test.setTimeout(120_000);
  const { page, stub } = paw;

  await paw.open();
  const idle = await settledPaw(page);

  // Reference: the paw after five curls played in full.
  await paw.makeWish();
  await paw.expectCurled(5);
  const allCurled = await settledPaw(page, idle);
  await paw.stopButton.click();
  await paw.page.getByRole('button', { name: REWRITE }).click();
  await expectUnmade(paw, idle);

  // Stop as soon as the first curl has started: four curls are still queued.
  await markTimeline(page, 'round 2');
  await paw.makeWish();
  await paw.stopButton.click();

  await expect(paw.medal).toBeVisible();
  await expect(paw.medal).toHaveAttribute('data-score', '0');
  await expect(paw.medal).toContainText('Integrity 0/5: 0 closed, 5 open');
  await expect(paw.medal.locator('[data-laurel="outlined"]')).toHaveCount(5);
  await expect(paw.stateText).toHaveText('5 fingers stay curled.');
  await expect(paw.liveRegion).toContainText('You stopped. 5 curses are still open.');
  for (let i = 0; i < 5; i += 1) await expect(paw.slot(i)).toHaveAttribute('data-status', 'open-final');

  // The curls that were still queued finished at once: every circle appeared in the commit that ended the round, and
  // no curl after the stop was announced the normal way.
  const events = await readTimeline(page);
  const second = events.findIndex((event) => event.key === 'mark' && event.value === 'round 2');
  const firstCurl = requireEvent(events, 'circle.0', (value) => statusOf(value) === 'arriving', second);
  const lastCircle = requireEvent(events, 'circle.4', (value) => statusOf(value) === 'open-final', second);
  // Played in full, the fifth circle would land four curls (at least 4 x CURL_MS) after the first.
  expect(lastCircle.t - firstCurl.t, 'the fifth circle did not wait for its curl').toBeLessThan(4 * CURL_MS * 0.95);
  const roundTwo = events.slice(second);
  expect(
    roundTwo.some((event) => event.key === 'live' && event.value.startsWith('Curse 5, ')),
    'the fifth curl was completed without a normal finish',
  ).toBe(false);
  expect(roundTwo.some((event) => event.key === 'circle.4' && statusOf(event.value) === 'arriving')).toBe(false);

  // The paw shows five curled digits, the same picture as the paw that played all five curls. No sink, no tilt.
  const afterStop = await settledPaw(page, idle);
  expect((await diffPictures(page, allCurled, afterStop)).changed, 'one curled digit per open curse').toBe(0);
  await framesPass(page, 150);
  expect((await diffPictures(page, allCurled, await settledPaw(page))).changed, 'nothing moves after Stop').toBe(0);
  expect(stub.to('bind')).toHaveLength(0);
});

test('Rewrite after Stop resets everything, and a new wish starts a fresh round', async ({ paw }) => {
  test.setTimeout(120_000);
  const { page, stub } = paw;

  await paw.open();
  const idle = await settledPaw(page);
  await roundWithClosed(paw, [2]);
  await paw.stopButton.click();
  await expect(paw.medal).toContainText('Integrity 1/5: 1 closed, 4 open');

  await page.getByRole('button', { name: REWRITE }).click();
  await expectUnmade(paw, idle);

  // The round after it is a whole new round: five curls again, all circles open, nothing left over.
  await paw.makeWish();
  await paw.expectCurled(5);
  for (let i = 0; i < 5; i += 1) await expect(paw.slot(i)).toHaveAttribute('data-status', 'open');
  await expect(paw.medal).toHaveCount(0);
  await expect(paw.stopButton).toBeVisible();
  expect(stub.to('grant')).toHaveLength(2);
  const events = await readTimeline(page);
  const stamps = events.filter((event) => event.key === 'stamp' && event.value.startsWith('Granted.'));
  expect(stamps.length, 'one stamp per Grant').toBe(2);
});

test('Rewrite after the paw rests puts it upright again', async ({ paw }) => {
  test.setTimeout(120_000);
  const { page } = paw;

  await paw.open();
  const idle = await settledPaw(page);
  await roundWithClosed(paw, [0, 1, 2, 3, 4]);
  await expect(paw.medal).toContainText('Integrity 5/5: 5 closed, 0 open');
  const rested = await settledPaw(page);
  expect((await diffPictures(page, idle, rested)).changed, 'the paw rests sunk and tilted').toBeGreaterThan(1000);

  await page.getByRole('button', { name: REWRITE }).click();
  await expectUnmade(paw, idle);
});

test('Rewrite in the binding card unmakes the wish', async ({ paw }) => {
  test.setTimeout(120_000);
  const { page, stub } = paw;

  await paw.open();
  const idle = await settledPaw(page);
  await roundWithClosed(paw, [4]);
  await paw.openCard(1);
  await paw.dialog.getByRole('button', { name: 'Rewrite the whole wish' }).click();

  await expect(paw.dialog).toBeHidden();
  await expectUnmade(paw, idle);
  expect(stub.to('bind'), 'the card sent nothing when it was rewritten').toHaveLength(1);
});
