// The scenes shared by gate.spec.ts (desktop) and gate.mobile.spec.ts (phone): the 18+ gate, the outside screen, the
// inert seal after the Grant and the region refusal (paw-web Req 13, A13, A14). Every wait is on the DOM.

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  ADULT_REQUIRED_MESSAGE,
  NO_LIVE_WISH_MESSAGE,
  OUTSIDE_NOTE_MESSAGE,
  SEAL_USED_MESSAGE,
} from '../../src/api/api-messages';
import { READY_ROUNDS } from '../../src/state/ready-rounds';
import { WISH_TEXT } from './fixtures';
import { ACCEPT, ADULT_LABEL, REWRITE, TAKE_SCROLL } from './paw-page';
import type { PawPage } from './paw-page';
import { expect } from './test';

const BLOCKING = new Set(['serious', 'critical']);
const ADULT_HEADER = 'x-paw-adult-confirmed';
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const clauseFor = (index: number): string =>
  `WHEN the owner of project ${index + 1} has left, THE SYSTEM SHALL let an admin delete it.`;

/** Waits for finite CSS animations and transitions to end, so axe does not read a colour mid-fade. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = (): Animation[] =>
      document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite().map((animation) => animation.finished.catch(() => undefined)));
  });
}

/** Axe on the whole page: no serious or critical issue. */
export async function expectNoSeriousIssues(page: Page, phase: string): Promise<void> {
  await settle(page);
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations
    .filter((violation) => BLOCKING.has(violation.impact ?? ''))
    .map((violation) => ({
      rule: violation.id,
      nodes: violation.nodes.map((node) => `${node.target.join(' ')} :: ${node.failureSummary ?? ''}`),
    }));
  expect(blocking, `axe, serious or critical issues in phase "${phase}"`).toEqual([]);
}

/** Both storages, the cookie string and the browser's cookie jar are empty. */
export async function expectNothingStored(page: Page, when: string): Promise<void> {
  const inPage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }));
  expect(inPage, `${when}: localStorage, sessionStorage and document.cookie`).toEqual({ local: 0, session: 0, cookie: '' });
  expect(await page.context().cookies(), `${when}: the cookie jar`).toEqual([]);
}

/** The bottom edge of the seal in page coordinates. */
export async function sealBottom(paw: PawPage): Promise<number> {
  const box = await paw.seal.boundingBox();
  if (box === null) throw new Error('the seal has no box');
  return box.y + box.height + (await paw.page.evaluate(() => window.scrollY));
}

/**
 * Waits until the page knows it is outside: the note, no checkbox and the three ready rounds. With `announced` (the
 * probe said so, and no other line competes) it also waits for the live region to hold the line.
 */
export async function expectOutsideScreen(paw: PawPage, announced = true): Promise<void> {
  const { page } = paw;
  await expect(page.locator('[data-wish-line]').getByText(OUTSIDE_NOTE_MESSAGE)).toBeVisible();
  if (announced) await expect(paw.liveRegion).toContainText(OUTSIDE_NOTE_MESSAGE);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  const cards = page.getByRole('list', { name: 'Example wishes' }).getByRole('button');
  await expect(cards).toHaveCount(3);
  for (const [index, round] of READY_ROUNDS.entries()) {
    await expect(cards.nth(index)).toHaveAccessibleName(new RegExp(`^Example\\. ${round.wish.text.slice(0, 20)}`));
  }
}

