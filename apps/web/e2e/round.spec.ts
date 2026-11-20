// Task 43: a full round on desktop against the stubbed API (Req 2.7, 2.8, 4.3, 5.1 to 5.4, 6.1, 6.2, 6.8).
//
// What the DOM can show: when each curl starts (the circle appears as "arriving"), when it ends (the live region says
// "Curse n, ..." and the circles become openable), when a verdict lands (the circle is sealed, the live region speaks),
// and when the rest moment ends (the medal and "The paw rests."). What only the canvas can show: which digit moves.
// For that the tests compare pictures of the paw (support/canvas.ts). Opening a digit has no DOM signal of its own.

import { strFromU8, unzipSync } from 'fflate';
import { CURL_MS, OPEN_MS, REST_MS } from '../src/scene/anim-sampler';
import { diffPictures, framesPass, paintPaw, settledPaw } from './support/canvas';
import type { PictureDiff } from './support/canvas';
import { grantFixture, WISH_TEXT } from './support/fixtures';
import { OPEN_IN_KIRO, REWRITE, TAKE_SCROLL } from './support/paw-page';
import { expect, test } from './support/test';
import { readTimeline, requireEvent, statusOf } from './support/timeline';

/** Software GL has frame hiccups: a duration may be longer than the animation, never shorter (minus a frame). */
const NOT_SHORTER = 0.95;
const NOT_LONGER_THAN = 4_000;

/** Circles are bound in this order, which is not the order they curled in (0, 1, 2, 3, 4). */
const BIND_ORDER = [3, 1, 4, 0, 2] as const;

const clauseFor = (index: number): string =>
  `WHEN the owner of project ${index + 1} has left, THE SYSTEM SHALL let an admin delete it.`;

const centre = (diff: PictureDiff): number => {
  if (diff.box === null) throw new Error('The pictures are the same, there is no box');
  return (diff.box.x0 + diff.box.x1) / 2;
};

async function bytesOf(download: { createReadStream(): Promise<NodeJS.ReadableStream | null> }): Promise<Uint8Array> {
  const stream = await download.createReadStream();
  if (stream === null) throw new Error('The download has no content');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return new Uint8Array(Buffer.concat(chunks));
}

