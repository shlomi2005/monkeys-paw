// Task 48: the mobile project, 390 px wide (Req 2.2, 9.1 to 9.4, 10.5). Only `*.mobile.spec.ts` files run here.

import type { Page } from '@playwright/test';
import { LONGEST_NARRATION, WISH_TEXT } from './support/fixtures';
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
import { ADULT_LABEL, MAKE_WISH, OPEN_IN_KIRO, REWRITE, STOP, TAKE_SCROLL } from './support/paw-page';
import type { PawPage } from './support/paw-page';
import { inVisualOrder, namesOf, walkTabStops } from './support/tab-order';
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
      // A checkbox is drawn small inside its label: the label is the target.
      const target = element instanceof HTMLInputElement && element.type === 'checkbox' ? (element.labels?.[0] ?? element) : element;
      const rect = target.getBoundingClientRect();
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
  const landedFirstCurse = await rectOf(page, 'li[data-index="0"]');

  await closeAll(paw);
  const rested = await paintSilhouette(page);
  const restedRects = await plateRects(page);
  const restedFirstCurse = await rectOf(page, 'li[data-index="0"]');
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

  // (h) After the Grant, what is above the curse list moves no more: the first curse is where it was when the curses
  // landed. (The wish line is under the actions now, and the medal and the export buttons grow the page below the list.)
  expect(restedFirstCurse.y0, 'the first curse did not move when the paw rested').toBeCloseTo(landedFirstCurse.y0, 0);
  expect(landedWish.y0, 'the Grant puts the wish line under the curses, below where it was').toBeGreaterThan(idleWish.y0);
  const [scroll, client] = await noSidewaysScroll(page);
  expect(scroll, 'no sideways scroll at 390 px').toBeLessThanOrEqual(client);
});

// ---------------------------------------------------------------------------------------------------------------------
// Result first (paw-web design.md A12, "Mobile" A to C, "Focus order"): on a phone with a Grant the curse list comes
// directly under the narration, and the wish line and the examples come after the actions, on screen and in the DOM.
// ---------------------------------------------------------------------------------------------------------------------

const VIEW_HEIGHT = 844;
const EXAMPLES_LIST = '[aria-label="Example wishes"]';
const WISH_STOPS = ['input:I wish that', 'button:for… (optional context)', `input:${ADULT_LABEL}`, `button:${MAKE_WISH}`];
const EXAMPLE_STOPS = [
  'button:Example. Only the owner can delete a project. a team workspace app',
  'button:Example. Refunds are instant. an online shop',
  'button:Example. Free for students',
];
const OPEN_CIRCLE_STOPS = [
  'button:Permissions curse, open, click to bind',
  'button:Time curse, open, click to bind',
  'button:Abuse curse, open, click to bind',
  'button:Privacy curse, open, click to bind',
  'button:Edge input curse, open, click to bind',
];

/** A box in page coordinates (top, bottom) and in viewport coordinates (vTop, vBottom). */
interface Placed {
  readonly top: number;
  readonly bottom: number;
  readonly vTop: number;
  readonly vBottom: number;
}

async function placedOf(page: Page, selector: string): Promise<Placed> {
  return page.locator(selector).first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY, vTop: rect.top, vBottom: rect.bottom };
  });
}

const scrollY = async (page: Page): Promise<number> => page.evaluate(() => window.scrollY);

/** What has focus, as `tag:name`, or `(body)`. */
async function activeName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (element === null || element === document.body || element === document.documentElement) return '(body)';
    const label = element.getAttribute('aria-label');
    return `${element.tagName.toLowerCase()}:${label ?? (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}`;
  });
}

async function expectFocusNotOnBody(page: Page, when: string): Promise<void> {
  expect(await activeName(page), `focus is on the body ${when}`).not.toBe('(body)');
}

/** True when `first` comes before `second` in the DOM (the DOM order is the tab order). */
async function domBefore(page: Page, first: string, second: string): Promise<boolean> {
  return page.evaluate(
    ([a, b]) => {
      const [one, two] = [document.querySelector(a!), document.querySelector(b!)];
      return one !== null && two !== null && Boolean(one.compareDocumentPosition(two) & Node.DOCUMENT_POSITION_FOLLOWING);
    },
    [first, second] as const,
  );
}

const WISH_LINE = '[data-wish-line]';
const RING = '[data-circle-ring]';
const STATUS_LINE = `${WISH_LINE} [role="status"]`;

