// Task 57: the live gate on a phone (paw-web Req 13.10, 13.11), against the stubbed API. The same scenes as the desktop
// file, plus the first-screen check, the 48 px box, the tap and the sideways scroll.

import { confirmationScreen, expectOutsideScreen, inertSeal, outsideScreen, regionRefusal, sealBottom } from './support/gate';
import { expect, test } from './support/test';

const SIZES = [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
] as const;

test('(a) the confirmation screen on a phone', async ({ paw }) => {
  test.setTimeout(150_000);
  await confirmationScreen(paw);
});

test('(b) the outside screen on a phone', async ({ paw }) => {
  test.setTimeout(150_000);
  await outsideScreen(paw);
});

test('(c) after a Grant the seal is inert on a phone, and Rewrite restores it', async ({ paw }) => {
  test.setTimeout(90_000);
  await inertSeal(paw);
});

test('(e) a region refusal turns the open screen into the outside screen on a phone', async ({ paw }) => {
  test.setTimeout(90_000);
  await regionRefusal(paw);
});

for (const size of SIZES) {
  test(`(d) open screen at ${size.width}x${size.height}: the seal ends on the first screen, the box label is a 48 px target and taps, no sideways scroll`, async ({ paw }) => {
    const { page } = paw;
    await page.setViewportSize(size);
    await paw.open();
    await expect(paw.adultBox).toBeVisible();

    expect(await sealBottom(paw), `the seal ends within the first ${size.height} px`).toBeLessThanOrEqual(size.height);
    // The box is drawn small; its label is the target.
    const box = await paw.adultTarget.boundingBox();
    expect(box!.height, 'the label is at least 48 px high').toBeGreaterThanOrEqual(47.5);
    expect(box!.width, 'the label is at least 48 px wide').toBeGreaterThanOrEqual(47.5);
    // Its own row: above the seal, below the context.
    const seal = await paw.seal.boundingBox();
    const disclosure = await page.getByRole('button', { name: 'for… (optional context)' }).boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(disclosure!.y + disclosure!.height - 0.5);
    expect(box!.y + box!.height).toBeLessThanOrEqual(seal!.y + 0.5);

    await paw.adultTarget.tap();
    await expect(paw.adultBox).toBeChecked();
    await paw.adultTarget.tap();
    await expect(paw.adultBox).not.toBeChecked();

    const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scrollWidth, 'no sideways scroll').toBeLessThanOrEqual(clientWidth);
  });

  test(`(d) outside screen at ${size.width}x${size.height}: the seal ends on the first screen, no sideways scroll`, async ({ paw }) => {
    const { page } = paw;
    paw.stub.behavior.live = false;
    await page.setViewportSize(size);
    await paw.open();
    await expectOutsideScreen(paw);

    expect(await sealBottom(paw), `the seal ends within the first ${size.height} px`).toBeLessThanOrEqual(size.height);
    const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scrollWidth, 'no sideways scroll').toBeLessThanOrEqual(clientWidth);
  });
}