test('five curls one at a time, binds in another order, opens last-in first-out, then the paw rests', async ({ paw }) => {
  test.setTimeout(150_000);
  const { page, stub } = paw;
  const grant = grantFixture(5);

  // Before the wish: the paw rests, nothing else is shown.
  await paw.open();
  await expect(paw.stateText).toHaveText('The paw rests, all fingers open.');
  await expect(paw.stamp).toHaveCount(0);
  await expect(paw.stopButton).toHaveCount(0);
  await expect(paw.medal).toHaveCount(0);
  const idle = await settledPaw(page);

  // The wish. "Granted." is stamped, and the Genie's line is shown.
  await paw.makeWish();
  await expect(paw.stamp).toHaveText('Granted.');
  await expect(page.locator('[data-narration]')).toHaveText(grant.narration);
  await paw.expectCurled(5);
  const curled = await settledPaw(page);
  expect((await diffPictures(page, idle, curled)).changed, 'five curled digits look different from an open paw').toBeGreaterThan(1000);

  expect(stub.to('grant')).toHaveLength(1);
  const grantRequest = stub.to('grant')[0]!;
  expect(grantRequest.method).toBe('POST');
  expect(grantRequest.headers['content-type']).toContain('application/json');
  expect((grantRequest.body as { wish: { text: string } }).wish.text).toBe(WISH_TEXT);

  // Curls, one at a time. Circle i appears when curl i starts. Curl i is over when the live region reads "Curse i+1",
  // and that is the moment circle i+1 appears. So the circles land one CURL_MS after each other, never together.
  let events = await readTimeline(page);
  requireEvent(events, 'stamp', (value) => value.startsWith('Granted.'));
  const granted = requireEvent(events, 'live', (value) => value.startsWith('Granted. 5 curses arrive.'));
  const arrived = [0, 1, 2, 3, 4].map((i) => requireEvent(events, `circle.${i}`, (value) => statusOf(value) === 'arriving'));
  const curlDone = [0, 1, 2, 3, 4].map((i) =>
    requireEvent(events, 'live', (value) => value.startsWith(`Curse ${i + 1}, `)),
  );
  expect(arrived[0]!.t, 'the first circle lands with the grant').toBeGreaterThanOrEqual(granted.t);
  expect(requireEvent(events, 'stop', (value) => value === 'shown').t, 'Stop shows from the first curl').toBeLessThanOrEqual(arrived[0]!.t);
  for (let i = 0; i < 5; i += 1) {
    const length = curlDone[i]!.t - arrived[i]!.t;
    expect(length, `curl ${i + 1} takes CURL_MS`).toBeGreaterThanOrEqual(CURL_MS * NOT_SHORTER);
    expect(length, `curl ${i + 1} does not stall`).toBeLessThan(NOT_LONGER_THAN);
    if (i < 4) expect(arrived[i + 1]!.t, `circle ${i + 2} lands when curl ${i + 1} is over`).toBeGreaterThanOrEqual(curlDone[i]!.t - 1);
  }
  // Every circle is an arriving circle (not yet openable) until the last curl is over, then all five open at once.
  for (let i = 0; i < 5; i += 1) {
    const opened = requireEvent(events, `circle.${i}`, (value) => statusOf(value) === 'open');
    expect(opened.t, `circle ${i + 1} can be bound once the fifth curl is over`).toBeGreaterThanOrEqual(curlDone[4]!.t - 1);
    expect(opened.value).toMatch(/curse, open, click to bind$/);
  }

  // Binds, in an order that is not the curl order. Each close seals its own circle and opens the last digit curled.
  const stepCentres: number[] = [];
  const changedVsIdle: number[] = [(await diffPictures(page, idle, curled)).changed];
  const stepTops: number[] = [];
  let before = curled;
  for (const [n, index] of BIND_ORDER.entries()) {
    const clause = clauseFor(index);
    await paw.openCard(index);
    await paw.submitClause(clause);
    await expect(paw.dialog).toBeHidden();
    await expect(paw.slot(index)).toHaveAttribute('data-status', 'closed');
    await expect(paw.circle(index)).toHaveAccessibleName(/curse, closed, sealed$/);
    const left = 4 - n;
    await expect(paw.stateText).toHaveText(left === 0 ? 'The paw rests.' : left === 1 ? '1 finger curled.' : `${left} fingers curled.`);

    const bind = stub.to('bind')[n]!;
    expect(bind.body).toMatchObject({ curseId: `curse-${index + 1}`, clause, kind: 'ears-clause' });
    expect((bind.body as { grant: { curses: unknown[] } }).grant.curses).toHaveLength(5);

    if (n < 4) {
      // The open takes OPEN_MS and only one digit moves: the picture changes in one narrow strip.
      const after = await settledPaw(page, before);
      const step = await diffPictures(page, before, after);
      expect(step.changed, `closing circle ${index + 1} moves a digit`).toBeGreaterThan(100);
      expect(step.box!.x1 - step.box!.x0, 'one digit, not the whole paw').toBeLessThan(step.width / 6);
      stepCentres.push(centre(step));
      stepTops.push(step.box!.y0);
      const sinceIdle = await diffPictures(page, idle, after);
      changedVsIdle.push(sinceIdle.changed);
      if (n === 3) {
        // One digit is left curled. It lies below every fingertip: the thumb.
        expect(sinceIdle.box!.y0, 'the digit left curled is the thumb, lower than any finger').toBeGreaterThan(Math.max(...stepTops));
      }
      before = after;
    }
  }

  // LIFO: the digits opened from the little finger towards the index, so each strip lies to the right of the last one,
  // and the paw looks more and more like an open paw.
  for (let i = 1; i < stepCentres.length; i += 1) {
    expect(stepCentres[i], `open ${i + 1} is beside open ${i}, towards the thumb`).toBeGreaterThan(stepCentres[i - 1]!);
  }
  for (let i = 1; i < changedVsIdle.length; i += 1) {
    expect(changedVsIdle[i], `after ${i} closes`).toBeLessThan(changedVsIdle[i - 1]!);
  }

  // Rest moment: the last open (the thumb), then about two seconds of sink and tilt, then the medal.
  await expect(paw.medal).toBeVisible();
  await expect(paw.medal).toHaveAttribute('data-score', '5');
  await expect(paw.medal).toContainText('Integrity 5/5: 5 closed, 0 open');
  await expect(paw.medal.locator('[data-laurel="filled"]')).toHaveCount(5);
  await expect(paw.medal.locator('[data-laurel="outlined"]')).toHaveCount(0);
  await expect(paw.liveRegion).toContainText('The paw rests.');
  await expect(paw.stopButton).toHaveCount(0);
  await expect(paw.stateText).toHaveText('The paw rests.');
  for (let i = 0; i < 5; i += 1) await expect(paw.slot(i)).toHaveAttribute('data-status', 'closed');
  for (const name of [TAKE_SCROLL, OPEN_IN_KIRO, REWRITE]) await expect(page.getByRole('button', { name })).toBeVisible();

  events = await readTimeline(page);
  const lastClose = requireEvent(events, 'circle.2', (value) => statusOf(value) === 'closed');
  const medal = requireEvent(events, 'medal', (value) => value.startsWith('5|'));
  const rests = requireEvent(events, 'live', (value) => value === 'The paw rests.');
  expect(medal.t - lastClose.t, 'the last open and the rest moment come before the medal').toBeGreaterThanOrEqual(
    (OPEN_MS + REST_MS) * NOT_SHORTER,
  );
  expect(medal.t - lastClose.t).toBeLessThan(OPEN_MS + REST_MS + NOT_LONGER_THAN);
  expect(Math.abs(medal.t - rests.t), 'the medal arrives with "The paw rests."').toBeLessThan(50);
  expect(requireEvent(events, 'export', (value) => value === `${TAKE_SCROLL},${OPEN_IN_KIRO}`).t).toBeGreaterThanOrEqual(rests.t - 1);

  // The rested paw is sunk and tilted: it differs from the upright, open paw it started as.
  const rested = await settledPaw(page);
  const sunk = await diffPictures(page, idle, rested);
  expect(sunk.changed, 'sink and tilt change the picture').toBeGreaterThan(1000);
  expect(sunk.box!.y1, 'the paw has sunk below its idle position').toBeGreaterThan((await diffPictures(page, idle, curled)).box!.y1);
});

