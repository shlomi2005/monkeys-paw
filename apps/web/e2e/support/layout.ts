// Layout measurements for the plate checks (layout.desktop.spec.ts, layout.mobile.spec.ts). Everything is measured in
// the real page, in document coordinates (CSS pixels), the way a player sees it.
//
// The paw silhouette: the paw is drawn in WebGL, so the DOM cannot say where it is. A picture of the paw box with the
// overlays hidden (as `paintPaw` does) is compared with the same picture with the canvas hidden too. The pixels that
// differ are the paw. Pixels of the silhouette with a clearly red hue are the wrist cord.

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { paintPaw } from './canvas';
import type { PawPage } from './paw-page';

export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export const width = (rect: Rect): number => rect.x1 - rect.x0;
export const height = (rect: Rect): number => rect.y1 - rect.y0;

/** True when the two boxes share more than `slack` pixels in both directions. */
export function overlaps(a: Rect, b: Rect, slack = 0.5): boolean {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > slack && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > slack;
}

/** Boxes of the shown elements that match `selector`, in document coordinates. */
export async function rectsOf(page: Page, selector: string): Promise<Rect[]> {
  return page.evaluate((query) => {
    const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(query)) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') continue;
      out.push({
        x0: rect.left + scrollX,
        y0: rect.top + scrollY,
        x1: rect.right + scrollX,
        y1: rect.bottom + scrollY,
      });
    }
    return out;
  }, selector);
}

export async function rectOf(page: Page, selector: string): Promise<Rect> {
  const [rect] = await rectsOf(page, selector);
  if (rect === undefined) throw new Error(`${selector} has no box`);
  return rect;
}

/** The stamp's box once its press animation is over (a running animation scales and rotates it). */
export async function stampRect(page: Page): Promise<Rect> {
  await expect
    .poll(() => page.locator('[data-stamp]').evaluate((element) => element.getAnimations().length), { message: 'the stamp press is over' })
    .toBe(0);
  return rectOf(page, '[data-stamp]');
}

/** Every box a stamp or a paw must stay out of (design section 1): discs, labels, captions, state text, narration. */
export const TEXT_SELECTORS = {
  discs: '[data-circle-disc]',
  labels: '[data-circle-label]',
  captions: '[data-circle-caption]',
  stateText: '[data-paw-state-text], [data-paw-finger-cue]',
  narration: '[data-narration]',
} as const;

export const CONTROL_SELECTORS = {
  medal: '[data-medal]',
  buttons: '[data-actions] button',
} as const;

export interface Silhouette {
  /** The paw box on the page. */
  readonly box: Rect;
  /** Picture pixels per CSS pixel. */
  readonly scale: number;
  readonly cols: number;
  readonly rows: number;
  /** One byte per picture pixel: 1 where the paw is drawn. */
  readonly paw: Uint8Array;
  /** One byte per picture pixel: 1 where the paw is drawn and the hue is clearly red (the wrist cord). */
  readonly cord: Uint8Array;
}

/** Decodes a PNG into pixels in the page and returns the paw mask and the cord mask. */
export async function paintSilhouette(page: Page): Promise<Silhouette> {
  const box = await rectOf(page, '[data-paw-stage]');
  const [withPaw, without] = [await paintPaw(page), await paintPaw(page, { withoutPaw: true })];
  const result = await page.evaluate(
    async ([first, second]) => {
      async function pixels(base64: string): Promise<ImageData> {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('no 2d context');
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      }
      const [one, two] = [await pixels(first!), await pixels(second!)];
      if (one.width !== two.width || one.height !== two.height) throw new Error('the two pictures differ in size');
      const paw = new Uint8Array(one.width * one.height);
      const cord = new Uint8Array(one.width * one.height);
      for (let i = 0; i < paw.length; i += 1) {
        const at = i * 4;
        const delta =
          Math.abs(one.data[at]! - two.data[at]!) +
          Math.abs(one.data[at + 1]! - two.data[at + 1]!) +
          Math.abs(one.data[at + 2]! - two.data[at + 2]!);
        if (delta <= 24) continue;
        paw[i] = 1;
        const [r, g, b] = [one.data[at]!, one.data[at + 1]!, one.data[at + 2]!];
        // Clearly red: R well above G and B. The fur is grey-brown, so its R is never far above G.
        if (r >= 90 && r - Math.max(g, b) >= 50) cord[i] = 1;
      }
      const toText = (bytes: Uint8Array): string => {
        let text = '';
        for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(text);
      };
      return { cols: one.width, rows: one.height, paw: toText(paw), cord: toText(cord) };
    },
    [withPaw.toString('base64'), without.toString('base64')] as const,
  );
  const fromText = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, 'base64'));
  return {
    box,
    scale: result.cols / width(box),
    cols: result.cols,
    rows: result.rows,
    paw: fromText(result.paw),
    cord: fromText(result.cord),
  };
}

