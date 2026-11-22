// Task 46: reduced motion, no WebGL, `GET /api/examples` 503 and `POST /api/grant` 503
// (Req 2.9, 2.10, 3.7, 8.2; design.md A9).
//
// The no-WebGL test carries the tag `@no-webgl`. It runs only in the `desktop-no-webgl` project, whose browser is
// launched with `--disable-3d-apis` (playwright.config.ts). The other tests run in the `desktop` project.

import { READY_ROUNDS } from '../src/state/ready-rounds';
import { EXAMPLE_NOTE_MESSAGE, RESTING_MESSAGE } from '../src/api/api-messages';
import { CURL_MS, OPEN_MS } from '../src/scene/anim-sampler';
import { WISH_TEXT } from './support/fixtures';
import { clearanceOf, plateRects, rectOf, tagged } from './support/layout';
import { OPEN_IN_KIRO, REWRITE, TAKE_SCROLL } from './support/paw-page';
import { expect, test } from './support/test';
import { eventsOf, readTimeline, requireEvent, statusOf } from './support/timeline';

const clauseFor = (index: number): string =>
  `WHEN the owner of project ${index + 1} has left, THE SYSTEM SHALL let an admin delete it.`;

const FINGER_CUE = '[data-paw-finger-cue]';

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('state changes are instant, the text cues show, and the animation queue is never used', async ({ paw }) => {
    test.setTimeout(90_000);
    const { page } = paw;
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

    await paw.open();
    await paw.makeWish();

    // All five circles land together: no "arriving" circle and no curl in between.
    await paw.expectCurled(5);
    await expect(page.locator('[data-granted-stamp]')).toHaveAttribute('data-reduced-motion', 'true');
    await expect(paw.stamp).toHaveText('Granted.');
    await expect(page.locator(FINGER_CUE)).toHaveText('Finger curled.');
    // The announcement lists the whole Grant at once, not one curl at a time.
    await expect(paw.liveRegion).toContainText('Granted. 5 curses. Curse 1, ');
    await expect(paw.liveRegion).toContainText('Curse 5, ');

    let events = await readTimeline(page);
    for (let i = 0; i < 5; i += 1) {
      expect(
        eventsOf(events, `circle.${i}`).some((event) => statusOf(event.value) === 'arriving'),
        `circle ${i + 1} never waits for a curl`,
      ).toBe(false);
    }
    const landed = [0, 1, 2, 3, 4].map((i) => requireEvent(events, `circle.${i}`, (value) => statusOf(value) === 'open').t);
    expect(Math.max(...landed) - Math.min(...landed), 'the circles land in one commit, not one CURL_MS apart').toBeLessThan(
      CURL_MS / 4,
    );
    // The curls were never announced one by one: no "Curse n, ..." line of its own.
    expect(
      events.some((event) => event.key === 'live' && /^Curse \d, /.test(event.value)),
      'no curl finished on its own',
    ).toBe(false);

    // A close opens its finger at once: the count drops in the same commit, and the cue says so.
    await paw.bindAndClose(2, clauseFor(2));
    await expect(paw.stateText).toHaveText('4 fingers curled.');
    await expect(page.locator(FINGER_CUE)).toHaveText('Finger open.');
    await expect(paw.liveRegion).toContainText('Closed. The seal holds.');
    await expect(paw.liveRegion).toContainText('Finger opens.');

    for (const index of [0, 1, 3, 4]) await paw.bindAndClose(index, clauseFor(index));

    // No open of OPEN_MS and no rest moment: the medal comes with the last close, and the live region says the paw rests.
    await expect(paw.medal).toBeVisible();
    await expect(paw.medal).toHaveAttribute('data-score', '5');
    await expect(paw.stateText).toHaveText('The paw rests.');
    await expect(paw.liveRegion).toContainText('The paw rests.');
    for (const name of [TAKE_SCROLL, OPEN_IN_KIRO, REWRITE]) await expect(page.getByRole('button', { name })).toBeVisible();

    events = await readTimeline(page);
    const lastClose = requireEvent(events, 'circle.4', (value) => statusOf(value) === 'closed');
    const medal = requireEvent(events, 'medal', (value) => value.startsWith('5|'));
    expect(medal.t - lastClose.t, 'the medal does not wait for an open and a rest moment').toBeLessThan(OPEN_MS);
    const rests = requireEvent(events, 'live', (value) => value.includes('The paw rests.'));
    expect(rests.t - lastClose.t).toBeLessThan(OPEN_MS);
  });

  test('Stop is instant too, and the cue stays until the next change', async ({ paw }) => {
    const { page } = paw;
    await paw.open();
    await paw.makeWish();
    await paw.expectCurled(5);
    await expect(page.locator(FINGER_CUE)).toHaveText('Finger curled.');
    await paw.stopButton.click();
    await expect(paw.medal).toBeVisible();
    await expect(paw.stateText).toHaveText('5 fingers stay curled.');
    await expect(page.locator(FINGER_CUE)).toHaveText('Finger curled.');
    for (let i = 0; i < 5; i += 1) await expect(paw.slot(i)).toHaveAttribute('data-status', 'open-final');
  });
});