/** The Grant has landed on a phone: where everything is, in page and in viewport coordinates. */
async function expectResultFirst(paw: PawPage): Promise<void> {
  const { page } = paw;
  const narration = await placedOf(page, '[data-narration]');
  const curses: Placed[] = [];
  for (let index = 0; index < 5; index += 1) curses.push(await placedOf(page, `li[data-index="${index}"]`));
  const stop = await placedOf(page, '[data-actions] button');
  const wish = await placedOf(page, WISH_LINE);
  const examples = await placedOf(page, EXAMPLES_LIST);
  const first = curses[0]!;

  expect(await scrollY(page), 'the page is at the top after the Grant').toBe(0);
  expect(first.top, 'page: the first curse starts under the narration').toBeGreaterThanOrEqual(narration.bottom);
  expect(first.vTop, 'viewport: the first curse starts under the narration').toBeGreaterThanOrEqual(narration.vBottom);
  expect(first.top, `page: the first curse starts within the first ${VIEW_HEIGHT} px`).toBeLessThan(VIEW_HEIGHT);
  expect(first.vTop, `viewport: the first curse starts within the first ${VIEW_HEIGHT} px`).toBeLessThan(VIEW_HEIGHT);
  expect(first.top, 'page: the first curse is above the wish line').toBeLessThan(wish.top);
  expect(first.vTop, 'viewport: the first curse is above the wish line').toBeLessThan(wish.vTop);

  const chain: [string, Placed][] = [
    ['curse 1', curses[0]!],
    ['curse 2', curses[1]!],
    ['curse 3', curses[2]!],
    ['curse 4', curses[3]!],
    ['curse 5', curses[4]!],
    ['Stop', stop],
    ['the wish line', wish],
    ['the examples', examples],
  ];
  for (let i = 1; i < chain.length; i += 1) {
    const [name, box] = chain[i]!;
    const [previousName, previous] = chain[i - 1]!;
    expect(box.top, `${name} follows ${previousName}`).toBeGreaterThanOrEqual(previous.bottom - 0.5);
  }

  // The DOM says the same, so the tab order is the visual order.
  expect(await domBefore(page, RING, WISH_LINE), 'the circle list is before the wish line in the DOM').toBe(true);
  expect(await domBefore(page, '[data-actions]', WISH_LINE), 'the actions are before the wish line in the DOM').toBe(true);
  expect(await domBefore(page, WISH_LINE, EXAMPLES_LIST), 'the wish line is before the examples in the DOM').toBe(true);
  expect(await domBefore(page, EXAMPLES_LIST, '[data-slot="sound"]'), 'the examples are before the sound toggle').toBe(true);
}

test('@result-first normal narration: the first curse is on the first screen, under the narration and above the wish line', async ({ paw }) => {
  test.setTimeout(90_000);
  await paw.open();
  await paw.makeWish();
  await paw.expectCurled(5);
  await expectResultFirst(paw);
});

test('@result-first longest narration: the first curse is still on the first screen, and the narration is whole', async ({ paw }) => {
  test.setTimeout(90_000);
  const { page } = paw;
  paw.stub.grantWithNarration(LONGEST_NARRATION);
  await paw.open();
  await page.evaluate(() => document.fonts.ready);
  await paw.makeWish();
  await paw.expectCurled(5);
  await page.evaluate(() => document.fonts.ready);
  expect((await narrationIsWhole(page)).whole, 'the narration is clipped').toBe(true);
  await expectResultFirst(paw);
});

