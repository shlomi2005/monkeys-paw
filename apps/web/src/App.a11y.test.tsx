// @vitest-environment jsdom
// axe-core on the whole page (task 34, Req 8.1, 8.3, 8.4, 9.3): poster mode, fake API, StrictMode, as in
// App.integration.test.tsx. Four states: empty, after a 3-curse grant, with the binding card open, after Stop.
//
// Colour contrast is switched off here, and only here: jsdom computes no layout and no colours, so axe cannot judge it.
// styles/contrast.test.ts recomputes every token pair against parchment instead.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_WISH_TEXT, sampleGrant, sampleWish } from './api/api-test-support';
import { App } from './App';
import { SessionProvider } from './state/SessionProvider';
import { fakeApi, ok } from './state/paw-session-test-support';
import type { FakeApi } from './state/paw-session-test-support';

// jsdom has no WebGL: the page runs in poster mode, and the probe must not print jsdom's "not implemented" error.
vi.mock('./scene/webgl-support', () => ({ hasWebGL: () => false }));

const EXAMPLE_TEXT = 'Users can reset their password by email';
// The card's accessible name is its visible text: "Example", the wish, the context (WCAG 2.5.3).
const EXAMPLE_NAME = `Example. ${EXAMPLE_TEXT}. A small web shop`;
const exampleEntry = {
  wish: { ...sampleWish(EXAMPLE_TEXT), id: 'ex-1', context: 'A small web shop' },
  grant: sampleGrant(),
};

function renderApp(api: FakeApi) {
  return render(
    <StrictMode>
      <SessionProvider api={api}>
        <App />
      </SessionProvider>
    </StrictMode>,
  );
}

function newApi(): FakeApi {
  const api = fakeApi();
  api.getExamples.mockImplementation(() => Promise.resolve(ok([exampleEntry])));
  return api;
}

// axe measures text on a canvas to tell icon ligatures from words (label-content-name-mismatch). jsdom has no canvas and
// prints "Not implemented" for it. This stub returns the same pixels for every text, so no word counts as a ligature.
function stubCanvas(): void {
  const context = {
    canvas: { width: 0, height: 0 },
    font: '',
    textAlign: '',
    textBaseline: '',
    measureText: () => ({ width: 40 }),
    fillText: () => undefined,
    clearRect: () => undefined,
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(Math.max(1, Math.ceil(width) * Math.ceil(height)) * 4).fill(1),
    }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => context) as unknown as HTMLCanvasElement['getContext'],
  );
}

/** One line per violation, with the rule, the nodes and the way to fix it, so a failure says what to change. */
type AxeResults = Awaited<ReturnType<typeof axe>>;

