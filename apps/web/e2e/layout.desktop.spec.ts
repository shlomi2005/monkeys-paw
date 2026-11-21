// The plate polish on the desktop (paw-web design.md, "Plate polish"): the "Granted." stamp never lies on the paw, the
// paw is the clear centre of the plate, nothing on the plate covers anything else, the longest narration is shown in
// full, and the plate has no empty band between the ring and the wish line. Measured in the real page at 1280x800 and
// 1440x900, in every phase of a round. The mobile counterpart is layout.mobile.spec.ts.
//
// The paw is drawn in WebGL, so its place is found from two pictures of the paw box (support/layout.ts, the silhouette).
// The silhouette is the union of the idle, curled, half-closed and rested poses, so a pose in between cannot hide a miss.

import type { Page } from '@playwright/test';
import { LONGEST_NARRATION, SHORT_NARRATION } from './support/fixtures';
import {
  boundsOf,
  boxPixels,
  countIn,
  clauseFor,
  height,
  narrationIsWhole,
  overlaps,
  paintSilhouette,
  plateRects,
  rectOf,
  scrollWidths,
  stampRect,
  tagged,
  tallestEmptyBand,
  unionOf,
  width,
} from './support/layout';
import type { PlateRects, Rect, Silhouette } from './support/layout';
import { expect, test } from './support/test';
import type { PawPage } from './support/paw-page';

const SIZES = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

/** (a, c) The paw may touch a box with at most this share of the box's pixels (antialiasing at the edges). */
const PAW_ALLOWANCE = 0.005;
/** (a) The stamp keeps at least this many CSS pixels between its edge and the paw's. */
const STAMP_GAP = 8;
/** (e) The tallest strip of the plate, across its whole width, that has nothing in it. About two lines of text. */
const MAX_EMPTY_BAND = 48;
/** (f) The paw box is at least this share of the viewport height; the paw itself (idle) at least this share. */
const MIN_BOX_SHARE = 0.44;
const MIN_PAW_SHARE = 0.34;
/** (g) The longest narration fits in this many lines on the desktop plate. */
const NARRATION_LINES = 4;

const TEXT_GROUPS = ['discs', 'labels', 'captions', 'stateText', 'narration'] as const;
const CONTROL_GROUPS = ['medal', 'buttons'] as const;

interface Phase {
  readonly name: string;
  readonly rects: PlateRects;
  readonly stamp: Rect | null;
  readonly wishTop: number;
  readonly wishBottom: number;
}

async function readPhase(paw: PawPage, name: string): Promise<Phase> {
  const { page } = paw;
  const rects = await plateRects(page);
  const wish = await rectOf(page, '[data-wish-line]');
  const button = await rectOf(page, 'button[aria-label="Make the wish"]');
  return {
    name,
    rects,
    stamp: rects.stamp.length > 0 ? await stampRect(page) : null,
    wishTop: wish.y0,
    wishBottom: button.y1,
  };
}