test('@result-first a page scrolled to the bottom before the wish is sent with Enter: the Grant brings it back to the top', async ({ paw }) => {
  test.setTimeout(90_000);
  const { page } = paw;
  await paw.open();
  await paw.wishInput.fill(WISH_TEXT);
  await paw.tickAdult();
  // Scroll to the bottom with the wish input still focused (without scrolling it back into view), then press Enter.
  await page.evaluate(() => {
    document.querySelector<HTMLInputElement>('input[aria-label="I wish that"]')!.focus({ preventScroll: true });
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await expect.poll(() => scrollY(page), { message: 'the page is scrolled before the wish is sent' }).toBeGreaterThan(50);
  await expect(paw.wishInput).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(paw.stamp).toHaveText('Granted.');
  await paw.expectCurled(5);
  await expectResultFirst(paw);
});

test('before any Grant the whole wish line, up to "Make the wish", is on the first screen and before the list', async ({ paw }) => {
  const { page } = paw;
  await paw.open();
  const line = await placedOf(page, WISH_LINE);
  const label = await placedOf(page, `${WISH_LINE} label`);
  const input = await placedOf(page, `${WISH_LINE} input`);
  const disclosure = await placedOf(page, `${WISH_LINE} button[aria-expanded]`);
  const seal = await placedOf(page, `button[aria-label="${MAKE_WISH}"]`);

  expect(line.vTop, 'the wish line starts on the screen').toBeGreaterThanOrEqual(0);
  for (const [name, box] of [['the label', label], ['the input', input], ['the disclosure', disclosure], ['"Make the wish"', seal]] as const) {
    expect(box.vTop, `${name} starts on the screen`).toBeGreaterThanOrEqual(0);
    expect(box.vBottom, `${name} ends within the first ${VIEW_HEIGHT} px`).toBeLessThanOrEqual(VIEW_HEIGHT);
  }
  // The order of the wish line itself, top to bottom.
  expect(input.top).toBeGreaterThanOrEqual(label.bottom - 0.5);
  expect(disclosure.top).toBeGreaterThanOrEqual(input.bottom - 0.5);
  expect(seal.top).toBeGreaterThanOrEqual(disclosure.bottom - 0.5);

  // Before the list, on screen and in the DOM. The empty list may have no height, then it is under everything anyway.
  expect(await domBefore(page, WISH_LINE, EXAMPLES_LIST), 'the wish line is before the examples').toBe(true);
  expect(await domBefore(page, EXAMPLES_LIST, RING), 'the examples are before the list').toBe(true);
  expect(await domBefore(page, WISH_LINE, RING), 'the wish line is before the list').toBe(true);
  const ring = await page.locator(RING).boundingBox();
  if (ring !== null) expect(ring.y + (await scrollY(page)), 'the list starts under the wish line').toBeGreaterThanOrEqual(seal.bottom - 0.5);
});

test('Tab order equals visual order: before the Grant, with the curses landed, and at the end', async ({ paw }) => {
  test.setTimeout(180_000);
  const { page } = paw;
  await paw.open();

  // Before the Grant: the wish line, the examples, the sound toggle. No circle is a tab stop yet.
  const idle = await walkTabStops(page);
  expect(namesOf(idle), 'tab stops before the Grant').toEqual([...WISH_STOPS, ...EXAMPLE_STOPS, 'button:Sound']);
  expect(namesOf(inVisualOrder(idle)), 'before the Grant: tab order is visual order').toEqual(namesOf(idle));

  // The curses landed: the five circles and Stop first, then the wish line, the examples and the sound toggle.
  await paw.makeWish();
  await paw.expectCurled(5);
  const landed = await walkTabStops(page);
  expect(namesOf(landed), 'tab stops with the curses landed').toEqual([
    ...OPEN_CIRCLE_STOPS,
    `button:${STOP}`,
    ...WISH_STOPS,
    ...EXAMPLE_STOPS,
    'button:Sound',
  ]);
  expect(namesOf(inVisualOrder(landed)), 'curses landed: tab order is visual order').toEqual(namesOf(landed));

  // At the end: the circles, then the export buttons and Rewrite, the wish line, the examples, the sound toggle.
  await closeAll(paw);
  const ended = await walkTabStops(page);
  const endedNames = namesOf(ended);
  expect(endedNames, 'tab stops at the end').toHaveLength(5 + 3 + WISH_STOPS.length + EXAMPLE_STOPS.length + 1);
  for (const name of endedNames.slice(0, 5)) expect(name, 'the first five stops are the circles').toMatch(/^button:.+ curse, closed/);
  expect(endedNames.slice(5)).toEqual([
    `button:${TAKE_SCROLL}`,
    `button:${OPEN_IN_KIRO}`,
    `button:${REWRITE}`,
    ...WISH_STOPS,
    ...EXAMPLE_STOPS,
    'button:Sound',
  ]);
  expect(namesOf(inVisualOrder(ended)), 'at the end: tab order is visual order').toEqual(endedNames);
});

/** Holds back the answer to `POST /api/grant` until `release` is called. */
async function holdGrant(page: Page): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // This handler runs before the stub's: `fallback` hands the request on to it once the gate opens.
  await page.route('**/api/grant', async (route) => {
    await gate;
    await route.fallback();
  });
  return release;
}

test('focus is never on the body: while granting, after the Grant, and then Tab reaches the first circle', async ({ paw }) => {
  test.setTimeout(90_000);
  const { page } = paw;
  const release = await holdGrant(page);
  await paw.open();
  await paw.wishInput.fill(WISH_TEXT);
  await paw.tickAdult();
  await paw.wishInput.focus();
  await page.keyboard.press('Enter');

  // While granting the wish controls are disabled: focus is on the status line.
  const status = page.locator(STATUS_LINE);
  await expect(status).toHaveText(/stirs/);
  await expect(status).toBeFocused();
  await expectFocusNotOnBody(page, 'while granting');
  expect(await scrollY(page)).toBe(0);

  release();
  await expect(paw.stamp).toHaveText('Granted.');
  const narration = page.locator('[data-narration]');
  await expect(narration).toBeFocused();
  await paw.expectCurled(5);
  await expect(narration).toBeFocused();
  await expectFocusNotOnBody(page, 'after the Grant');
  await expect(status, 'the status line is no tab stop afterwards').not.toHaveAttribute('tabindex', /.*/);
  expect(await scrollY(page)).toBe(0);

  await page.keyboard.press('Tab');
  await expect(paw.circle(0), 'the next Tab from the narration reaches the first circle').toBeFocused();
  await expect(narration, 'the narration is not a tab stop').not.toHaveAttribute('tabindex', /.*/);
});

test('focus is never on the body after a failed Grant: it goes back to the wish input', async ({ paw }) => {
  test.setTimeout(90_000);
  const { page, stub } = paw;
  const release = await holdGrant(page);
  await paw.open();
  await paw.wishInput.fill(WISH_TEXT);
  await paw.tickAdult();
  await paw.wishInput.focus();
  await page.keyboard.press('Enter');
  const status = page.locator(STATUS_LINE);
  await expect(status).toBeFocused();

  stub.behavior.failWith.grant = 503;
  release();
  // Over: the wish line is free again and shows the resting message. Only then is "focused" a statement about the end.
  await expect(paw.wishInput).toBeEnabled();
  await expect(paw.wishInput).toBeFocused();
  await expectFocusNotOnBody(page, 'after a failed Grant');
  await expect(paw.stamp).toHaveCount(0);
  await expect(status).not.toHaveAttribute('tabindex', /.*/);
  expect(await domBefore(page, WISH_LINE, RING), 'a failed Grant keeps the usual order').toBe(true);
});

test('focus is never on the body after a Stop by keyboard: it goes to "Take the scroll"', async ({ paw }) => {
  test.setTimeout(90_000);
  const { page } = paw;
  await paw.open();
  await paw.wishInput.fill(WISH_TEXT);
  await paw.tickAdult();
  await paw.wishInput.focus();
  await page.keyboard.press('Enter');
  await expect(paw.stamp).toHaveText('Granted.');
  await paw.expectCurled(5);
  await expect(page.locator('[data-narration]')).toBeFocused();

  // Five circles, then Stop: six Tab presses from the narration.
  for (let press = 0; press < 6; press += 1) await page.keyboard.press('Tab');
  await expect(paw.stopButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(paw.stopButton).toHaveCount(0);
  await expect(page.getByRole('button', { name: TAKE_SCROLL })).toBeFocused();
  await expectFocusNotOnBody(page, 'after Stop');
  await expect(paw.medal).toBeVisible();
});

test('focus is never on the body after Rewrite, from the end screen and from the card', async ({ paw }) => {
  test.setTimeout(240_000);
  const { page } = paw;
  await paw.open();
  await paw.makeWish();
  await paw.expectCurled(5);
  await closeAll(paw);

  // From the end screen, with the keyboard.
  const rewrite = page.getByRole('button', { name: REWRITE });
  await rewrite.focus();
  await page.keyboard.press('Enter');
  await expect(paw.wishInput).toBeFocused();
  await expectFocusNotOnBody(page, 'after Rewrite from the end screen');
  await expect(paw.wishInput).toHaveValue('');
  expect(await domBefore(page, WISH_LINE, RING), 'after Rewrite the wish line is first again').toBe(true);
  await expect(page.locator('[data-result-first]')).toHaveCount(0);

  // From the card: a new Grant, a card open, "Rewrite the whole wish".
  await paw.makeWish();
  await paw.expectCurled(5);
  await expect(page.locator('[data-result-first]')).toHaveCount(1);
  await paw.openCard(1);
  const inCard = paw.dialog.getByRole('button', { name: 'Rewrite the whole wish' });
  await inCard.focus();
  await page.keyboard.press('Enter');
  await expect(paw.dialog).toBeHidden();
  await expect(paw.wishInput).toBeFocused();
  await expectFocusNotOnBody(page, 'after Rewrite from the card');
  await expect(paw.wishInput).toHaveValue('');
  expect(await domBefore(page, WISH_LINE, RING), 'after Rewrite from the card the wish line is first again').toBe(true);
  await expect(page.locator('[data-result-first]')).toHaveCount(0);
});

test('rotation 390x844 to 844x390 and back keeps the focused wish input, the same element, the same caret', async ({ paw }) => {
  test.setTimeout(90_000);
  const { page } = paw;
  await paw.open();
  await paw.makeWish();
  await paw.expectCurled(5);
  await expect(page.locator('[data-result-first]')).toHaveCount(1);

  // Real focus, then a caret four characters before the end. After a Grant the input is readOnly,
  // and arrow keys do not move the caret in a readOnly field on every platform, so set it directly.
  await paw.wishInput.focus();
  const at = WISH_TEXT.length - 4;
  await paw.wishInput.evaluate((el, pos) => (el as HTMLInputElement).setSelectionRange(pos, pos), at);
  await page.evaluate(() => {
    document.querySelector<HTMLInputElement>('input[aria-label="I wish that"]')!.dataset['probe'] = 'same-element';
  });
  const caret = (): Promise<{ probe: string | undefined; start: number | null; end: number | null }> =>
    page.evaluate(() => {
      const element = document.activeElement as HTMLInputElement | null;
      return { probe: element?.dataset?.['probe'], start: element?.selectionStart ?? null, end: element?.selectionEnd ?? null };
    });
  expect(await caret(), 'the caret before the rotation').toEqual({ probe: 'same-element', start: at, end: at });

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('[data-result-first]')).toHaveCount(0);
  expect(await domBefore(page, WISH_LINE, RING), 'landscape: the usual order').toBe(true);
  expect(await caret(), 'landscape: the same element, the same caret').toEqual({ probe: 'same-element', start: at, end: at });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-result-first]')).toHaveCount(1);
  expect(await domBefore(page, RING, WISH_LINE), 'portrait: result first again').toBe(true);
  expect(await caret(), 'portrait: the same element, the same caret').toEqual({ probe: 'same-element', start: at, end: at });
});