/** The union of several silhouettes (the same box, the same size). */
export function unionOf(silhouettes: readonly Silhouette[]): Silhouette {
  const first = silhouettes[0];
  if (first === undefined) throw new Error('no silhouette');
  const paw = new Uint8Array(first.paw.length);
  const cord = new Uint8Array(first.cord.length);
  for (const one of silhouettes) {
    expect(one.paw.length, 'the paw box keeps its size').toBe(paw.length);
    for (let i = 0; i < paw.length; i += 1) {
      if (one.paw[i] === 1) paw[i] = 1;
      if (one.cord[i] === 1) cord[i] = 1;
    }
  }
  return { ...first, paw, cord };
}

/** Picture pixels of `mask` inside a page rectangle. */
export function countIn(silhouette: Silhouette, rect: Rect, mask: 'paw' | 'cord' = 'paw'): number {
  const { box, scale, cols, rows } = silhouette;
  const [c0, c1] = [Math.max(0, Math.floor((rect.x0 - box.x0) * scale)), Math.min(cols, Math.ceil((rect.x1 - box.x0) * scale))];
  const [r0, r1] = [Math.max(0, Math.floor((rect.y0 - box.y0) * scale)), Math.min(rows, Math.ceil((rect.y1 - box.y0) * scale))];
  const bytes = silhouette[mask];
  let count = 0;
  for (let row = r0; row < r1; row += 1) for (let col = c0; col < c1; col += 1) count += bytes[row * cols + col]!;
  return count;
}

/** The smallest box around the pixels of `mask`, in page coordinates, or null when there are none. */
export function boundsOf(silhouette: Silhouette, mask: 'paw' | 'cord' = 'paw'): Rect | null {
  const { box, scale, cols, rows } = silhouette;
  const bytes = silhouette[mask];
  let [c0, r0, c1, r1] = [cols, rows, -1, -1];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (bytes[row * cols + col] === 0) continue;
      c0 = Math.min(c0, col);
      c1 = Math.max(c1, col);
      r0 = Math.min(r0, row);
      r1 = Math.max(r1, row);
    }
  }
  if (c1 < 0) return null;
  return { x0: box.x0 + c0 / scale, y0: box.y0 + r0 / scale, x1: box.x0 + (c1 + 1) / scale, y1: box.y0 + (r1 + 1) / scale };
}

/** Pixels of the box, for the "at most 0.5% of the box" allowance. */
export const boxPixels = (silhouette: Silhouette, rect: Rect): number => {
  const { box, scale, cols, rows } = silhouette;
  const c = Math.min(cols, Math.ceil((rect.x1 - box.x0) * scale)) - Math.max(0, Math.floor((rect.x0 - box.x0) * scale));
  const r = Math.min(rows, Math.ceil((rect.y1 - box.y0) * scale)) - Math.max(0, Math.floor((rect.y0 - box.y0) * scale));
  return Math.max(0, c) * Math.max(0, r);
};