/** Nothing on the plate sits on anything else: every pair of boxes is apart (the paw is checked on its own). */
function expectNoOverlap(phase: Phase): void {
  const parts = tagged(phase.rects, [...TEXT_GROUPS, ...CONTROL_GROUPS]);
  if (phase.stamp !== null) parts.push({ name: 'stamp', rect: phase.stamp });
  for (let i = 0; i < parts.length; i += 1) {
    for (let j = i + 1; j < parts.length; j += 1) {
      const [a, b] = [parts[i]!, parts[j]!];
      // A caption belongs to its disc and label: they touch by design.
      const family = (name: string): boolean => /^(discs|labels|captions)\[/.test(name);
      if (family(a.name) && family(b.name) && a.name.split('[')[1] === b.name.split('[')[1]) continue;
      expect(overlaps(a.rect, b.rect), `${phase.name}: ${a.name} and ${b.name} overlap`).toBe(false);
    }
  }
}

/** (c) The paw covers no text, disc, label, caption or control (at most 0.5% of the box's pixels). */
function expectPawClear(silhouette: Silhouette, phase: Phase): void {
  const boxes = tagged(phase.rects, [...TEXT_GROUPS, ...CONTROL_GROUPS]);
  if (phase.stamp !== null) boxes.push({ name: 'stamp', rect: phase.stamp });
  for (const { name, rect } of boxes) {
    const covered = countIn(silhouette, rect);
    expect(covered, `${phase.name}: the paw covers ${covered} px of ${name}`).toBeLessThanOrEqual(
      Math.ceil(PAW_ALLOWANCE * boxPixels(silhouette, rect)),
    );
  }
}

/** (a) The stamp is clear of the paw and of the wrist cord, and level with the wrist, beside it. */
function expectStampOffPaw(silhouette: Silhouette, phase: Phase): void {
  const stamp = phase.stamp;
  expect(stamp, `${phase.name}: the stamp is shown`).not.toBeNull();
  if (stamp === null) return;
  const onPaw = countIn(silhouette, stamp);
  expect(onPaw, `${phase.name}: the paw is on ${onPaw} px of the stamp`).toBeLessThanOrEqual(
    Math.ceil(PAW_ALLOWANCE * boxPixels(silhouette, stamp)),
  );
  expect(countIn(silhouette, stamp, 'cord'), `${phase.name}: the wrist cord is under the stamp`).toBe(0);
  const pawBounds = boundsOf(silhouette)!;
  const centreX = (silhouette.box.x0 + silhouette.box.x1) / 2;
  if (stamp.x0 > centreX) {
    expect(stamp.x0 - pawBounds.x1, `${phase.name}: the stamp is ${stamp.x0 - pawBounds.x1} px from the paw`).toBeGreaterThanOrEqual(STAMP_GAP);
  }
  const box = silhouette.box;
  expect(stamp.x0, `${phase.name}: the stamp is inside the plate`).toBeGreaterThanOrEqual(0);
  expect(stamp.y0, `${phase.name}: the stamp is not above the paw box`).toBeGreaterThanOrEqual(box.y0);
}

/** (e) No full-width strip taller than MAX_EMPTY_BAND between the top of the plate and the wish line. */
function expectNoEmptyBand(silhouette: Silhouette, phase: Phase): void {
  const rects: Rect[] = tagged(phase.rects).map((one) => one.rect);
  const pawBounds = boundsOf(silhouette);
  if (pawBounds !== null) rects.push(pawBounds);
  const top = Math.min(...rects.map((rect) => rect.y0));
  const band = tallestEmptyBand(rects, top, phase.wishTop);
  expect(band.height, `${phase.name}: an empty band of ${band.height.toFixed(0)} px at y ${band.y.toFixed(0)}`).toBeLessThanOrEqual(MAX_EMPTY_BAND);
}

/** (h) The first row of the wish line is on the first screen, and nothing sticks out sideways. */
async function expectFirstScreen(page: Page, phase: Phase, view: { width: number; height: number }): Promise<void> {
  expect(phase.wishBottom, `${phase.name}: the wish button ends at ${phase.wishBottom.toFixed(0)}, the screen at ${view.height}`).toBeLessThanOrEqual(view.height);
  const [scroll, client] = await scrollWidths(page);
  expect(scroll, `${phase.name}: no sideways scroll`).toBeLessThanOrEqual(client);
  for (const { name, rect } of tagged(phase.rects)) {
    expect(rect.x0, `${phase.name}: ${name} starts inside the screen`).toBeGreaterThanOrEqual(-0.5);
    expect(rect.x1, `${phase.name}: ${name} ends inside the screen`).toBeLessThanOrEqual(view.width + 0.5);
  }
}

/** The numbers of one size, for the test log and the write-up. */
function log(size: string, label: string, value: unknown): void {
  console.log(`LAYOUT ${size} ${label} ${JSON.stringify(value)}`);
}

for (const size of SIZES) {
  const name = `${size.width}x${size.height}`;

  test(`@layout ${name}: the stamp is off the paw, nothing overlaps, no empty band, the longest narration is whole`, async ({ paw }) => {
    test.setTimeout(180_000);
    const { page } = paw;
    await page.setViewportSize(size);
    paw.stub.grantWithNarration(LONGEST_NARRATION);
    await paw.open();
    await page.evaluate(() => document.fonts.ready);

    // Idle: the paw is big and the wish line is on the first screen.
    const idleSilhouette = await paintSilhouette(page);
    const idle = await readPhase(paw, 'idle');
    const idleBounds = boundsOf(idleSilhouette)!;
    log(name, 'paw box', width(idleSilhouette.box));
    log(name, 'idle paw height', height(idleBounds));
    expect(width(idleSilhouette.box), `(f) the paw box is ${width(idleSilhouette.box)} px`).toBeGreaterThanOrEqual(size.height * MIN_BOX_SHARE);
    expect(width(idleSilhouette.box)).toBeLessThanOrEqual(400);
    expect(height(idleBounds), `(f) the idle paw is ${height(idleBounds)} px high`).toBeGreaterThanOrEqual(size.height * MIN_PAW_SHARE);
    await expectFirstScreen(page, idle, size);

    // Curses landed.
    await paw.makeWish();
    await paw.expectCurled(5);
    await expect(paw.stamp).toHaveText('Granted.');
    await page.evaluate(() => document.fonts.ready);
    const curled = await paintSilhouette(page);
    const landed = await readPhase(paw, 'landed');

    // A pose in between: two circles closed.
    await paw.bindAndClose(1, clauseFor(1));
    await paw.bindAndClose(3, clauseFor(3));
    await expect(paw.stateText).toHaveText('3 fingers curled.');
    const between = await paintSilhouette(page);

    // Everything closed: the paw rests, the medal and the buttons are shown.
    await paw.bindAndClose(0, clauseFor(0));
    await paw.bindAndClose(4, clauseFor(4));
    await paw.bindAndClose(2, clauseFor(2));
    await expect(paw.medal).toBeVisible();
    await expect(paw.stateText).toHaveText('The paw rests.');
    await expect.poll(async () => (await paw.page.locator('[data-actions] button').count()) >= 3).toBe(true);
    const rested = await paintSilhouette(page);
    const restedPhase = await readPhase(paw, 'rested');

    const union = unionOf([idleSilhouette, curled, between, rested]);
    log(name, 'union paw bounds', boundsOf(union));
    for (const phase of [landed, restedPhase]) {
      expectStampOffPaw(union, phase); // (a)
      expectNoOverlap(phase); // (b) and (d)
      expectPawClear(union, phase); // (c)
      expectNoEmptyBand(union, phase); // (e)
      await expectFirstScreen(page, phase, size); // (h)
    }

    // (g) The longest narration (260 characters) is whole and fits in 4 lines.
    const narration = await narrationIsWhole(page);
    log(name, 'narration', narration);
    expect(narration.whole, 'the narration is clipped').toBe(true);
    expect(narration.lines, 'the narration needs more lines than the plate holds').toBeLessThanOrEqual(NARRATION_LINES);

    // (h) The Grant arriving moves nothing: the wish line stays where it was.
    expect(landed.wishTop, 'the wish line did not move when the Grant arrived').toBeCloseTo(idle.wishTop, 0);
    expect(restedPhase.wishTop, 'the wish line did not move when the paw rested').toBeCloseTo(idle.wishTop, 0);
    log(name, 'wish line', { idle: idle.wishTop, bottom: idle.wishBottom });
  });
}

test('@layout 1280x800: a short narration and three curses leave no empty band either', async ({ paw }) => {
  test.setTimeout(120_000);
  const { page } = paw;
  await page.setViewportSize(SIZES[0]);
  paw.stub.grantWithNarration(SHORT_NARRATION);
  await paw.open();
  await page.evaluate(() => document.fonts.ready);
  const idle = await paintSilhouette(page);
  await paw.makeWish();
  await paw.expectCurled(5);
  await expect(paw.stamp).toHaveText('Granted.');
  const curled = await paintSilhouette(page);
  const landed = await readPhase(paw, 'landed, short narration');
  const union = unionOf([idle, curled]);
  expectStampOffPaw(union, landed);
  expectNoOverlap(landed);
  expectPawClear(union, landed);
  expectNoEmptyBand(union, landed);
  await expectFirstScreen(page, landed, SIZES[0]);
  const narration = await narrationIsWhole(page);
  expect(narration.whole).toBe(true);
  log('1280x800', 'short narration lines', narration.lines);
});

test('@layout 1280x800: a grant of three curses has no overlap and no empty band', async ({ paw }) => {
  test.setTimeout(120_000);
  const { page } = paw;
  await page.setViewportSize(SIZES[0]);
  paw.stub.grantWith(3);
  await paw.open();
  await page.evaluate(() => document.fonts.ready);
  const idle = await paintSilhouette(page);
  await paw.makeWish();
  await paw.expectCurled(3);
  await expect(paw.stamp).toHaveText('Granted.');
  const curled = await paintSilhouette(page);
  const landed = await readPhase(paw, 'landed, three curses');
  const union = unionOf([idle, curled]);
  expectStampOffPaw(union, landed);
  expectNoOverlap(landed);
  expectPawClear(union, landed);
  await expectFirstScreen(page, landed, SIZES[0]);
  const rects: Rect[] = tagged(landed.rects).map((one) => one.rect);
  rects.push(boundsOf(union)!);
  const band = tallestEmptyBand(rects, Math.min(...rects.map((rect) => rect.y0)), landed.wishTop);
  log('1280x800', 'three curses, tallest empty band', band);
});
