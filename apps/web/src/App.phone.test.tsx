// @vitest-environment jsdom
// The whole page with a stubbed `matchMedia` (paw-web design.md A12, "Mobile" A to C, task 54): on a phone with a Grant
// the wish line and the examples come after the actions, in the DOM; the scroll and focus rules run; a rotation moves
// the pair back and forth and keeps focus. On desktop nothing moves, scrolls or takes focus.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_WISH_TEXT, sampleGrant, sampleSpecExport, sampleVerdict, sampleWish, withCurseStatus } from './api/api-test-support';
import { App } from './App';
import { PHONE_QUERY } from './hooks/use-media-query';
import { SessionProvider } from './state/SessionProvider';
import { deferred, fakeApi, ok, RESTING } from './state/paw-session-test-support';
import type { FakeApi } from './state/paw-session-test-support';

vi.mock('./scene/webgl-support', () => ({ hasWebGL: () => false }));

const EXAMPLE_TEXT = 'Users can reset their password by email';
const exampleEntry = { wish: { ...sampleWish(EXAMPLE_TEXT), id: 'ex-1' }, grant: sampleGrant() };

/** `matchMedia` where only the phone query can be true. `set` turns the screen and fires the listeners. */
function stubScreen(phone: boolean): { set(phone: boolean): void } {
  let matches = phone;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query === PHONE_QUERY && matches;
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => void (query === PHONE_QUERY && listeners.add(listener)),
    removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
  }));
  return {
    set(value) {
      matches = value;
      act(() => {
        for (const listener of [...listeners]) listener();
      });
    },
  };
}

function newApi(): FakeApi {
  const api = fakeApi();
  api.getExamples.mockImplementation(() => Promise.resolve(ok([exampleEntry])));
  return api;
}

function renderApp(api: FakeApi) {
  return render(
    <StrictMode>
      <SessionProvider api={api}>
        <App />
      </SessionProvider>
    </StrictMode>,
  );
}

const wishInput = (): HTMLInputElement => screen.getByRole('textbox', { name: 'I wish that' });
const seal = (): HTMLElement => screen.getByRole('button', { name: 'Make the wish' });
const circle = (name: RegExp | string): HTMLElement => screen.getByRole('button', { name });
const query = (selector: string): HTMLElement => document.querySelector<HTMLElement>(selector)!;
/** The layout grid: the parent of the sound slot, the last child. */
const layout = (): HTMLElement => query('[data-slot="sound"]').parentElement!;

/** True when `a` comes before `b` in the document. */
const before = (a: Element, b: Element): boolean => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/** The tab order of what matters here, by name: circles, Stop, the wish line, the examples, the sound toggle. */
function order(): string[] {
  const parts: Record<string, Element | null> = {
    ring: query('[data-circle-ring]'),
    actions: query('[data-actions]'),
    wish: query('[data-wish-line]'),
    examples: query('[aria-label="Example wishes"]') ?? query('[data-state]'),
    sound: query('[data-slot="sound"]'),
  };
  return Object.entries(parts)
    .sort(([, a], [, b]) => (before(a!, b!) ? -1 : 1))
    .map(([name]) => name);
}

const USUAL = ['wish', 'examples', 'ring', 'actions', 'sound'];
const RESULT_FIRST = ['ring', 'actions', 'wish', 'examples', 'sound'];

let scrollTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.getElementById('static-shell')?.remove();
  scrollTo = vi.fn();
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function waitForExamples(): Promise<void> {
  await screen.findByRole('button', { name: new RegExp(EXAMPLE_TEXT) });
}

/** Types the wish, focuses the input and presses "Make the wish". Waits until every circle is open. */
async function makeWish(): Promise<void> {
  fireEvent.change(wishInput(), { target: { value: SAMPLE_WISH_TEXT } });
  wishInput().focus();
  fireEvent.click(seal());
  await waitFor(() => expect(circle('Data loss curse, open, click to bind')).toBeTruthy());
}

