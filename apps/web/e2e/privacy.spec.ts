// Task 47: privacy (Req 7.4, 11.1 to 11.6). After a whole round, to the end screen and through both exports, the
// browser holds nothing about the wish, the URL never moved, no request URL carries the wish, every request went to the
// app's own origin and no API request carried credentials.

import type { Page, Request } from '@playwright/test';
import { OPEN_IN_KIRO, TAKE_SCROLL } from './support/paw-page';
import { expect, test } from './support/test';

/** Distinctive words that appear nowhere else in the app, the fixtures or the stub. */
const WISH = 'Zebra-quartz-7391 may delete a project';
const CONTEXT = 'harbour-lantern-5528 workspace';
const SECRETS = ['zebra-quartz-7391', 'harbour-lantern-5528'] as const;

const clauseFor = (index: number): string =>
  `WHEN the owner of project ${index + 1} has left, THE SYSTEM SHALL let an admin delete it.`;

interface Watch {
  readonly navigations: string[];
  readonly requests: Request[];
}

/** Records every navigation and every request of the page. Install it before the first `goto`. */
function watch(page: Page): Watch {
  const seen: Watch = { navigations: [], requests: [] };
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) seen.navigations.push(frame.url());
  });
  page.on('request', (request) => {
    seen.requests.push(request);
  });
  return seen;
}

/** What the page keeps: both storages, the cookie string and the browser's cookie jar. */
async function stored(page: Page): Promise<{ local: Record<string, string>; session: Record<string, string>; cookie: string; jar: unknown[] }> {
  const inPage = await page.evaluate(() => {
    const dump = (storage: Storage): Record<string, string> =>
      Object.fromEntries(Array.from({ length: storage.length }, (_, i) => storage.key(i) ?? '').map((key) => [key, storage.getItem(key) ?? '']));
    return { local: dump(localStorage), session: dump(sessionStorage), cookie: document.cookie };
  });
  return { ...inPage, jar: await page.context().cookies() };
}

/** Variants of `secret` as they could appear in a URL. */
function spellings(secret: string): string[] {
  return [secret, encodeURIComponent(secret), secret.toUpperCase(), encodeURIComponent(secret).toUpperCase()].map((text) =>
    text.toLowerCase(),
  );
}

