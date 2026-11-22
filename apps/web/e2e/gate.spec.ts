// Task 57: the live gate on desktop (paw-web Req 13, A13, A14), against the stubbed API. The open screen with the 18+
// box, the outside screen with its ready rounds, the seal after the Grant and the region refusal.

import { confirmationScreen, expectNoSeriousIssues, inertSeal, outsideScreen, regionRefusal } from './support/gate';
import { expect, test } from './support/test';

test('(a) the confirmation screen: the tick, the alert, the header and a reload', async ({ paw }) => {
  test.setTimeout(120_000);
  await confirmationScreen(paw);
});

test('(b) the outside screen: no checkbox, nothing sent, a ready round to rest and export', async ({ paw }) => {
  test.setTimeout(120_000);
  await outsideScreen(paw);
});

test('(c) after a Grant the seal is inert, described and sends nothing; Rewrite restores it', async ({ paw }) => {
  test.setTimeout(90_000);
  await inertSeal(paw);
});

test('(e) a region refusal turns the open screen into the outside screen', async ({ paw }) => {
  test.setTimeout(90_000);
  await regionRefusal(paw);
});

test('a failed probe leaves the confirmation screen, and the server still decides', async ({ paw }) => {
  paw.stub.behavior.live = null;
  await paw.open();
  await expect(paw.adultBox).toBeVisible();
  await expect.poll(() => paw.stub.to('live').length).toBe(1);
  await expect(paw.adultBox).toBeVisible();
  await paw.makeWish();
  await expect(paw.stamp).toHaveText('Granted.');
});

test('the 18+ box shares the "for…" row from 768 to 1023 px, adds no height and never scrolls sideways, also at 200% zoom', async ({ paw }) => {
  const { page } = paw;
  const sideways = (): Promise<number[]> =>
    page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);

  await page.setViewportSize({ width: 768, height: 1024 });
  await paw.open();
  const line = page.locator('[data-wish-line]');
  const collapsed = await line.boundingBox();
  const disclosure = await page.getByRole('button', { name: 'for… (optional context)' }).boundingBox();
  const box = await paw.adultTarget.boundingBox();
  expect(collapsed).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(47.5);
  // The same row: the vertical centres agree, and the box is at the right end of the band.
  expect(Math.abs(box!.y + box!.height / 2 - (disclosure!.y + disclosure!.height / 2))).toBeLessThanOrEqual(2);
  expect(box!.x).toBeGreaterThan(disclosure!.x + disclosure!.width);
  expect(box!.x + box!.width).toBeLessThanOrEqual(collapsed!.x + collapsed!.width + 0.5);

  // The context open: no overflow, and the band does not grow.
  await page.getByRole('button', { name: 'for… (optional context)' }).click();
  await expect(page.getByRole('textbox', { name: 'for…' })).toBeVisible();
  await page.getByRole('textbox', { name: 'for…' }).fill('a team workspace app with a rather long description of itself');
  const opened = await line.boundingBox();
  expect(opened!.height).toBeLessThanOrEqual(collapsed!.height + 0.5);
  const [scrollWidth, clientWidth] = await sideways();
  expect(scrollWidth, 'no sideways scroll at 768 px with the context open').toBeLessThanOrEqual(clientWidth);
  const contextBox = await page.getByRole('textbox', { name: 'for…' }).boundingBox();
  const boxAgain = await paw.adultTarget.boundingBox();
  expect(contextBox!.x + contextBox!.width, 'the context field stops before the box').toBeLessThanOrEqual(boxAgain!.x + 0.5);
  await expectNoSeriousIssues(page, 'gate: 768 px, context open');

  // 200% zoom of 1280 px is 640 px: one column, still no sideways scroll.
  await page.setViewportSize({ width: 640, height: 800 });
  await expect(paw.adultBox).toBeVisible();
  const [zoomWidth, zoomClient] = await sideways();
  expect(zoomWidth, 'no sideways scroll at 200% zoom').toBeLessThanOrEqual(zoomClient);
});

for (const size of [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
] as const) {
  test(`from 1024 px the 18+ box and the seal share a row, with no overflow (${size.width}x${size.height})`, async ({ paw }) => {
    const { page } = paw;
    await page.setViewportSize(size);
    await paw.open();
    await expect(paw.adultBox).toBeVisible();
    const box = await paw.adultTarget.boundingBox();
    const seal = await paw.seal.boundingBox();
    expect(box).not.toBeNull();
    expect(seal).not.toBeNull();
    // The same row: the vertical centres agree, and the box comes right before the seal.
    expect(Math.abs(box!.y + box!.height / 2 - (seal!.y + seal!.height / 2))).toBeLessThanOrEqual(2);
    expect(box!.x + box!.width).toBeLessThanOrEqual(seal!.x + 0.5);
    if (size.width === 1280) {
      expect(box!.y + box!.height, 'the box ends on the first screen').toBeLessThanOrEqual(size.height);
      expect(seal!.y + seal!.height, 'the seal ends on the first screen').toBeLessThanOrEqual(size.height);
    }
    const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scrollWidth, 'no sideways scroll').toBeLessThanOrEqual(clientWidth);
    const band = await page.locator('[data-wish-line]').evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(band[0], 'the band has no overflow').toBeLessThanOrEqual(band[1]!);
  });
}