test('closes in a hurry queue their opens, and both export buttons deliver the spec', async ({ paw }) => {
  test.setTimeout(150_000);
  const { page, stub } = paw;

  await paw.open();
  await paw.makeWish();
  await paw.expectCurled(5);

  // Five binds back to back, much faster than one open takes (OPEN_MS). The paw must still open one digit at a time.
  const order = [4, 2, 0, 3, 1];
  for (const index of order) await paw.bindAndClose(index, clauseFor(index));
  await expect(paw.medal).toBeVisible();

  const events = await readTimeline(page);
  const firstClose = requireEvent(events, 'circle.4', (value) => statusOf(value) === 'closed');
  const medal = requireEvent(events, 'medal', (value) => value.startsWith('5|'));
  const lastClose = requireEvent(events, 'circle.1', (value) => statusOf(value) === 'closed');
  expect(lastClose.t - firstClose.t, 'the binds really were quicker than the opens').toBeLessThan(OPEN_MS * 2);
  expect(medal.t - firstClose.t, 'five opens and the rest moment, one after the other').toBeGreaterThanOrEqual(
    (5 * OPEN_MS + REST_MS) * NOT_SHORTER,
  );

  // Take the scroll: a zip named after the wish id, with both files, holding every closed clause.
  const scrollButton = page.getByRole('button', { name: TAKE_SCROLL });
  const [download] = await Promise.all([page.waitForEvent('download'), scrollButton.click()]);
  expect(download.suggestedFilename()).toBe('monkeys-paw-wish-e2e-1.zip');
  const files = unzipSync(await bytesOf(download));
  expect(Object.keys(files).sort()).toEqual(['properties.md', 'requirements.md']);
  const requirements = strFromU8(files['requirements.md']!);
  const properties = strFromU8(files['properties.md']!);
  for (let index = 0; index < 5; index += 1) expect(requirements, `clause of circle ${index + 1}`).toContain(clauseFor(index));
  expect(requirements).toContain('**Wish Integrity:** 5/5 (5/5 curses closed)');
  expect(requirements).toContain(WISH_TEXT);
  expect(properties.split('\n').filter((line) => line.startsWith('- *For any*'))).toHaveLength(5);
  await expect(page.locator('[data-slot="export"] [role="status"]')).toHaveText('Scroll saved!');

  // Open in Kiro: a dialog with the folder name and the command, and a zip of the folder.
  await page.getByRole('button', { name: OPEN_IN_KIRO }).click();
  const kiro = page.getByRole('dialog', { name: 'Open in Kiro' });
  await expect(kiro).toBeVisible();
  const folder = 'monkeys-paw-only-the-owner-can-delete-a-proj';
  await expect(kiro.getByLabel('Folder name')).toHaveValue(folder);
  await expect(kiro.getByLabel('Command')).toHaveValue(`kiro open ${folder}`);
  const [folderDownload] = await Promise.all([
    page.waitForEvent('download'),
    kiro.getByRole('button', { name: 'Download the folder (.zip)' }).click(),
  ]);
  const folderFiles = unzipSync(await bytesOf(folderDownload));
  expect(Object.keys(folderFiles).sort()).toEqual([`${folder}/properties.md`, `${folder}/requirements.md`]);
  expect(strFromU8(folderFiles[`${folder}/requirements.md`]!)).toContain(clauseFor(0));
  await kiro.getByRole('button', { name: 'Close' }).click();
  await expect(kiro).toBeHidden();

  // One export request per button, each with the finished round: five closed curses with the clauses typed.
  const exports = stub.to('export');
  expect(exports).toHaveLength(2);
  for (const request of exports) {
    expect(request.method).toBe('POST');
    const body = request.body as { wish: { text: string }; grant: { curses: { status: string; binding?: { clause: string } }[] } };
    expect(body.wish.text).toBe(WISH_TEXT);
    expect(body.grant.curses.map((curse) => curse.status)).toEqual(Array(5).fill('closed'));
    expect(body.grant.curses.map((curse) => curse.binding?.clause)).toEqual([0, 1, 2, 3, 4].map(clauseFor));
  }
  expect(stub.to('bind')).toHaveLength(5);
});