test('after a full round the browser keeps nothing, the URL never moves and nothing leaves the app', async ({ paw, baseURL }) => {
  test.setTimeout(150_000);
  const { page, stub } = paw;
  const origin = new URL(baseURL!).origin;
  const seen = watch(page);

  await paw.open();
  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole('button', { name: 'for… (optional context)' }).click();
  await page.getByRole('textbox', { name: 'for…' }).fill(CONTEXT);
  await paw.makeWish(WISH);
  await paw.expectCurled(5);
  for (const index of [2, 0, 4, 1, 3]) await paw.bindAndClose(index, clauseFor(index));
  await expect(paw.medal).toBeVisible();

  // Both exports: the scroll and the folder.
  const [scroll] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: TAKE_SCROLL }).click()]);
  expect(scroll.suggestedFilename()).toMatch(/\.zip$/);
  await page.getByRole('button', { name: OPEN_IN_KIRO }).click();
  await expect(paw.dialog).toBeVisible();
  const [folder] = await Promise.all([
    page.waitForEvent('download'),
    paw.dialog.getByRole('button', { name: 'Download the folder (.zip)' }).click(),
  ]);
  expect(folder.suggestedFilename()).toMatch(/\.zip$/);
  await paw.dialog.getByRole('button', { name: 'Close' }).click();
  await expect(paw.dialog).toBeHidden();

  // The wish really went out, in the body of the grant request, and only there.
  const grantBody = JSON.stringify(stub.to('grant')[0]?.body).toLowerCase();
  expect(grantBody).toContain(SECRETS[0]);
  expect(grantBody).toContain(SECRETS[1]);

  // 1. Storage: nothing in localStorage but (at most) the sound key, nothing in sessionStorage, no cookie.
  const kept = await stored(page);
  expect(Object.keys(kept.local).filter((key) => key !== 'pawSoundEnabled'), 'localStorage keys').toEqual([]);
  expect(kept.session, 'sessionStorage').toEqual({});
  expect(kept.cookie, 'document.cookie').toBe('');
  expect(kept.jar, 'the cookie jar of the browser').toEqual([]);

  // 2. The URL never changed, not even by a hash or a query.
  expect(seen.navigations, 'every navigation of the main frame').toEqual([`${origin}/`]);
  expect(page.url()).toBe(`${origin}/`);
  expect(await page.evaluate(() => [location.search, location.hash, history.length])).toEqual(['', '', historyLength]);
  const navigationRequests = seen.requests.filter((request) => request.isNavigationRequest()).map((request) => request.url());
  expect(navigationRequests, 'navigation requests').toEqual([`${origin}/`]);

  // 3. No request URL contains the wish or its context, in any spelling.
  const urls = seen.requests.map((request) => request.url());
  expect(urls.length).toBeGreaterThan(5);
  for (const url of urls) {
    const readable = (() => {
      try {
        return decodeURIComponent(url.replace(/\+/g, ' '));
      } catch {
        return url;
      }
    })().toLowerCase();
    for (const secret of SECRETS) {
      for (const form of [...spellings(secret), secret.replace(/-/g, ' ')]) {
        expect(url.toLowerCase().includes(form) || readable.includes(form), `a request URL carries "${secret}": ${url}`).toBe(false);
      }
    }
    expect(readable, 'the words of the wish').not.toContain('may delete a project');
  }

  // 4. Every request went to the app's origin (a blob or data URL for a download is local to the page).
  for (const url of urls) {
    const parsed = new URL(url);
    if (parsed.protocol === 'blob:') {
      expect(parsed.pathname.startsWith(origin), `blob from another origin: ${url}`).toBe(true);
    } else if (parsed.protocol !== 'data:') {
      expect(parsed.origin, `request to another origin: ${url}`).toBe(origin);
    }
  }
  expect(stub.blocked, 'requests the stub aborted as off-origin').toEqual([]);

  // 5. The API is called with no credentials: no cookie, no authorization, and no URL userinfo.
  const apiRequests = seen.requests.filter((request) => new URL(request.url()).pathname.startsWith('/api/'));
  expect(apiRequests.map((request) => new URL(request.url()).pathname).sort()).toEqual([
    '/api/bind',
    '/api/bind',
    '/api/bind',
    '/api/bind',
    '/api/bind',
    '/api/examples',
    '/api/export',
    '/api/export',
    '/api/grant',
    '/api/live',
  ]);
  for (const request of apiRequests) {
    const headers = await request.allHeaders();
    const name = `${request.method()} ${new URL(request.url()).pathname}`;
    expect(Object.keys(headers), `${name}: credential headers`).not.toContain('cookie');
    expect(Object.keys(headers), `${name}: credential headers`).not.toContain('authorization');
    expect(Object.keys(headers), `${name}: credential headers`).not.toContain('proxy-authorization');
    expect(new URL(request.url()).username + new URL(request.url()).password, `${name}: userinfo in the URL`).toBe('');
  }
  for (const recorded of stub.requests) {
    expect(Object.keys(recorded.headers), `stub saw ${recorded.endpoint}`).not.toContain('cookie');
    expect(Object.keys(recorded.headers), `stub saw ${recorded.endpoint}`).not.toContain('authorization');
  }
  expect(stub.requests).toHaveLength(apiRequests.length);
});

test('turning the sound on stores the sound key and nothing else', async ({ paw, baseURL }) => {
  const { page } = paw;
  const origin = new URL(baseURL!).origin;
  const seen = watch(page);

  await paw.open();
  expect((await stored(page)).local, 'before the toggle').toEqual({});

  const toggle = page.getByRole('button', { name: 'Sound' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  // A round with the sound on: the cues play, and still nothing else is stored.
  await paw.makeWish(WISH);
  await paw.expectCurled(5);
  await paw.bindAndClose(0, clauseFor(0));
  await paw.stopButton.click();
  await expect(paw.medal).toBeVisible();

  const kept = await stored(page);
  expect(Object.keys(kept.local), 'localStorage keys with the sound on').toEqual(['pawSoundEnabled']);
  expect(kept.local['pawSoundEnabled']).toBe('1');
  expect(kept.session).toEqual({});
  expect(kept.cookie).toBe('');
  expect(kept.jar).toEqual([]);

  // Off again: the key stays and says so. Nothing new appears.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const off = await stored(page);
  expect(Object.keys(off.local)).toEqual(['pawSoundEnabled']);
  expect(off.local['pawSoundEnabled']).toBe('0');

  // The sound files are the app's own, and the URL stayed put.
  for (const request of seen.requests) {
    const url = new URL(request.url());
    if (url.protocol === 'http:' || url.protocol === 'https:') expect(url.origin).toBe(origin);
  }
  expect(seen.navigations).toEqual([`${origin}/`]);
  for (const request of seen.requests) {
    for (const secret of SECRETS) expect(request.url().toLowerCase()).not.toContain(secret);
  }
});
