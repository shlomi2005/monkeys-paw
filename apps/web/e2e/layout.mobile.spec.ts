// Task 48: the mobile project, 390 px wide (Req 2.2, 9.1 to 9.4, 10.5). Only `*.mobile.spec.ts` files run here.

import type { Page } from '@playwright/test';
import { LONGEST_NARRATION } from './support/fixtures';
import {
  boundsOf,
  boxPixels,
  closeAll,
  countIn,
  height,
  narrationIsWhole,
  overlaps,
  paintSilhouette,
  plateRects,
  rectOf,
  stampRect,
  tagged,
  unionOf,
  width,
} from './support/layout';
import { OPEN_IN_KIRO, TAKE_SCROLL } from './support/paw-page';
import { expect, test } from './support/test';
import { eventsOf, readTimeline } from './support/timeline';

const clauseFor = (index: number): string =>
  `WHEN the owner of project ${index + 1} has left, THE SYSTEM SHALL let an admin delete it.`;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`${selector} has no box`);
  return box;
}

/** The visible circle buttons, in order. */
async function circleBoxes(page: Page): Promise<Box[]> {
  const boxes: Box[] = [];
  for (let index = 0; index < 5; index += 1) {
    const box = await page.locator(`li[data-index="${index}"] button`).boundingBox();
    if (box === null) throw new Error(`circle ${index + 1} has no box`);
    boxes.push(box);
  }
  return boxes;
}

/**
 * Interactive elements under `scope` that are shown and smaller than 48 x 48 CSS pixels. It also fails when the scan
 * finds fewer than `atLeast` shown elements, so an empty scan cannot pass for a clean one.
 */
async function smallTargets(page: Page, scope: string, atLeast: number): Promise<string[]> {
  const { small, checked } = await scan(page, scope);
  expect(checked, `interactive elements found in ${scope}`).toBeGreaterThanOrEqual(atLeast);
  return small;
}

async function scan(page: Page, scope: string): Promise<{ small: string[]; checked: number }> {
  return page.evaluate((root) => {
    const small: string[] = [];
    let checked = 0;
    const selector = 'button, input, textarea, select, a[href], [role="button"], [tabindex]:not([tabindex="-1"])';
    for (const element of document.querySelector(root)?.querySelectorAll<HTMLElement>(selector) ?? []) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const shown = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      if (!shown) continue;
      checked += 1;
      // Half a pixel of rounding is not a miss.
      if (rect.width < 47.5 || rect.height < 47.5) {
        const name = element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 30) ?? element.tagName;
        small.push(`${element.tagName.toLowerCase()} "${name}" ${rect.width.toFixed(1)} x ${rect.height.toFixed(1)}`);
      }
    }
    return { small, checked };
  }, scope);
}

const noSidewaysScroll = async (page: Page): Promise<number[]> =>
  page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);

test('the circles form a vertical list under a small paw', async ({ paw }) => {
  const { page } = paw;
  await paw.open();
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });

  // Req 9.1: the paw is about 150 to 200 px.
  const stage = await boxOf(page, '[data-paw-stage]');
  expect(stage.width, 'paw width').toBeGreaterThanOrEqual(150);
  expect(stage.width, 'paw width').toBeLessThanOrEqual(200);
  expect(stage.height).toBeCloseTo(stage.width, 0);

  await paw.makeWish();
  await paw.expectCurled(5);

  const circles = await circleBoxes(page);
  const ring = await boxOf(page, '[data-circle-ring]');
  const centreX = circles.map((box) => box.x + box.width / 2);
  expect(Math.max(...centreX) - Math.min(...centreX), 'one column: every circle has the same centre line').toBeLessThanOrEqual(2);
  for (let i = 1; i < circles.length; i += 1) {
    expect(circles[i]!.y, `circle ${i + 1} is below circle ${i}`).toBeGreaterThanOrEqual(circles[i - 1]!.y + circles[i - 1]!.height);
  }
  expect(circles[0]!.y, 'the list starts under the paw').toBeGreaterThanOrEqual(stage.y + stage.height);
  for (const box of circles) {
    expect(box.width, 'disc about 60 px').toBeGreaterThanOrEqual(48);
    expect(box.width).toBeLessThanOrEqual(64);
  }
  // The list is full width (with margins), and so is each row: the story sits beside the disc.
  expect(ring.width, 'full-width list').toBeGreaterThanOrEqual(390 * 0.85);
  const first = await boxOf(page, 'li[data-index="0"]');
  expect(first.width).toBeGreaterThanOrEqual(390 * 0.7);

  const [scrollWidth, clientWidth] = await noSidewaysScroll(page);
  expect(scrollWidth, 'no sideways scroll at 390 px').toBeLessThanOrEqual(clientWidth);
});

