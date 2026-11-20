// Task 45: keyboard and accessibility on desktop (Req 8.1, 8.3, 8.4, 8.5).
//
// Keyboard: the Tab order follows Req 8.1, a modal dialog traps focus and gives it back, Escape closes, Enter and
// Space work. Axe: no serious or critical issue in any phase of a round. Zoom: 200% (a 640 px wide viewport) never
// scrolls sideways.

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { OPEN_IN_KIRO, REWRITE, TAKE_SCROLL } from './support/paw-page';
import { expect, test } from './support/test';

const FOCUS_NAME = (): string => {
  const el = document.activeElement;
  if (el === null || el === document.body) return '(body)';
  const label = el.getAttribute('aria-label');
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return `${el.tagName.toLowerCase()}:${label ?? text}`;
};

/** The focused element as `tag:name`, where the name is the aria-label, or the text when there is none. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(FOCUS_NAME);
}

/**
 * Presses `key` once per step and returns what had focus after each press. With `within`, every press must leave focus
 * inside an element that matches that selector, or on `(body)`. A native modal dialog does not wrap Tab by itself: past
 * its last control, focus leaves the page for the browser's own UI (a headless browser reports the body), and the next
 * press comes back to the dialog. The trap is that the page behind never takes focus.
 */
async function walk(page: Page, key: 'Tab' | 'Shift+Tab', steps: number, within?: string): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press(key);
    seen.push(await focused(page));
    if (within !== undefined) {
      const inside = await page.evaluate((selector) => document.activeElement?.closest(selector) != null, within);
      expect(inside || seen[i] === '(body)', `${key} ${i + 1} puts focus on the page behind ${within}: ${seen[i]}`).toBe(true);
    }
  }
  return seen;
}

/** Waits for finite CSS animations and transitions to end, so axe does not read a colour mid-fade. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = (): Animation[] =>
      document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite().map((animation) => animation.finished.catch(() => undefined)));
  });
}

const BLOCKING = new Set(['serious', 'critical']);

/** Runs axe on the whole page and fails with the rules and the nodes when any issue is serious or critical. */
async function expectNoSeriousIssues(page: Page, phase: string): Promise<void> {
  await settle(page);
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations
    .filter((violation) => BLOCKING.has(violation.impact ?? ''))
    .map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => `${node.target.join(' ')} :: ${node.failureSummary ?? ''}`),
    }));
  expect(blocking, `axe, serious or critical issues in phase "${phase}"`).toEqual([]);
}

const clauseFor = (index: number): string =>
  `WHEN the owner of project ${index + 1} has left, THE SYSTEM SHALL let an admin delete it.`;

const EXAMPLES = [
  'button:Example. Only the owner can delete a project. a team workspace app',
  'button:Example. Refunds are instant. an online shop',
  'button:Example. Free for students',
];

test('Tab order follows Req 8.1: wish, context, make, examples, circles, Stop, then the end screen', async ({ paw }) => {
  const { page } = paw;
  await paw.open();

  // Idle: wish input, the "for…" disclosure, the seal, the three examples, the sound toggle. Nothing else.
  expect(await walk(page, 'Tab', 7)).toEqual([
    'input:I wish that',
    'button:for… (optional context)',
    'button:Make the wish',
    ...EXAMPLES,
    'button:Sound',
  ]);

  // With the context open, its input sits between the disclosure and the seal.
  await page.getByRole('button', { name: 'for… (optional context)' }).click();
  await expect(page.getByRole('textbox', { name: 'for…' })).toBeVisible();
  await paw.wishInput.focus();
  expect(await walk(page, 'Tab', 3)).toEqual(['button:for… (optional context)', 'input:for…', 'button:Make the wish']);

  // Enter in the wish input submits the wish (Req 8.1: Enter submits input).
  await paw.wishInput.fill('Only the owner can delete a project');
  await page.keyboard.press('Enter');
  await expect(paw.stamp).toHaveText('Granted.');
  await paw.expectCurled(5);

  // Curses landed: ... examples, five circles, Stop, sound.
  await paw.wishInput.focus();
  const names = await walk(page, 'Tab', 2 + 1 + 3 + 5 + 2);
  expect(names.slice(0, 3)).toEqual(['button:for… (optional context)', 'input:for…', 'button:Make the wish']);
  expect(names.slice(3, 6)).toEqual(EXAMPLES);
  expect(names.slice(6, 11)).toEqual([
    'button:Permissions curse, open, click to bind',
    'button:Time curse, open, click to bind',
    'button:Abuse curse, open, click to bind',
    'button:Privacy curse, open, click to bind',
    'button:Edge input curse, open, click to bind',
  ]);
  expect(names.slice(11)).toEqual(['button:Stop and take the scroll', 'button:Sound']);

  // Close every circle: the end screen has Take the scroll, Open in Kiro and Rewrite after the circles, then sound.
  for (const index of [0, 1, 2, 3, 4]) await paw.bindAndClose(index, clauseFor(index));
  await expect(paw.medal).toBeVisible();
  await paw.circle(4).focus();
  expect(await walk(page, 'Tab', 4)).toEqual([
    `button:${TAKE_SCROLL}`,
    `button:${OPEN_IN_KIRO}`,
    `button:${REWRITE}`,
    'button:Sound',
  ]);
  // Back with Shift+Tab, the other way.
  expect(await walk(page, 'Shift+Tab', 3)).toEqual([`button:${REWRITE}`, `button:${OPEN_IN_KIRO}`, `button:${TAKE_SCROLL}`]);
});