describe('App on a phone', () => {
  it('keeps the usual order before a Grant', async () => {
    stubScreen(true);
    renderApp(newApi());
    await waitForExamples();
    expect(order()).toEqual(USUAL);
    expect(layout().hasAttribute('data-result-first')).toBe(false);
  });

  it('puts the wish line and the examples after the actions once the Grant has arrived, with the same nodes', async () => {
    stubScreen(true);
    renderApp(newApi());
    await waitForExamples();
    const [form, cards, ring, sound] = [query('[data-wish-line]'), query('[aria-label="Example wishes"]'), query('[data-circle-ring]'), query('[data-slot="sound"]')];
    await makeWish();

    expect(order()).toEqual(RESULT_FIRST);
    expect(layout().getAttribute('data-result-first')).toBe('true');
    expect(query('[data-wish-line]')).toBe(form);
    expect(query('[aria-label="Example wishes"]')).toBe(cards);
    expect(query('[data-circle-ring]')).toBe(ring);
    expect(query('[data-slot="sound"]')).toBe(sound);
    expect(wishInput().value).toBe(SAMPLE_WISH_TEXT);
    // The narration is above the first circle, and the circle list comes right after it.
    expect(before(query('[data-narration]'), circle('Permissions curse, open, click to bind'))).toBe(true);
  });

  it('scrolls to the top once and puts focus on the narration, a tab stop of no one', async () => {
    stubScreen(true);
    renderApp(newApi());
    await waitForExamples();
    await makeWish();
    await waitFor(() => expect(document.activeElement).toBe(query('[data-narration]')));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
    expect(query('[data-narration]').getAttribute('tabindex')).toBe('-1');
  });

  it('moves focus to the status line while granting, then to the narration', async () => {
    stubScreen(true);
    const api = newApi();
    const grant = deferred<Awaited<ReturnType<FakeApi['postGrant']>>>();
    api.postGrant.mockImplementation(() => grant.promise);
    renderApp(api);
    await waitForExamples();
    fireEvent.change(wishInput(), { target: { value: SAMPLE_WISH_TEXT } });
    wishInput().focus();
    fireEvent.click(seal());

    await waitFor(() => expect(document.activeElement).toBe(within(query('[data-wish-line]')).getByRole('status')));
    expect(document.activeElement?.textContent).toBe('The Paw stirs…');
    expect(scrollTo).not.toHaveBeenCalled();

    await act(async () => grant.resolve(ok({ wish: sampleWish(), grant: sampleGrant() })));
    await waitFor(() => expect(document.activeElement).toBe(query('[data-narration]')));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    // The status line is not left a tab stop.
    await waitFor(() => expect(query('[data-wish-line] [role="status"]').hasAttribute('tabindex')).toBe(false));
  });

  it('returns focus to the wish input when the Grant fails, and keeps the usual order', async () => {
    stubScreen(true);
    const api = newApi();
    api.postGrant.mockImplementation(() => Promise.resolve(RESTING));
    renderApp(api);
    await waitForExamples();
    fireEvent.change(wishInput(), { target: { value: 'A wish of my own' } });
    wishInput().focus();
    fireEvent.click(seal());
    await waitFor(() => expect(document.activeElement).toBe(wishInput()));
    expect(order()).toEqual(USUAL);
    expect(scrollTo).not.toHaveBeenCalled();
    await waitFor(() => expect(query('[data-wish-line] [role="status"]').hasAttribute('tabindex')).toBe(false));
  });

  it('puts focus on "Take the scroll" after Stop, which removed the focused button', async () => {
    stubScreen(true);
    const api = newApi();
    api.postBind.mockImplementation(() =>
      Promise.resolve(ok({ grant: withCurseStatus(sampleGrant(), 'c1', 'closed'), verdict: sampleVerdict('c1', true) })),
    );
    renderApp(api);
    await waitForExamples();
    await makeWish();
    const stop = await screen.findByRole('button', { name: 'Stop and take the scroll' });
    stop.focus();
    fireEvent.click(stop);
    const take = await screen.findByRole('button', { name: 'Take the scroll' });
    await waitFor(() => expect(document.activeElement).toBe(take));
    expect(order()).toEqual(RESULT_FIRST);
  });

  it('puts the wish line first again after "Rewrite the whole wish", with the wish input focused', async () => {
    stubScreen(true);
    renderApp(newApi());
    await waitForExamples();
    await makeWish();
    expect(order()).toEqual(RESULT_FIRST);

    fireEvent.click(circle('Permissions curse, open, click to bind'));
    const card = document.querySelector('dialog') as HTMLElement;
    await waitFor(() => expect(card.hasAttribute('open')).toBe(true));
    fireEvent.click(within(card).getByRole('button', { name: 'Rewrite the whole wish' }));

    await waitFor(() => expect(order()).toEqual(USUAL));
    await waitFor(() => expect(document.activeElement).toBe(wishInput()));
    expect(layout().hasAttribute('data-result-first')).toBe(false);
    expect(wishInput().value).toBe('');
  });
});

