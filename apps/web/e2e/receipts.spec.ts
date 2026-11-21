// Task 49: screenshot receipts on desktop (Req 1, 4, 6). Every test title carries `@receipt`, because the hook
// `ui-screenshot-receipt` runs `playwright test --grep @receipt`. The pictures go to e2e/receipts/ and are gitignored.
//
// The no-WebGL receipt also carries `@no-webgl`: only the `desktop-no-webgl` project runs it and the `desktop`
// project skips it (playwright.config.ts). The mobile receipts are in receipts.mobile.spec.ts.

import { posterOnlyReceipt, reducedMotionReceipt, roundReceipts, stoppedReceipt, wideReceipts } from './support/receipts';
import { test } from './support/test';

test('@receipt a round: idle, curses landed, card open, not closed, closed, rested with medal', async ({ paw }, testInfo) => {
  test.setTimeout(150_000);
  await roundReceipts(paw, testInfo);
});

test('@receipt stopped with the medal', async ({ paw }, testInfo) => {
  test.setTimeout(120_000);
  await stoppedReceipt(paw, testInfo);
});

test('@receipt 1440x900 with the longest narration: curses landed and rested', async ({ paw }, testInfo) => {
  test.setTimeout(150_000);
  await wideReceipts(paw, testInfo);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('@receipt reduced motion', async ({ paw }, testInfo) => {
    test.setTimeout(90_000);
    await reducedMotionReceipt(paw, testInfo);
  });
});

test('@receipt no WebGL: the poster stays', { tag: '@no-webgl' }, async ({ paw }, testInfo) => {
  test.setTimeout(90_000);
  await posterOnlyReceipt(paw, testInfo);
});