test('the binding card is a bottom sheet', async ({ paw }) => {
  const { page } = paw;
  await paw.open();
  await paw.makeWish();
  await paw.expectCurled(5);
  await paw.openCard(2);

  const view = page.viewportSize()!;
  const sheet = await paw.dialog.boundingBox();
  expect(sheet).not.toBeNull();
  // Docked at the bottom edge, as wide as the screen, 80vh at most.
  expect(sheet!.y + sheet!.height, 'the sheet rests on the bottom edge').toBeGreaterThanOrEqual(view.height - 1);
  expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(view.height + 1);
  expect(sheet!.width, 'the sheet spans the screen').toBeGreaterThanOrEqual(view.width - 2);
  expect(sheet!.height, 'the sheet is at most 80vh').toBeLessThanOrEqual(view.height * 0.8 + 1);
  expect(sheet!.x).toBeGreaterThanOrEqual(-1);
  // The paw stays visible above it.
  const stage = await boxOf(page, '[data-paw-stage]');
  expect(sheet!.y, 'the sheet does not cover the whole screen').toBeGreaterThan(0);
  expect(stage.width).toBeGreaterThan(0);

  // It scrolls when it is longer than the sheet, and its buttons are all reachable.
  for (const name of ['Accept this clause', 'Rewrite the whole wish', 'Cancel']) {
    const button = paw.dialog.getByRole('button', { name });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
  }
});

test('every interactive target is at least 48 x 48 px', async ({ paw }) => {
  test.setTimeout(120_000);
  const { page } = paw;
  await paw.open();
  expect(await smallTargets(page, 'main', 7), 'idle').toEqual([]);

  await page.getByRole('button', { name: 'for… (optional context)' }).click();
  await expect(page.getByRole('textbox', { name: 'for…' })).toBeVisible();
  expect(await smallTargets(page, 'main', 8), 'with the context field').toEqual([]);

  await paw.makeWish();
  await paw.expectCurled(5);
  expect(await smallTargets(page, 'main', 13), 'curses landed').toEqual([]);

  await paw.openCard(0);
  expect(await smallTargets(page, 'dialog[open]', 4), 'card open').toEqual([]);
  await paw.submitClause(clauseFor(0));
  await expect(paw.dialog).toBeHidden();
  for (const index of [1, 2, 3, 4]) await paw.bindAndClose(index, clauseFor(index));
  await expect(paw.medal).toBeVisible();
  expect(await smallTargets(page, 'main', 13), 'rested with medal').toEqual([]);

  await page.getByRole('button', { name: OPEN_IN_KIRO }).click();
  await expect(paw.dialog).toBeVisible();
  expect(await smallTargets(page, 'dialog[open]', 6), 'Open in Kiro dialog').toEqual([]);
  await paw.dialog.getByRole('button', { name: 'Close' }).click();
  await expect(paw.dialog).toBeHidden();
  await expect(page.getByRole('button', { name: TAKE_SCROLL })).toBeVisible();
});

test('rotation reflows without remounting the canvas, and only paw-mobile.glb is requested', async ({ paw }) => {
  test.setTimeout(90_000);
  const { page } = paw;
  const glbs: string[] = [];
  const navigations: string[] = [];
  page.on('request', (request) => {
    if (/\.glb(\?|$)/.test(request.url())) glbs.push(new URL(request.url()).pathname);
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });

  await paw.open();
  await paw.makeWish();
  await paw.expectCurled(5);
  const canvas = await page.locator('[data-canvas-slot] canvas').elementHandle();
  expect(canvas).not.toBeNull();
  // A marker on the window: a reload would lose it.
  await page.evaluate(() => {
    (window as unknown as { __notReloaded: boolean }).__notReloaded = true;
  });
  const portrait = await circleBoxes(page);
  expect(new Set(portrait.map((box) => Math.round(box.x))).size, 'portrait: one column').toBe(1);

  const sameCanvas = async (): Promise<boolean> =>
    page.evaluate(
      ([node]) => node!.isConnected && document.querySelectorAll('[data-canvas-slot] canvas').length === 1 && document.querySelector('[data-canvas-slot] canvas') === node,
      [canvas] as const,
    );

  // Landscape, 844 x 390: wider than 768 px, so the desktop layout takes over.
  await page.setViewportSize({ width: 844, height: 390 });
  await expect
    .poll(async () => new Set((await circleBoxes(page)).map((box) => Math.round(box.x))).size, { message: 'landscape: the list becomes a ring' })
    .toBeGreaterThan(1);
  expect(await sameCanvas(), 'the canvas is the same node in landscape').toBe(true);
  await expect(paw.slot(0)).toHaveAttribute('data-status', 'open');
  await expect(paw.stateText).toHaveText('5 fingers curled.');
  expect(await page.evaluate(() => (window as unknown as { __notReloaded?: boolean }).__notReloaded)).toBe(true);

  // The paw can still be used in landscape: a card opens and closes.
  await paw.openCard(1);
  await page.keyboard.press('Escape');
  await expect(paw.dialog).toBeHidden();

  // And back to portrait: a single column again, still the same canvas.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => new Set((await circleBoxes(page)).map((box) => Math.round(box.x))).size, { message: 'portrait: one column again' })
    .toBe(1);
  expect(await sameCanvas(), 'the canvas is the same node after the way back').toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __notReloaded?: boolean }).__notReloaded)).toBe(true);
  await expect(page.locator('[data-poster]')).toBeHidden();

  // The canvas mounted once, the page loaded once, and only the small model was fetched, though 844 px would pick the big one.
  const events = await readTimeline(page);
  expect(eventsOf(events, 'canvas').map((event) => event.value), 'mounted once, never unmounted').toEqual(['mounted']);
  expect(navigations, 'no reload').toHaveLength(1);
  expect(glbs).toEqual(['/paw/paw-mobile.glb']);
});

