// Page helpers shared by the end-to-end specs (paw-web task 42). They find things the way a user would (roles and
// labels) and wait on the DOM, never on a fixed delay.

import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { WISH_TEXT } from './fixtures';
import type { StubApi } from './stub-api';

export const MAKE_WISH = 'Make the wish';
export const STOP = 'Stop and take the scroll';
export const ACCEPT = 'Accept this clause';
export const TAKE_SCROLL = 'Take the scroll';
export const OPEN_IN_KIRO = 'Open in Kiro';
export const REWRITE = 'Rewrite';

export class PawPage {
  constructor(
    readonly page: Page,
    readonly stub: StubApi,
  ) {}

  /** Opens the app and waits until the 3D canvas has taken over from the poster (software WebGL is working). */
  async open(): Promise<void> {
    await this.page.goto('/');
    await expect(this.page.locator('[data-state="ready"]')).toBeVisible();
    await this.expectScene();
  }

  /** The canvas is mounted and the poster is hidden: the scene is ready and the paw is drawn in WebGL. */
  async expectScene(): Promise<void> {
    await expect(this.page.locator('[data-canvas-slot] canvas')).toBeVisible();
    await expect(this.page.locator('[data-poster]')).toBeHidden();
  }

  get wishInput(): Locator {
    return this.page.getByRole('textbox', { name: 'I wish that' });
  }

  get stateText(): Locator {
    return this.page.locator('[data-paw-state-text]');
  }

  get liveRegion(): Locator {
    return this.page.locator('[data-live-region]');
  }

  get stamp(): Locator {
    return this.page.locator('[data-stamp]');
  }

  get medal(): Locator {
    return this.page.locator('[data-medal]');
  }

  get stopButton(): Locator {
    return this.page.getByRole('button', { name: STOP });
  }

  get dialog(): Locator {
    return this.page.getByRole('dialog');
  }

  /** The slot of circle `index` (0-based): an `li` that exists in every state. */
  slot(index: number): Locator {
    return this.page.locator(`li[data-index="${index}"]`);
  }

  /** The button of circle `index`. It exists once the curse has arrived. */
  circle(index: number): Locator {
    return this.slot(index).getByRole('button');
  }

  /** Types a wish and submits it with the seal button. */
  async makeWish(text: string = WISH_TEXT): Promise<void> {
    await this.wishInput.fill(text);
    await this.page.getByRole('button', { name: MAKE_WISH }).click();
  }

  /** Waits until all `count` circles are open to bind and the paw is quiet (the last curl has finished). */
  async expectCurled(count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await expect(this.slot(index)).toHaveAttribute('data-status', 'open');
    }
    await expect(this.stateText).toHaveText(count === 1 ? '1 finger curled.' : `${count} fingers curled.`);
  }

  /** Opens the binding card of circle `index`. */
  async openCard(index: number): Promise<void> {
    await this.circle(index).click();
    await expect(this.dialog).toBeVisible();
  }

  /** Types `clause` into the open card and presses "Accept this clause". Does not wait for the verdict. */
  async submitClause(clause: string): Promise<void> {
    await this.dialog.getByRole('textbox').fill(clause);
    await this.dialog.getByRole('button', { name: ACCEPT }).click();
  }

  /** Opens circle `index`, submits `clause`, and waits for a closed verdict (the card closes, the circle is sealed). */
  async bindAndClose(index: number, clause: string): Promise<void> {
    await this.openCard(index);
    await this.submitClause(clause);
    await expect(this.dialog).toBeHidden();
    await expect(this.slot(index)).toHaveAttribute('data-status', 'closed');
  }
}