test('without reduced motion the same wish curls one finger at a time (the contrast)', async ({ paw }) => {
  const { page } = paw;
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
  await paw.open();
  await paw.makeWish();
  await paw.expectCurled(5);
  await expect(page.locator(FINGER_CUE)).toHaveCount(0);
  const events = await readTimeline(page);
  const first = requireEvent(events, 'circle.0', (value) => statusOf(value) === 'arriving');
  const last = requireEvent(events, 'circle.4', (value) => statusOf(value) === 'arriving');
  expect(last.t - first.t, 'the queue spaces the curls').toBeGreaterThanOrEqual(4 * CURL_MS * 0.95);
});

test('no WebGL: the poster stays, the text state shows, and the whole UI works', { tag: '@no-webgl' }, async ({ paw }) => {
  test.setTimeout(90_000);
  const { page } = paw;
  const glbs: string[] = [];
  page.on('request', (request) => {
    if (/\.glb(\?|$)/.test(request.url())) glbs.push(request.url());
  });

  await page.goto('/');
  await expect(page.locator('[data-state="ready"]')).toBeVisible();

  // The browser really has no WebGL: this is the probe the app itself runs (src/scene/webgl-support.ts).
  const webgl = await page.evaluate(() => ({
    webgl2: document.createElement('canvas').getContext('webgl2') !== null,
    webgl: document.createElement('canvas').getContext('webgl') !== null,
  }));
  expect(webgl, 'the launch flag turns WebGL off').toEqual({ webgl2: false, webgl: false });

  // The poster is the paw, and it stays. No canvas ever mounts.
  await expect(page.locator('[data-poster]')).toBeVisible();
  await expect(page.locator('[data-canvas-slot] canvas')).toHaveCount(0);
  await expect(paw.stateText).toHaveText('The paw rests, all fingers open.');

  // A whole round: wish, five curses, five binds, rest.
  await paw.makeWish();
  await expect(paw.stamp).toHaveText('Granted.');
  await paw.expectCurled(5);
  await expect(page.locator('[data-poster]')).toBeVisible();
  await paw.bindAndClose(3, clauseFor(3));
  await expect(paw.stateText).toHaveText('4 fingers curled.');
  for (const index of [0, 1, 2, 4]) await paw.bindAndClose(index, clauseFor(index));

  await expect(paw.medal).toBeVisible();
  await expect(paw.medal).toHaveAttribute('data-score', '5');
  await expect(paw.stateText).toHaveText('The paw rests.');
  await expect(page.locator('[data-poster]')).toBeVisible();
  await expect(page.locator('[data-canvas-slot] canvas')).toHaveCount(0);
  for (const name of [TAKE_SCROLL, OPEN_IN_KIRO, REWRITE]) await expect(page.getByRole('button', { name })).toBeVisible();

  // The scroll still downloads, and a second wish can start after Rewrite.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: TAKE_SCROLL }).click()]);
  expect(download.suggestedFilename()).toBe('monkeys-paw-wish-e2e-1.zip');
  await page.getByRole('button', { name: REWRITE }).click();
  await expect(paw.wishInput).toBeFocused();
  await expect(paw.stateText).toHaveText('The paw rests, all fingers open.');

  expect(glbs, 'no model file is requested without WebGL').toEqual([]);
  expect(paw.stub.to('bind')).toHaveLength(5);
});