// Plate polish at 390 x 844 (paw-web design.md, "Plate polish"): a 200 px paw, a stamp that never lies on it, a narration
// that is shown whole, and nothing that sits on anything else. The silhouette is found as in layout.desktop.spec.ts.
test('@layout 390x844: a 200 px paw, the stamp under its text, the longest narration whole, nothing overlaps', async ({ paw }) => {
  test.setTimeout(150_000);
  const { page } = paw;
  const view = { width: 390, height: 844 };
  paw.stub.grantWithNarration(LONGEST_NARRATION);
  await paw.open();
  await page.evaluate(() => document.fonts.ready);

  // (f) The paw box is 200 px, and the paw (idle) fills most of it.
  const idleSilhouette = await paintSilhouette(page);
  const idleBounds = boundsOf(idleSilhouette)!;
  expect(width(idleSilhouette.box), 'the paw box is 200 px at 390 px wide').toBeGreaterThanOrEqual(199);
  expect(width(idleSilhouette.box)).toBeLessThanOrEqual(200.5);
  expect(height(idleBounds), `the idle paw is ${height(idleBounds)} px high`).toBeGreaterThanOrEqual(150);
  const idleWish = await rectOf(page, '[data-wish-line]');
  const idleButton = await rectOf(page, 'button[aria-label="Make the wish"]');
  // (h) The first row of the wish line is on the first screen, before the Grant.
  expect(idleButton.y1, 'the wish button is on the first screen').toBeLessThanOrEqual(view.height);

  await paw.makeWish();
  await paw.expectCurled(5);
  await expect(paw.stamp).toHaveText('Granted.');
  await page.evaluate(() => document.fonts.ready);
  const curled = await paintSilhouette(page);
  const landedRects = await plateRects(page);
  const landedStamp = await stampRect(page);
  const landedWish = await rectOf(page, '[data-wish-line]');

  await closeAll(paw);
  const rested = await paintSilhouette(page);
  const restedRects = await plateRects(page);
  const restedWish = await rectOf(page, '[data-wish-line]');
  const union = unionOf([idleSilhouette, curled, rested]);
  const box = union.box;

  // (a) The stamp is a row under the paw's state text, never over the paw box, and clear of the paw and the cord.
  expect(landedStamp.y0, 'the stamp starts below the paw box').toBeGreaterThanOrEqual(box.y1);
  expect(countIn(union, landedStamp), 'the paw is not under the stamp').toBe(0);
  expect(countIn(union, landedStamp, 'cord')).toBe(0);
  const stateText = landedRects.stateText[0]!;
  expect(landedStamp.y0, 'the stamp is under the state text').toBeGreaterThanOrEqual(stateText.y1 - 0.5);

  // (b, c, d) Nothing sits on anything else, in either phase; the paw is clear of every box.
  for (const [name, rects, stamp] of [
    ['landed', landedRects, landedStamp],
    ['rested', restedRects, landedStamp],
  ] as const) {
    const parts = tagged(rects, ['discs', 'labels', 'captions', 'stateText', 'narration', 'medal', 'buttons']);
    parts.push({ name: 'stamp', rect: stamp });
    for (let i = 0; i < parts.length; i += 1) {
      for (let j = i + 1; j < parts.length; j += 1) {
        const [a, b] = [parts[i]!, parts[j]!];
        const family = (text: string): boolean => /^(discs|labels|captions)\[/.test(text);
        if (family(a.name) && family(b.name) && a.name.split('[')[1] === b.name.split('[')[1]) continue;
        expect(overlaps(a.rect, b.rect), `${name}: ${a.name} and ${b.name} overlap`).toBe(false);
      }
    }
    for (const { name: part, rect } of parts) {
      expect(countIn(union, rect), `${name}: the paw covers ${part}`).toBeLessThanOrEqual(Math.ceil(0.005 * boxPixels(union, rect)));
      expect(rect.x0, `${name}: ${part} starts inside the screen`).toBeGreaterThanOrEqual(-0.5);
      expect(rect.x1, `${name}: ${part} ends inside the screen`).toBeLessThanOrEqual(view.width + 0.5);
    }
  }

  // (g) The longest narration (260 characters) is shown whole, with no clipping.
  expect((await narrationIsWhole(page)).whole, 'the narration is clipped').toBe(true);

  // (h) After the Grant, the page moves no more: the wish line is where it was when the curses landed.
  expect(restedWish.y0, 'the wish line did not move when the paw rested').toBeCloseTo(landedWish.y0, 0);
  expect(landedWish.y0, 'the Grant pushes the wish line down by the narration').toBeGreaterThan(idleWish.y0);
  const [scroll, client] = await noSidewaysScroll(page);
  expect(scroll, 'no sideways scroll at 390 px').toBeLessThanOrEqual(client);
});