test('rotation with a card open: it stays modal, focus stays inside, Escape closes it and focus returns to its circle', async ({ paw }) => {
  test.setTimeout(90_000);
  const { page } = paw;
  await paw.open();
  await paw.makeWish();
  await paw.expectCurled(5);
  await paw.openCard(2);

  const modal = (): Promise<boolean> => paw.dialog.evaluate((dialog) => dialog.matches(':modal'));
  const focusInside = (): Promise<boolean> => paw.dialog.evaluate((dialog) => dialog.contains(document.activeElement));
  expect(await modal(), 'modal before the rotation').toBe(true);

  for (const size of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    // The order follows the screen: result first only on the phone.
    await expect(page.locator('[data-result-first]')).toHaveCount(size.width === 390 ? 1 : 0);
    await expect(paw.dialog).toBeVisible();
    expect(await modal(), `still :modal at ${size.width}x${size.height}`).toBe(true);
    expect(await focusInside(), `focus is still inside the card at ${size.width}x${size.height}`).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(paw.dialog).toBeHidden();
  await expect(paw.circle(2), 'focus returns to the circle that opened the card').toBeFocused();
});

/** Scrolls to the bottom and lists the shown controls that the sound toggle covers. */
async function coveredByToggle(page: Page): Promise<{ covered: string[]; checked: number }> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(() => page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 1), {
      message: 'the page is scrolled to the bottom',
    })
    .toBe(true);
  return page.evaluate(() => {
    const toggle = document.querySelector<HTMLElement>('button[aria-label="Sound"]')!;
    const box = toggle.getBoundingClientRect();
    const covered: string[] = [];
    let checked = 0;
    for (const element of document.querySelectorAll<HTMLElement>('main button, main input, main textarea, main select, main a[href]')) {
      if (element === toggle) continue;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') continue;
      checked += 1;
      const across = Math.min(rect.right, box.right) - Math.max(rect.left, box.left);
      const down = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top);
      if (across > 0.5 && down > 0.5) {
        covered.push(`${element.tagName.toLowerCase()}:${element.getAttribute('aria-label') ?? (element.textContent ?? '').trim().slice(0, 30)}`);
      }
    }
    return { covered, checked };
  });
}

test('the sound toggle covers no card and no button when the page is scrolled to the bottom', async ({ paw }) => {
  test.setTimeout(180_000);
  const { page } = paw;
  await paw.open();
  const idle = await coveredByToggle(page);
  expect(idle.checked, 'controls checked before the Grant').toBeGreaterThanOrEqual(6);
  expect(idle.covered, 'before the Grant').toEqual([]);

  await paw.makeWish();
  await paw.expectCurled(5);
  const landed = await coveredByToggle(page);
  expect(landed.checked, 'controls checked with the curses landed').toBeGreaterThanOrEqual(12);
  expect(landed.covered, 'with the curses landed').toEqual([]);

  await closeAll(paw);
  const ended = await coveredByToggle(page);
  expect(ended.checked, 'controls checked at the end').toBeGreaterThanOrEqual(14);
  expect(ended.covered, 'at the end').toEqual([]);
});