test('GET /api/examples 503 shows the ready rounds, which play with no tick', async ({ paw }) => {
  test.setTimeout(120_000);
  const { page, stub } = paw;
  stub.behavior.failWith.examples = 503;

  await page.goto('/');
  await expect(page.locator('[data-state="ready"]')).toBeVisible();
  const cards = page.getByRole('list', { name: 'Example wishes' }).getByRole('button');
  await expect(cards).toHaveCount(3);
  await expect(page.getByRole('alert')).toHaveCount(0);

  await cards.nth(0).click();
  await paw.seal.click();
  await expect(paw.adultBox).not.toBeChecked();
  await expect(paw.stamp).toHaveText('Granted.');
  const note = page.locator('[data-example-note]');
  await expect(note).toHaveText(EXAMPLE_NOTE_MESSAGE);
  await expect(note).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(note).toBeInViewport();

  const round = READY_ROUNDS[0];
  if (round === undefined) throw new Error('no ready round');
  for (let index = 0; index < round.grant.curses.length; index++) {
    await paw.openCard(index);
    const marks = await paw.dialog.locator('blockquote').evaluate((el) => [getComputedStyle(el, '::before').content, getComputedStyle(el, '::after').content]);
    expect(marks).toEqual(['none', 'none']);
    await expect(paw.dialog.getByText(EXAMPLE_NOTE_MESSAGE)).toBeVisible();
    await paw.dialog.getByRole('button', { name: 'Accept this clause' }).click();
    await expect(paw.dialog).toBeHidden();
  }

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Take the scroll/ }).click()]);
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).toString('utf8').split(EXAMPLE_NOTE_MESSAGE)).toHaveLength(3);
  expect(stub.to('grant')).toHaveLength(0);
  expect(stub.to('bind')).toHaveLength(0);
});

test('resting on arrival with a valid list shows the first ready round and sends no grant', async ({ paw }) => {
  test.setTimeout(90_000);
  const { page, stub } = paw;
  stub.behavior.resting = true;
  await page.goto('/');
  const round = READY_ROUNDS[0];
  if (round === undefined) throw new Error('no ready round');
  const first = page.getByRole('list', { name: 'Example wishes' }).getByRole('button').nth(0);
  await expect(first).toContainText(round.wish.text);
  await first.click();
  await paw.seal.click();
  await expect(paw.stamp).toHaveText('Granted.');
  expect(stub.to('grant')).toHaveLength(0);
});

test('a 503 on grant shows the resting message, then an untouched example replays without a request', async ({ paw }) => {
  test.setTimeout(90_000);
  const { page, stub } = paw;
  stub.behavior.failWith.grant = 503;

  await paw.open();
  await paw.makeWish();

  // The resting message, no Grant: no stamp, no circles, no Stop, the wish line free again.
  const message = page.locator('form').getByText(RESTING_MESSAGE);
  await expect(message).toBeVisible();
  await expect(paw.liveRegion).toContainText(RESTING_MESSAGE);
  await expect(paw.stamp).toHaveCount(0);
  await expect(paw.stopButton).toHaveCount(0);
  for (let i = 0; i < 5; i += 1) await expect(paw.slot(i)).toHaveAttribute('data-status', 'empty');
  await expect(paw.wishInput).toBeEnabled();
  await expect(paw.wishInput).toHaveValue(WISH_TEXT);
  await expect(paw.stateText).toHaveText('The paw rests, all fingers open.');
  expect(stub.to('grant').map((request) => request.status)).toEqual([503]);

  // Examples-only (A9): a typed wish is not sent. It gets the resting message again.
  await paw.wishInput.fill('Nobody can reset a password twice in one day');
  await page.getByRole('button', { name: 'Make the wish' }).click();
  await expect(message).toBeVisible();
  await expect(paw.stamp).toHaveCount(0);
  expect(stub.to('grant'), 'a typed wish sends no request in examples-only mode').toHaveLength(1);

  // The ready rounds replace the row. One that is picked and then edited is a typed wish too.
  const round = READY_ROUNDS[1];
  const count = round.grant.curses.length;
  const cards = page.getByRole('list', { name: 'Example wishes' }).getByRole('button');
  await cards.nth(1).click();
  await expect(paw.wishInput).toHaveValue(round.wish.text);
  await paw.wishInput.fill(`${round.wish.text}, mostly`);
  await page.getByRole('button', { name: 'Make the wish' }).click();
  await expect(message).toBeVisible();
  await expect(paw.stamp).toHaveCount(0);
  expect(stub.to('grant')).toHaveLength(1);

  // An untouched ready round replays its Grant: its curses, no grant request.
  await cards.nth(1).click();
  await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Make the wish' }).click();
  await expect(paw.stamp).toHaveText('Granted.');
  await expect(page.locator('[data-narration]')).toHaveText(round.grant.narration);
  await paw.expectCurled(count);
  await expect(paw.stopButton).toBeVisible();
  expect(stub.to('grant'), 'the replay sends no POST /api/grant').toHaveLength(1);

  // The Judge's line is the example note: the card opens, Accept is live, and Cancel sends no bind request.
  await paw.openCard(0);
  await expect(paw.dialog.getByText(EXAMPLE_NOTE_MESSAGE)).toBeVisible();
  await expect(paw.dialog.getByRole('button', { name: 'Accept this clause' })).not.toHaveAttribute('aria-disabled', 'true');
  await paw.dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(paw.dialog).toBeHidden();
  await expect(paw.slot(0)).toHaveAttribute('data-status', 'open');
  expect(stub.to('bind')).toHaveLength(0);

  // Stop still ends the round, with the medal and no closed curse.
  await paw.stopButton.click();
  await expect(paw.medal).toContainText(`Integrity 0/5: 0 closed, ${count} open`);
  expect(stub.to('grant')).toHaveLength(1);
  expect(stub.to('bind')).toHaveLength(0);
});