describe('App: rotation across 768 px', () => {
  it('moves the pair with the screen, keeps focus and caret, and does not scroll', async () => {
    const screenSize = stubScreen(true);
    renderApp(newApi());
    await waitForExamples();
    await makeWish();
    await waitFor(() => expect(document.activeElement).toBe(query('[data-narration]')));
    const input = wishInput();
    const dialogBefore = document.querySelector('dialog');
    input.focus();
    input.setSelectionRange(3, 8, 'backward');
    scrollTo.mockClear();

    screenSize.set(false);
    expect(order()).toEqual(USUAL);
    expect(layout().hasAttribute('data-result-first')).toBe(false);
    expect(wishInput()).toBe(input);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([3, 8, 'backward']);

    screenSize.set(true);
    expect(order()).toEqual(RESULT_FIRST);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 8]);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBe(dialogBefore);
    // The Grant is still shown: no curse was lost, no narration refocused.
    expect(circle('Permissions curse, open, click to bind')).toBeTruthy();
  });

  it('leaves an open card in place when the screen turns', async () => {
    const screenSize = stubScreen(true);
    renderApp(newApi());
    await waitForExamples();
    await makeWish();
    fireEvent.click(circle('Abuse curse, open, click to bind'));
    const card = document.querySelector('dialog') as HTMLElement;
    await waitFor(() => expect(card.hasAttribute('open')).toBe(true));
    const clause = within(card).getByRole('textbox');
    clause.focus();

    screenSize.set(false);
    expect(card.isConnected).toBe(true);
    expect(card.hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(clause);
    screenSize.set(true);
    expect(card.hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(clause);
  });
});

describe('App on desktop', () => {
  it('never moves a node, scrolls, takes focus or adds an attribute, through a whole round', async () => {
    stubScreen(false);
    const api = newApi();
    api.postBind.mockImplementation(() =>
      Promise.resolve(ok({ grant: withCurseStatus(sampleGrant(), 'c1', 'closed'), verdict: sampleVerdict('c1', true) })),
    );
    api.postExport.mockImplementation(() => Promise.resolve(ok(sampleSpecExport())));
    renderApp(api);
    await waitForExamples();
    expect(order()).toEqual(USUAL);
    expect(layout().hasAttribute('data-result-first')).toBe(false);

    const watcher = new MutationObserver(() => undefined);
    watcher.observe(layout(), { childList: true });
    fireEvent.change(wishInput(), { target: { value: SAMPLE_WISH_TEXT } });
    const input = wishInput();
    input.focus();
    fireEvent.click(seal());
    await waitFor(() => expect(circle('Data loss curse, open, click to bind')).toBeTruthy());

    expect(order()).toEqual(USUAL);
    expect(layout().hasAttribute('data-result-first')).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[tabindex]')).toHaveLength(0);

    const stop = await screen.findByRole('button', { name: 'Stop and take the scroll' });
    fireEvent.click(stop);
    await screen.findByRole('button', { name: 'Take the scroll' });
    expect(document.activeElement).toBe(input);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[tabindex]')).toHaveLength(0);
    // Direct children of the layout were never added or removed beyond what React itself did for the Grant.
    const touched = watcher.takeRecords().flatMap((record) => [...record.removedNodes, ...record.addedNodes]);
    watcher.disconnect();
    expect(touched.filter((node) => (node as HTMLElement).dataset?.['slot'] === 'sound')).toEqual([]);
    expect(touched.filter((node) => node instanceof HTMLElement && node.querySelector('[data-wish-line]'))).toEqual([]);
  });

  it('does not take focus that a Grant lost', async () => {
    stubScreen(false);
    const api = newApi();
    const grant = deferred<Awaited<ReturnType<FakeApi['postGrant']>>>();
    api.postGrant.mockImplementation(() => grant.promise);
    renderApp(api);
    await waitForExamples();
    fireEvent.change(wishInput(), { target: { value: SAMPLE_WISH_TEXT } });
    wishInput().focus();
    fireEvent.click(seal());
    await waitFor(() => expect(wishInput().disabled).toBe(true));
    expect(document.activeElement).not.toBe(within(query('[data-wish-line]')).getByRole('status'));
    await act(async () => grant.resolve(ok({ wish: sampleWish(), grant: sampleGrant() })));
    await waitFor(() => expect(circle('Data loss curse, open, click to bind')).toBeTruthy());
    expect(document.activeElement).not.toBe(query('[data-narration]'));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe('App without matchMedia', () => {
  it('is a desktop', async () => {
    vi.stubGlobal('matchMedia', undefined);
    renderApp(newApi());
    await waitForExamples();
    await makeWish();
    expect(order()).toEqual(USUAL);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
