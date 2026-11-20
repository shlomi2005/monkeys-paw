// Canvas helpers (paw-web task 42). The digit that curls or opens is drawn in WebGL, so the DOM cannot say which one
// moved. These helpers take a picture of the paw box and compare pictures, so a test can tell "nothing moved", "the
// paw is back where it was" and "the change is on the left or on the right".
//
// The pictures hide the circles, the stamp and the medal (they change on their own) and freeze CSS animations, so
// the only thing that can differ between two pictures is the paw. Software GL draws the same frame to the same
// pixels, so equal poses give equal pictures.

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const OVERLAYS = [
  '[data-circle-ring], [data-granted-stamp], [data-medal] { visibility: hidden !important; }',
  // An open modal covers the paw and dims the page; the paw behind it is what the pictures compare.
  'dialog { visibility: hidden !important; }',
  'dialog::backdrop { background: transparent !important; }',
].join('\n');

/** A picture of the paw box (PNG). */
export async function paintPaw(page: Page): Promise<Buffer> {
  return page.locator('[data-paw-stage]').screenshot({ animations: 'disabled', caret: 'hide', style: OVERLAYS });
}

export interface PictureDiff {
  /** Pixels that differ. */
  readonly changed: number;
  readonly width: number;
  readonly height: number;
  /** The smallest box around the differing pixels, or null when the pictures are the same. */
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null;
}

/** Compares two PNG pictures pixel by pixel (in the page, with `createImageBitmap`; no image library needed). */
export async function diffPictures(page: Page, a: Buffer, b: Buffer): Promise<PictureDiff> {
  return page.evaluate(
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
      if (one.width !== two.width || one.height !== two.height) {
        return { changed: one.width * one.height, width: one.width, height: one.height, box: null };
      }
      let changed = 0;
      let x0 = one.width;
      let y0 = one.height;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < one.height; y += 1) {
        for (let x = 0; x < one.width; x += 1) {
          const at = (y * one.width + x) * 4;
          const delta =
            Math.abs(one.data[at]! - two.data[at]!) +
            Math.abs(one.data[at + 1]! - two.data[at + 1]!) +
            Math.abs(one.data[at + 2]! - two.data[at + 2]!) +
            Math.abs(one.data[at + 3]! - two.data[at + 3]!);
          if (delta === 0) continue;
          changed += 1;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      return { changed, width: one.width, height: one.height, box: changed === 0 ? null : { x0, y0, x1, y1 } };
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

/**
 * Waits until the paw has stopped moving: two pictures in a row are the same. If `after` is given, first waits until
 * the picture differs from `after` (the movement has started), so a slow first frame is not mistaken for rest.
 * Polls the pictures themselves, never a fixed delay.
 */
export async function settledPaw(page: Page, after?: Buffer, timeout = 15_000): Promise<Buffer> {
  if (after !== undefined) {
    await expect
      .poll(async () => (await diffPictures(page, after, await paintPaw(page))).changed, { timeout, message: 'the paw starts to move' })
      .toBeGreaterThan(0);
  }
  let previous = await paintPaw(page);
  await expect
    .poll(
      async () => {
        const current = await paintPaw(page);
        const same = (await diffPictures(page, previous, current)).changed === 0;
        previous = current;
        return same;
      },
      { timeout, message: 'the paw comes to rest' },
    )
    .toBe(true);
  return previous;
}

/** Lets `count` animation frames pass in the page. A bounded window for tests that prove something did NOT move. */
export async function framesPass(page: Page, count: number): Promise<void> {
  await page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let left = frames;
        const tick = (): void => {
          left -= 1;
          if (left <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    count,
  );
}
