// Task 49: screenshot receipts on a 390 px wide phone, run by the `mobile` project only (Req 1, 4, 6, 9).
// Every test title carries `@receipt` (see receipts.spec.ts). The no-WebGL receipt exists on desktop only.

import { reducedMotionReceipt, roundReceipts, stoppedReceipt } from './support/receipts';
import { test } from './support/test';

test('@receipt a round: idle, curses landed, card open, not closed, closed, rested with medal', async ({ paw }, testInfo) => {
  test.setTimeout(150_000);
  await roundReceipts(paw, testInfo);
});

test('@receipt stopped with the medal', async ({ paw }, testInfo) => {
  test.setTimeout(120_000);
  await stoppedReceipt(paw, testInfo);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('@receipt reduced motion', async ({ paw }, testInfo) => {
    test.setTimeout(90_000);
    await reducedMotionReceipt(paw, testInfo);
  });
});