test('a verdict that does not close leaves the card open and the paw as it was', async ({ paw }) => {
  test.setTimeout(90_000);
  const { page, stub } = paw;
  stub.behavior.closes = () => false;

  await paw.open();
  await paw.makeWish();
  await paw.expectCurled(5);
  const curled = await settledPaw(page);

  await paw.openCard(1);
  await paw.submitClause('The owner can delete.');
  await expect(paw.dialog.getByText('The paw remembers.')).toBeVisible();
  await expect(paw.dialog).toBeVisible();
  await expect(paw.liveRegion).toContainText('Not closed. The paw remembers.');
  await expect(paw.slot(1)).toHaveAttribute('data-status', 'open');
  await expect(paw.stateText).toHaveText('5 fingers curled.');
  await expect(paw.stopButton).toBeVisible();
  await expect(paw.medal).toHaveCount(0);

  // Nothing may move. A finger that starts to open would show within a few frames of the verdict, and a whole open
  // takes OPEN_MS (about 72 frames at 60 per second), so this bounded window of 120 frames is enough to see it.
  // This is the one place that waits for something not to happen.
  await framesPass(page, 120);
  expect((await diffPictures(page, curled, await paintPaw(page))).changed, 'the paw did not move').toBe(0);
  for (let i = 0; i < 5; i += 1) expect(await paw.slot(i).getAttribute('data-status')).toBe('open');

  const events = await readTimeline(page);
  expect(requireEvent(events, 'dialog.remembers', (value) => value === 'yes')).toBeDefined();
  expect(events.some((event) => event.key === 'circle.1' && statusOf(event.value) === 'closed')).toBe(false);

  // The card is still usable: a better clause, a closing verdict, and exactly one digit opens.
  stub.behavior.closes = () => true;
  await paw.submitClause(clauseFor(1));
  await expect(paw.dialog).toBeHidden();
  await expect(paw.slot(1)).toHaveAttribute('data-status', 'closed');
  await expect(paw.stateText).toHaveText('4 fingers curled.');
  expect(stub.to('bind').map((request) => (request.body as { curseId: string }).curseId)).toEqual(['curse-2', 'curse-2']);
  const opened = await settledPaw(page, curled);
  expect((await diffPictures(page, curled, opened)).changed).toBeGreaterThan(100);
});