/** Boxes of everything the plate shows as content, by name (document coordinates). */
export interface PlateRects {
  readonly discs: Rect[];
  readonly labels: Rect[];
  readonly captions: Rect[];
  readonly stateText: Rect[];
  readonly narration: Rect[];
  readonly medal: Rect[];
  readonly buttons: Rect[];
  readonly stamp: Rect[];
}

export async function plateRects(page: Page): Promise<PlateRects> {
  return {
    discs: await rectsOf(page, TEXT_SELECTORS.discs),
    labels: await rectsOf(page, TEXT_SELECTORS.labels),
    captions: await rectsOf(page, TEXT_SELECTORS.captions),
    stateText: await rectsOf(page, TEXT_SELECTORS.stateText),
    narration: await rectsOf(page, TEXT_SELECTORS.narration),
    medal: await rectsOf(page, CONTROL_SELECTORS.medal),
    buttons: await rectsOf(page, CONTROL_SELECTORS.buttons),
    stamp: await rectsOf(page, '[data-stamp]'),
  };
}

/** Every rect of a `PlateRects`, tagged with its group, for messages. */
export function tagged(rects: PlateRects, only?: readonly (keyof PlateRects)[]): { name: string; rect: Rect }[] {
  const out: { name: string; rect: Rect }[] = [];
  for (const key of Object.keys(rects) as (keyof PlateRects)[]) {
    if (only !== undefined && !only.includes(key)) continue;
    rects[key].forEach((rect, index) => out.push({ name: `${key}[${index}]`, rect }));
  }
  return out;
}

/**
 * The tallest horizontal band, from `top` to `bottom`, that no box in `rects` touches. A band is full width: a line
 * that crosses any box is not empty. Returns the height and where it starts.
 */
export function tallestEmptyBand(rects: readonly Rect[], top: number, bottom: number): { height: number; y: number } {
  const spans = rects
    .map((rect) => [Math.max(top, rect.y0), Math.min(bottom, rect.y1)] as const)
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let best = { height: 0, y: top };
  let edge = top;
  for (const [a, b] of spans) {
    if (a - edge > best.height) best = { height: a - edge, y: edge };
    edge = Math.max(edge, b);
  }
  if (bottom - edge > best.height) best = { height: bottom - edge, y: edge };
  return best;
}

/** True when the narration shows all its text: an unclamped copy of it is not taller than it. */
export async function narrationIsWhole(page: Page): Promise<{ whole: boolean; lines: number }> {
  return page.locator('[data-narration]').evaluate((element) => {
    const copy = element.cloneNode(true) as HTMLElement;
    Object.assign(copy.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      margin: '0',
      height: 'auto',
      maxHeight: 'none',
      overflow: 'visible',
      display: 'block',
      visibility: 'hidden',
    });
    copy.style.setProperty('-webkit-line-clamp', 'unset');
    copy.style.setProperty('line-clamp', 'none');
    copy.style.width = `${element.getBoundingClientRect().width}px`;
    element.parentElement?.appendChild(copy);
    const full = copy.getBoundingClientRect().height;
    copy.remove();
    const shown = element.getBoundingClientRect().height;
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
    return { whole: full <= shown + 1, lines: Math.round(full / lineHeight) };
  });
}

/** The sideways scroll check: `[scrollWidth, clientWidth]`. */
export async function scrollWidths(page: Page): Promise<[number, number]> {
  return page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth] as [number, number]);
}

/** Phases of one round, for the layout checks. Idle, then 5 curled, then rested after 5 closes. */
export const clauseFor = (index: number): string =>
  `WHEN the owner of project ${index + 1} has left, THE SYSTEM SHALL let an admin delete it.`;

/** Closes every circle (in a fixed order) and waits for the rest: the medal shows, the paw has stopped. */
export async function closeAll(paw: PawPage): Promise<void> {
  for (const index of [1, 3, 0, 4, 2]) await paw.bindAndClose(index, clauseFor(index));
  await expect(paw.medal).toBeVisible();
  await expect(paw.stateText).toHaveText('The paw rests.');
}