test('Enter and Space work: examples, circles, the card buttons and Stop', async ({ paw }) => {
  const { page, stub } = paw;
  await paw.open();

  // Space picks an example, Enter on another one picks that one. Escape in the row deselects it (Req 3.8, 8.1).
  const cards = page.getByRole('list', { name: 'Example wishes' }).getByRole('button');
  await cards.nth(1).focus();
  await page.keyboard.press('Space');
  await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(paw.wishInput).toHaveValue('Refunds are instant');
  await cards.nth(0).focus();
  await page.keyboard.press('Enter');
  await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'false');

  // Enter on the seal makes the wish.
  await paw.wishInput.fill('Only the owner can delete a project');
  await page.getByRole('button', { name: 'Make the wish' }).focus();
  await page.keyboard.press('Enter');
  await paw.expectCurled(5);

  // Enter on a circle opens its card. Space on Cancel closes it. Enter on Accept sends the clause.
  await paw.circle(2).focus();
  await page.keyboard.press('Enter');
  await expect(paw.dialog).toBeVisible();
  await paw.dialog.getByRole('button', { name: 'Cancel' }).focus();
  await page.keyboard.press('Space');
  await expect(paw.dialog).toBeHidden();
  await expect(paw.circle(2)).toBeFocused();

  await paw.circle(1).focus();
  await page.keyboard.press('Space');
  await expect(paw.dialog).toBeVisible();
  await paw.dialog.getByRole('textbox').fill(clauseFor(1));
  await paw.dialog.getByRole('button', { name: 'Accept this clause' }).focus();
  await page.keyboard.press('Enter');
  await expect(paw.dialog).toBeHidden();
  await expect(paw.slot(1)).toHaveAttribute('data-status', 'closed');
  expect(stub.to('bind')).toHaveLength(1);

  // Space on Stop ends the round, and Enter on the export button takes the scroll.
  await paw.stopButton.focus();
  await page.keyboard.press('Enter');
  await expect(paw.medal).toBeVisible();
  const scroll = page.getByRole('button', { name: TAKE_SCROLL });
  await scroll.focus();
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Space')]);
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
});