/** (a) The confirmation screen. */
export async function confirmationScreen(paw: PawPage): Promise<void> {
  const { page, stub } = paw;
  await paw.open();
  const box = paw.adultBox;
  await expect(box).toBeVisible();
  await expect(box).not.toBeChecked();
  await expect(box).toHaveAccessibleName(ADULT_LABEL);
  await expect(box).toHaveAttribute('autocomplete', 'off');
  await expectNoSeriousIssues(page, 'confirmation: idle');

  // No tick: nothing goes out, the alert shows, the box is invalid and has focus, and the alert describes it.
  await paw.wishInput.fill(WISH_TEXT);
  await paw.seal.click();
  await expect(page.getByRole('alert')).toHaveText(ADULT_REQUIRED_MESSAGE);
  await expect(box).toHaveAttribute('aria-invalid', 'true');
  await expect(box).toBeFocused();
  await expect(box).toHaveAccessibleDescription(ADULT_REQUIRED_MESSAGE);
  expect(stub.to('grant'), 'no request without the tick').toHaveLength(0);
  await expect(paw.stamp).toHaveCount(0);
  await expectNoSeriousIssues(page, 'confirmation: alert');

  // Tick by keyboard.
  await page.keyboard.press('Space');
  await expect(box).toBeChecked();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(box).not.toHaveAttribute('aria-invalid', /.*/);

  // The wish goes out with the header, never in the body.
  await paw.seal.click();
  await expect(paw.stamp).toHaveText('Granted.');
  await paw.expectCurled(5);
  expect(stub.to('grant')).toHaveLength(1);
  expect(stub.to('grant')[0]?.headers[ADULT_HEADER]).toBe('yes');
  expect(JSON.stringify(stub.to('grant')[0]?.body)).not.toMatch(/adult|confirm/i);

  // Bind sends it too. Examples, live and export never do.
  await paw.bindAndClose(0, clauseFor(0));
  await paw.stopButton.click();
  await expect(paw.medal).toBeVisible();
  const [scroll] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: TAKE_SCROLL }).click()]);
  expect(scroll.suggestedFilename()).toMatch(/\.zip$/);
  expect(stub.to('bind')).toHaveLength(1);
  for (const request of stub.to('bind')) expect(request.headers[ADULT_HEADER], 'bind').toBe('yes');
  expect(stub.to('live')).toHaveLength(1);
  expect(stub.to('export')).toHaveLength(1);
  for (const request of [...stub.to('examples'), ...stub.to('live'), ...stub.to('export')]) {
    expect(request.headers[ADULT_HEADER], request.endpoint).toBeUndefined();
  }
  await expectNothingStored(page, 'after a round');

  // A reload forgets the tick.
  await page.reload();
  await paw.open();
  await expect(paw.adultBox).not.toBeChecked();
  await expectNothingStored(page, 'after the reload');
}

/** (b) The outside screen: the exact line, no checkbox, nothing sent, and a ready round from start to rest and export. */
export async function outsideScreen(paw: PawPage): Promise<void> {
  const { page, stub } = paw;
  stub.behavior.live = false;
  await paw.open();
  await expectOutsideScreen(paw);
  await expectNoSeriousIssues(page, 'outside: idle');

  // A typed wish sends nothing.
  await paw.wishInput.fill(WISH_TEXT);
  await paw.seal.click();
  await expect(page.locator('[data-wish-line]').getByText(NO_LIVE_WISH_MESSAGE)).toBeVisible();
  await expect(paw.stamp).toHaveCount(0);
  expect(stub.to('grant')).toHaveLength(0);

  // A ready round plays with the clause pre-filled, to rest, with no grant and no bind.
  const round = READY_ROUNDS[0];
  if (round === undefined) throw new Error('no ready round');
  await page.getByRole('list', { name: 'Example wishes' }).getByRole('button').nth(0).click();
  await expect(paw.wishInput).toHaveValue(round.wish.text);
  await paw.seal.click();
  await expect(paw.stamp).toHaveText('Granted.');
  await paw.expectCurled(round.grant.curses.length);
  for (const [index, curse] of round.grant.curses.entries()) {
    await paw.openCard(index);
    await expect(paw.dialog.getByRole('textbox')).toHaveValue(curse.binding?.clause ?? '');
    await paw.dialog.getByRole('button', { name: ACCEPT }).click();
    await expect(paw.dialog).toBeHidden();
    await expect(paw.slot(index)).toHaveAttribute('data-status', 'closed');
  }
  await expect(paw.medal).toContainText('Integrity 5/5');
  await expectNoSeriousIssues(page, 'outside: rested');

  const [scroll] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: TAKE_SCROLL }).click()]);
  expect(scroll.suggestedFilename()).toMatch(/\.zip$/);
  expect(stub.to('grant'), 'no grant request in a ready round').toHaveLength(0);
  expect(stub.to('bind'), 'no bind request in a ready round').toHaveLength(0);
  expect(stub.to('export')).toHaveLength(1);
  const exported = stub.to('export')[0]?.body as { grant?: { curses?: { verdict?: { property?: string } }[] } } | undefined;
  expect(exported?.grant?.curses?.map((curse) => curse.verdict?.property)).toEqual(
    round.grant.curses.map((curse) => curse.verdict?.property),
  );
}