function describeViolations(results: AxeResults): string[] {
  return results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? 'n/a'}): ${violation.help}\n` +
      violation.nodes.map((node) => `  ${node.html}\n  ${node.failureSummary ?? ''}`).join('\n'),
  );
}

const insideHidden = (el: Element): boolean => el.closest('[aria-hidden="true"]') !== null;

/**
 * What axe cannot know about our design (task 34): names on every control, a named dialog, decoration hidden from
 * assistive tech, and one polite live region. Elements inside a closed dialog are not in the accessibility tree.
 */
function expectStructure(): void {
  const reachable = (el: Element): boolean => !insideHidden(el) && el.closest('dialog:not([open])') === null;

  const fields = [...document.querySelectorAll<HTMLInputElement>('input, textarea, select')].filter(
    (el) => reachable(el) && el.type !== 'hidden',
  );
  for (const field of fields) {
    const named =
      field.hasAttribute('aria-label') || field.hasAttribute('aria-labelledby') || (field.labels?.length ?? 0) > 0;
    expect(named, `unlabelled field: ${field.outerHTML}`).toBe(true);
  }

  const buttons = [...document.querySelectorAll('button')].filter(reachable);
  for (const button of buttons) {
    const named = (button.getAttribute('aria-label') ?? button.textContent ?? '').trim() !== '';
    expect(named, `unnamed button: ${button.outerHTML}`).toBe(true);
  }
  // Same check through the accessibility tree: no button is left out of the list of named buttons.
  expect(screen.queryAllByRole('button', { name: /\S/ })).toHaveLength(screen.queryAllByRole('button').length);

  for (const open of document.querySelectorAll('dialog[open]')) {
    const labelledBy = document.getElementById(open.getAttribute('aria-labelledby') ?? '');
    expect(labelledBy?.textContent?.trim(), 'dialog has no name').toBeTruthy();
    const describedBy = document.getElementById(open.getAttribute('aria-describedby') ?? '');
    expect(describedBy?.textContent?.trim(), 'dialog has no description').toBeTruthy();
    expect(screen.getAllByRole('dialog', { name: /\S/ })).toHaveLength(1);
  }

  // Decoration: every svg, canvas and image is hidden from assistive tech, or it is a named image.
  for (const art of document.querySelectorAll('svg, canvas, img')) {
    const named = art.getAttribute('role') === 'img' && (art.getAttribute('aria-label') ?? '').trim() !== '';
    expect(insideHidden(art) || named, `decoration not aria-hidden: ${art.outerHTML.slice(0, 120)}`).toBe(true);
  }

  // Live regions: all polite, none assertive. The announcer is atomic and exactly one.
  for (const live of document.querySelectorAll('[aria-live]')) {
    expect(live.getAttribute('aria-live'), live.outerHTML.slice(0, 120)).toBe('polite');
  }
  const announcers = document.querySelectorAll('[data-live-region]');
  expect(announcers).toHaveLength(1);
  expect(announcers[0]?.getAttribute('aria-live')).toBe('polite');
  expect(announcers[0]?.getAttribute('aria-atomic')).toBe('true');
  for (const status of document.querySelectorAll('[role="status"]')) {
    expect(status.getAttribute('aria-live') ?? 'polite', status.outerHTML.slice(0, 120)).toBe('polite');
  }
}

async function expectNoViolations(): Promise<void> {
  expectStructure();
  const results = await axe(document.body, {
    // jsdom cannot compute colours (see the header). Every other rule runs.
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(describeViolations(results)).toEqual([]);
  // Guard against a run that checked nothing.
  expect(results.passes.length).toBeGreaterThan(10);
}

const wishInput = (): HTMLInputElement => screen.getByRole('textbox', { name: 'I wish that' }) as HTMLInputElement;
const circle = (name: string): HTMLElement => screen.getByRole('button', { name });
const dialog = (): HTMLElement => document.querySelector('dialog') as HTMLElement;

async function makeWish(): Promise<void> {
  fireEvent.change(wishInput(), { target: { value: SAMPLE_WISH_TEXT } });
  fireEvent.click(screen.getByRole('button', { name: 'Make the wish' }));
  await waitFor(() => expect(circle('Permissions curse, open, click to bind')).toBeTruthy());
  await waitFor(() => expect(circle('Data loss curse, open, click to bind')).toBeTruthy());
  await waitFor(() => expect(document.querySelector('[data-paw-state-text]')?.textContent).toBe('3 fingers curled.'));
}

beforeEach(() => {
  document.getElementById('static-shell')?.remove();
  stubCanvas();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// axe runs on the body here: on the whole document it leaves the container behind after `cleanup()`. The page-level
// facts that index.html owns (language, title, zoom) are checked as text in index-html.test.ts.
describe('axe helper', () => {
  it('reports a violation, so a clean run means something', async () => {
    render(
      <main>
        <input />
        <button type="button" />
      </main>,
    );
    const results = await axe(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual(expect.arrayContaining(['label', 'button-name']));
  });
});

describe('App: axe', () => {
  it('has no violations when empty', async () => {
    renderApp(newApi());
    await screen.findByRole('button', { name: EXAMPLE_NAME });
    await expectNoViolations();
  });

  it('has no violations after a 3-curse grant', async () => {
    renderApp(newApi());
    await makeWish();
    expect(screen.getAllByRole('button', { name: /curse, open, click to bind/ })).toHaveLength(3);
    await expectNoViolations();
  });

  it('has no violations with the binding card open', async () => {
    renderApp(newApi());
    await makeWish();
    fireEvent.click(circle('Permissions curse, open, click to bind'));
    await waitFor(() => expect(dialog().hasAttribute('open')).toBe(true));
    expect(within(dialog()).getByRole('textbox')).toBeTruthy();
    await expectNoViolations();
  });

  it('has no violations after Stop', async () => {
    renderApp(newApi());
    await makeWish();
    fireEvent.click(screen.getByRole('button', { name: 'Stop and take the scroll' }));
    await waitFor(() => expect(screen.getByText(/^Integrity 0\/5/)).toBeTruthy());
    await expectNoViolations();
  });
});