test('the binding card traps focus, Escape closes it and focus goes back to the circle', async ({ paw }) => {
  const { page } = paw;
  await paw.open();
  await paw.makeWish();
  await paw.expectCurled(5);

  await paw.circle(3).focus();
  await page.keyboard.press('Enter');
  await expect(paw.dialog).toBeVisible();
  // Req 4.6: the clause field has focus when the card opens.
  await expect(paw.dialog.getByRole('textbox')).toBeFocused();
  await expect(paw.dialog).toHaveAccessibleName('Privacy');
  await expect(paw.dialog).toHaveAccessibleDescription(/.+/);

  // Tab goes round the card: clause, Accept, Rewrite, Cancel, and back. Never out of it.
  const forward = await walk(page, 'Tab', 9, 'dialog');
  expect(forward.slice(0, 3)).toEqual(['button:Accept this clause', 'button:Rewrite the whole wish', 'button:Cancel']);
  // Past Cancel, focus leaves the page (the body) and then comes back to the clause: the cycle closes.
  expect(forward.slice(3, 5)).toEqual(['(body)', expect.stringMatching(/^textarea:/)]);

  // Shift+Tab goes round the other way and also stays inside.
  await paw.dialog.getByRole('textbox').focus();
  expect(await walk(page, 'Shift+Tab', 2, 'dialog')).toEqual(['(body)', 'button:Cancel']);
  await walk(page, 'Shift+Tab', 6, 'dialog');

  // The page behind is inert: a circle there cannot take focus.
  await paw.circle(0).focus();
  expect(await page.evaluate(() => document.activeElement?.closest('dialog') != null), 'inert page').toBe(true);

  // Escape closes the card, and focus is back on the circle that opened it.
  await page.keyboard.press('Escape');
  await expect(paw.dialog).toBeHidden();
  await expect(paw.circle(3)).toBeFocused();

  // Again, and the same after a bind: the card closes with the verdict and the circle gets focus back.
  await page.keyboard.press('Enter');
  await expect(paw.dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(paw.dialog).toBeHidden();
  await expect(paw.circle(3)).toBeFocused();
});

test('the Open in Kiro dialog traps focus, Escape closes it and focus goes back to its button', async ({ paw }) => {
  const { page } = paw;
  await paw.open();
  await paw.makeWish();
  await paw.expectCurled(5);
  await paw.stopButton.click();
  await expect(paw.medal).toBeVisible();

  const opener = page.getByRole('button', { name: OPEN_IN_KIRO });
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(paw.dialog).toBeVisible();
  await expect(paw.dialog).toHaveAccessibleName('Open in Kiro');
  expect(await page.evaluate(() => document.activeElement?.closest('dialog') != null), 'focus starts inside').toBe(true);
  const forward = await walk(page, 'Tab', 12, 'dialog');
  expect(forward.filter((name) => name !== '(body)'), 'every control of the dialog is reached').toEqual(
    expect.arrayContaining([
      'button:Copy command',
      'button:Download the folder (.zip)',
      'button:Close',
      'button:Copy folder name',
    ]),
  );
  await walk(page, 'Shift+Tab', 12, 'dialog');
  await page.keyboard.press('Escape');
  await expect(paw.dialog).toBeHidden();
  await expect(opener).toBeFocused();

  // And the Close button gives focus back the same way.
  await page.keyboard.press('Enter');
  await expect(paw.dialog).toBeVisible();
  await paw.dialog.getByRole('button', { name: 'Close' }).focus();
  await page.keyboard.press('Space');
  await expect(paw.dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('axe finds no serious or critical issue: idle, landed, card open, closed, rested, export dialog', async ({ paw }) => {
  test.setTimeout(150_000);
  const { page } = paw;

  await paw.open();
  await expectNoSeriousIssues(page, 'idle');

  await paw.makeWish();
  await paw.expectCurled(5);
  await expectNoSeriousIssues(page, 'curses landed');

  await paw.openCard(0);
  await expectNoSeriousIssues(page, 'card open');
  await paw.submitClause(clauseFor(0));
  await expect(paw.dialog).toBeHidden();
  await expect(paw.slot(0)).toHaveAttribute('data-status', 'closed');
  await expectNoSeriousIssues(page, 'closed verdict');

  for (const index of [1, 2, 3, 4]) await paw.bindAndClose(index, clauseFor(index));
  await expect(paw.medal).toBeVisible();
  await expectNoSeriousIssues(page, 'rested with medal');

  await page.getByRole('button', { name: OPEN_IN_KIRO }).click();
  await expect(paw.dialog).toBeVisible();
  await expectNoSeriousIssues(page, 'export dialog open');
});

test('axe finds no serious or critical issue: not closed, stopped with medal', async ({ paw }) => {
  const { page, stub } = paw;
  stub.behavior.closes = () => false;

  await paw.open();
  await paw.makeWish();
  await paw.expectCurled(5);
  await paw.openCard(1);
  await paw.submitClause('The owner can delete.');
  await expect(paw.dialog.getByText('The paw remembers.')).toBeVisible();
  await expectNoSeriousIssues(page, 'not closed');
  await paw.dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(paw.dialog).toBeHidden();

  await paw.stopButton.click();
  await expect(paw.medal).toBeVisible();
  await expectNoSeriousIssues(page, 'stopped with medal');
});

test.describe('200% zoom', () => {
  // 200% zoom of a 1280 px wide window is 640 CSS pixels.
  test.use({ viewport: { width: 640, height: 400 } });

  const noSidewaysScroll = async (page: Page, phase: string): Promise<void> => {
    const widths = await page.evaluate(() => ({
      root: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      view: document.documentElement.clientWidth,
    }));
    expect(widths.root, `${phase}: the page is not wider than the window`).toBeLessThanOrEqual(widths.view);
    expect(widths.body, `${phase}: the body is not wider than the window`).toBeLessThanOrEqual(widths.view);
  };

  test('has no horizontal scroll, idle, in a round and on the end screen', async ({ paw }) => {
    const { page } = paw;
    await page.goto('/');
    await expect(page.locator('[data-state="ready"]')).toBeVisible();
    await noSidewaysScroll(page, 'idle');

    await paw.makeWish();
    await paw.expectCurled(5);
    await noSidewaysScroll(page, 'curses landed');

    await paw.openCard(0);
    await noSidewaysScroll(page, 'card open');
    await paw.dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(paw.dialog).toBeHidden();

    await paw.stopButton.click();
    await expect(paw.medal).toBeVisible();
    await noSidewaysScroll(page, 'end screen');

    // Scrolling right is not possible either.
    await page.evaluate(() => window.scrollTo(1000, 0));
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });
});
