// The `test` the specs import: the Playwright test plus a `paw` fixture. Each test gets a fresh page with the stubbed
// API and the timeline recorder installed before the app loads. After the test, no request may have left the app's
// own origin.

import { expect, test as base } from '@playwright/test';
import { PawPage } from './paw-page';
import { installStubApi } from './stub-api';
import { installTimeline } from './timeline';

export const test = base.extend<{ paw: PawPage }>({
  paw: async ({ page, baseURL }, provide) => {
    if (baseURL === undefined) throw new Error('playwright.config.ts must set use.baseURL');
    const stub = await installStubApi(page, new URL(baseURL).origin);
    await installTimeline(page);
    await provide(new PawPage(page, stub));
    // The app never talks to anyone but its own origin (and the stub answers for the API).
    expect(stub.blocked, 'requests to another origin').toEqual([]);
  },
});

export { expect };