// The poster is a round medallion. Its drawn shape (a circle, not its square box) must stay clear of every disc, label
// and caption of the ring, by at least 0.5 rem less a pixel, while the picture is still shown. No WebGL, so the poster
// is on screen the whole time, the same picture the scene-loading state shows.
for (const [width, height] of [
  [1024, 768],
  [1280, 800],
  [1440, 900],
] as const) {
  test(`no WebGL: the poster medallion stays off the discs, labels and captions at ${width}x${height}`, { tag: '@no-webgl' }, async ({ paw }) => {
    test.setTimeout(90_000);
    const { page } = paw;
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.locator('[data-state="ready"]')).toBeVisible();
    await paw.makeWish();
    await paw.expectCurled(5);
    await expect(paw.stamp).toHaveText('Granted.');
    await expect(page.locator('[data-canvas-slot] canvas')).toHaveCount(0);

    const poster = page.locator('[data-poster]');
    await expect(poster).toBeVisible();
    await expect.poll(() => poster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

    // The drawn shape is a circle: a square box with a 50% radius, centred in the paw box, which keeps its size.
    const shape = await poster.evaluate((img) => ({ radius: getComputedStyle(img).borderTopLeftRadius, width: img.clientWidth }));
    expect(shape.radius, 'the poster is round').toBe('50%');
    const box = await rectOf(page, '[data-paw-stage]');
    const rect = await rectOf(page, '[data-poster]');
    expect(rect.x1 - rect.x0, 'a square').toBeCloseTo(rect.y1 - rect.y0, 1);
    expect(rect.x1 - rect.x0, 'a real picture, not a speck').toBeGreaterThan((box.x1 - box.x0) * 0.6);
    expect(rect.x0 + rect.x1, 'centred horizontally').toBeCloseTo(box.x0 + box.x1, 0);
    expect(rect.y0 + rect.y1, 'centred vertically').toBeCloseTo(box.y0 + box.y1, 0);
    const circle = { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2, r: (rect.x1 - rect.x0) / 2 };

    const rects = await plateRects(page);
    const others = tagged(rects, ['discs', 'labels', 'captions']);
    expect(others.filter((entry) => entry.name.startsWith('discs')), 'five discs').toHaveLength(5);
    expect(others.filter((entry) => entry.name.startsWith('labels')), 'five labels').toHaveLength(5);
    expect(others.filter((entry) => entry.name.startsWith('captions')), 'five captions').toHaveLength(5);
    const clearances = others.map((entry) => ({ name: entry.name, gap: clearanceOf(circle, entry.rect) }));
    const nearest = clearances.reduce((a, b) => (b.gap < a.gap ? b : a));
    test.info().annotations.push({ type: 'poster-clearance', description: `${width}x${height}: ${nearest.name} ${nearest.gap.toFixed(1)} px` });
    console.log(`poster clearance ${width}x${height}: ${nearest.name} ${nearest.gap.toFixed(1)} px (poster ${(2 * circle.r).toFixed(0)} px in a ${(box.x1 - box.x0).toFixed(0)} px box)`);
    for (const { name, gap } of clearances) expect(gap, `the poster circle clears ${name}`).toBeGreaterThanOrEqual(8);
  });
}