/** (c) The bug: after a Grant the seal is inert, clearly different and described, and sends nothing. Rewrite restores it. */
export async function inertSeal(paw: PawPage): Promise<void> {
  const { page, stub } = paw;
  await paw.open();
  await paw.makeWish();
  await expect(paw.stamp).toHaveText('Granted.');
  await paw.expectCurled(5);

  const seal = paw.seal;
  await expect(seal).toHaveAttribute('aria-disabled', 'true');
  await expect(seal).toHaveAccessibleDescription(SEAL_USED_MESSAGE);
  await expect(seal).toHaveCSS('background-color', TRANSPARENT);
  await expect(seal).toHaveCSS('border-top-style', 'dashed');
  await expect(seal).toHaveCSS('cursor', 'default');
  await expect(seal).toHaveCSS('box-shadow', 'none');
  await expect(paw.wishInput).toHaveAttribute('readonly', '');
  await expect(paw.adultBox).toHaveAttribute('aria-disabled', 'true');

  // Click, Enter and Space send nothing and change nothing. Playwright does not click an aria-disabled button by
  // itself: force it, as a user who ignores the state would.
  await seal.click({ force: true });
  await seal.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await paw.wishInput.focus();
  await page.keyboard.press('Enter');
  await paw.adultBox.click({ force: true });
  await expect(paw.adultBox).toBeChecked();
  await expect(paw.stateText).toHaveText('5 fingers curled.');
  await expect(paw.stamp).toHaveText('Granted.');
  expect(stub.to('grant'), 'no second grant').toHaveLength(1);

  // Rewrite restores the seal.
  await paw.stopButton.click();
  await expect(paw.medal).toBeVisible();
  await page.getByRole('button', { name: REWRITE }).click();
  await expect(paw.wishInput).toBeFocused();
  await expect(seal).not.toHaveAttribute('aria-disabled', /.*/);
  await expect(seal).not.toHaveCSS('background-color', TRANSPARENT);
  await expect(paw.wishInput).not.toHaveAttribute('readonly', /.*/);
  await expect(paw.adultBox).toBeChecked();
}

/** (e) The server refuses a live wish by region: the open screen becomes the outside screen. */
export async function regionRefusal(paw: PawPage): Promise<void> {
  const { page, stub } = paw;
  stub.behavior.refuseRegion = true;
  await paw.open();
  await expect(paw.adultBox).toBeVisible();
  await paw.makeWish();
  await expectOutsideScreen(paw, false); // the refusal's own line is announced first, so the note's turn is brief
  expect(stub.to('grant').map((request) => request.status)).toEqual([403]);
  await expect(paw.stamp).toHaveCount(0);
  await expect(paw.wishInput).toBeEnabled();

  // Sticky: the probe said open, the refusal wins, and a typed wish sends nothing more.
  await paw.wishInput.fill(WISH_TEXT);
  await paw.seal.click();
  await expect(page.locator('[data-wish-line]').getByText(NO_LIVE_WISH_MESSAGE)).toBeVisible();
  expect(stub.to('grant')).toHaveLength(1);
}
