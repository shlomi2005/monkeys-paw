// @vitest-environment jsdom
// The whole page in poster mode (no scene attached), inside StrictMode, against a fake ApiClient. No network.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SAMPLE_WISH_TEXT,
  sampleGrant,
  sampleSpecExport,
  sampleVerdict,
  sampleWish,
  withCurseStatus,
} from './api/api-test-support';
import { RESTING_MESSAGE } from './api/api-messages';
import { App } from './App';
import { readText } from './styles/css-test-support';
import { SessionProvider } from './state/SessionProvider';
import { fakeApi, ok, RESTING } from './state/paw-session-test-support';
import type { FakeApi } from './state/paw-session-test-support';
import { LIVE_REPEAT_MARK } from './components/LiveRegion';
import type { Scheduler } from './state/use-paw-session';

// jsdom has no WebGL: the page runs in poster mode, and the probe must not print jsdom's "not implemented" error.
vi.mock('./scene/webgl-support', () => ({ hasWebGL: () => false }));

const EXAMPLE_TEXT = 'Users can reset their password by email';
// The card's accessible name is its visible text: "Example", the wish, the context (WCAG 2.5.3).
const EXAMPLE_NAME = `Example. ${EXAMPLE_TEXT}. A small web shop`;
const exampleEntry = { wish: { ...sampleWish(EXAMPLE_TEXT), id: 'ex-1', context: 'A small web shop' }, grant: sampleGrant() };

function renderApp(api: FakeApi, scheduler?: Scheduler) {
  return render(
    <StrictMode>
      <SessionProvider api={api} {...(scheduler === undefined ? {} : { scheduler })}>
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

const wishInput = (): HTMLInputElement => screen.getByRole('textbox', { name: 'I wish that' });
const makeButton = (): HTMLElement => screen.getByRole('button', { name: 'Make the wish' });
const circle = (name: RegExp | string): HTMLElement => screen.getByRole('button', { name });
const fingerText = (): string => document.querySelector('[data-paw-state-text]')?.textContent ?? '';
const dialog = (): HTMLElement => document.querySelector('dialog') as HTMLElement;
const dialogOpen = (): boolean => dialog().hasAttribute('open');
const liveText = (): string =>
  (document.querySelector('[data-live-region]')?.textContent ?? '').replaceAll(LIVE_REPEAT_MARK, '');

/**
 * A scheduler whose live-region gap timers (LIVE_GAP_MS) fire only when the test says so. A live message then stays on
 * screen until `fireNext`, so a read cannot miss it however slow the machine is. Microtasks run as usual.
 */
function manualGapScheduler(): { scheduler: Scheduler; fireNext(): boolean } {
  const timers: Array<() => void> = [];
  return {
    scheduler: {
      after(fn) {
        timers.push(fn);
        return () => {
          const at = timers.indexOf(fn);
          if (at >= 0) timers.splice(at, 1);
        };
      },
      microtask: (fn) => queueMicrotask(fn),
    },
    fireNext() {
      const next = timers.shift();
      if (next === undefined) return false;
      act(next);
      return true;
    },
  };
}

async function typeWish(text: string): Promise<void> {
  fireEvent.change(wishInput(), { target: { value: text } });
}

/** Wishes and waits until all three circles are open buttons (every curl done, no scene). */
async function makeWish(text = SAMPLE_WISH_TEXT): Promise<void> {
  await typeWish(text);
  fireEvent.click(makeButton());
  await waitFor(() => expect(circle('Permissions curse, open, click to bind')).toBeTruthy());
  await waitFor(() => expect(circle('Data loss curse, open, click to bind')).toBeTruthy());
}

beforeEach(() => {
  document.getElementById('static-shell')?.remove();
});
afterEach(cleanup);

describe('App: a round from wish to stop', () => {
  it('loads and shows the examples, also after the StrictMode double effect run', async () => {
    const api = newApi();
    renderApp(api);
    expect(await screen.findByRole('button', { name: EXAMPLE_NAME })).toBeTruthy();
    expect(api.getExamples.mock.calls.length).toBeGreaterThanOrEqual(1);
    // Still a working page: a wish goes through after the double effect run.
    await makeWish();
    expect(api.postGrant).toHaveBeenCalledTimes(1);
  });

  it('grants a wish: stamp, narration, curls in poster mode, open circles', async () => {
    const api = newApi();
    const gaps = manualGapScheduler();
    renderApp(api, gaps.scheduler);
    await makeWish();

    expect(api.postGrant).toHaveBeenCalledWith({ text: SAMPLE_WISH_TEXT }, expect.anything());
    await waitFor(() => expect(document.querySelector('[data-stamp]')?.textContent).toBe('Granted.'));
    await waitFor(() => expect(screen.getByText('Granted. Exactly as written.')).toBeTruthy());
    await waitFor(() => expect(fingerText()).toBe('3 fingers curled.'));
    for (const name of [
      'Permissions curse, open, click to bind',
      'Abuse curse, open, click to bind',
      'Data loss curse, open, click to bind',
    ]) {
      expect(circle(name).getAttribute('aria-disabled')).toBeNull();
    }
    expect(await screen.findByRole('button', { name: 'Stop and take the scroll' })).toBeTruthy();
    // The wish line is free again for the next round only after a rewrite; the live region said "Granted.".
    // The gap timer is manual, so the live region still shows its first message however long the waits above took.
    expect(liveText()).toContain('Granted. 3 curses arrive.');

    // Let the queue play out. "Granted." came first, then one announcement per curse, in order.
    const announced = [liveText()];
    while (gaps.fireNext()) if (liveText() !== announced[announced.length - 1]) announced.push(liveText());
    expect(announced).toHaveLength(4);
    expect(announced[0]).toContain('Granted. 3 curses arrive.');
    expect(announced[1]).toMatch(/^Curse 1, Permissions/);
    expect(announced[2]).toMatch(/^Curse 2, Abuse/);
    expect(announced[3]).toMatch(/^Curse 3, Data loss/);
  });

  it('opens the card with a pre-filled clause; a closed verdict closes it and one finger opens', async () => {
    const api = newApi();
    api.postBind.mockImplementation(() =>
      Promise.resolve(ok({ grant: withCurseStatus(sampleGrant(), 'c1', 'closed'), verdict: sampleVerdict('c1', true) })),
    );
    renderApp(api);
    await makeWish();
    await waitFor(() => expect(fingerText()).toBe('3 fingers curled.'));

    fireEvent.click(circle('Permissions curse, open, click to bind'));
    await waitFor(() => expect(dialogOpen()).toBe(true));
    const clause = within(dialog()).getByRole('textbox') as HTMLTextAreaElement;
    expect(clause.value).toMatch(/THEN THE SYSTEM SHALL/);

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Accept this clause' }));
    await waitFor(() => expect(dialogOpen()).toBe(false));
    expect(api.postBind).toHaveBeenCalledTimes(1);
    expect(api.postBind.mock.calls[0]?.[0]).toMatchObject({ curseId: 'c1', kind: 'ears-clause', clause: clause.value });

    await waitFor(() => expect(circle('Permissions curse, closed, sealed')).toBeTruthy());
    await waitFor(() => expect(fingerText()).toBe('2 fingers curled.'));
  });

  it('keeps the card open with "The paw remembers." after a not-closed verdict, and Cancel closes it', async () => {
    const api = newApi();
    api.postBind.mockImplementation(() =>
      Promise.resolve(ok({ grant: sampleGrant(), verdict: sampleVerdict('c1', false) })),
    );
    renderApp(api);
    await makeWish();

    fireEvent.click(circle('Permissions curse, open, click to bind'));
    await waitFor(() => expect(dialogOpen()).toBe(true));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Accept this clause' }));

    await waitFor(() => expect(within(dialog()).getByText('The paw remembers.')).toBeTruthy());
    expect(dialogOpen()).toBe(true);
    expect(fingerText()).toBe('3 fingers curled.');

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(dialogOpen()).toBe(false));
    expect(circle('Permissions curse, open, click to bind')).toBeTruthy();
  });

  it('closes the card on the dialog cancel event (Escape)', async () => {
    renderApp(newApi());
    await makeWish();
    fireEvent.click(circle('Abuse curse, open, click to bind'));
    await waitFor(() => expect(dialogOpen()).toBe(true));
    fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(dialogOpen()).toBe(false));
  });

  it('stops: the medal shows the score, Stop is gone, and a circle opens no card and sends no bind', async () => {
    const api = newApi();
    api.postBind.mockImplementation(() =>
      Promise.resolve(ok({ grant: withCurseStatus(sampleGrant(), 'c1', 'closed'), verdict: sampleVerdict('c1', true) })),
    );
    renderApp(api);
    await makeWish();

    fireEvent.click(circle('Permissions curse, open, click to bind'));
    await waitFor(() => expect(dialogOpen()).toBe(true));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Accept this clause' }));
    await waitFor(() => expect(circle('Permissions curse, closed, sealed')).toBeTruthy());
    await waitFor(() => expect(fingerText()).toBe('2 fingers curled.'));
    expect(api.postBind).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Stop and take the scroll' }));
    await waitFor(() => expect(screen.getByText('Integrity 1/5: 1 closed, 2 open')).toBeTruthy());
    await waitFor(() => {
      expect(screen.getByText('Integrity 1/5: 1 closed, 2 open').getAttribute('role')).toBe('status');
      expect(screen.queryByRole('button', { name: 'Stop and take the scroll' })).toBeNull();
      expect(fingerText()).toBe('2 fingers stay curled.');
    });

    fireEvent.click(circle('Abuse curse, open, the paw remembers'));
    expect(dialogOpen()).toBe(false);
    expect(api.postBind).toHaveBeenCalledTimes(1);
  });

  it('rewrite clears the wish line and empties the circles', async () => {
    renderApp(newApi());
    await makeWish();
    fireEvent.click(circle('Abuse curse, open, click to bind'));
    await waitFor(() => expect(dialogOpen()).toBe(true));

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Rewrite the whole wish' }));
    await waitFor(() => expect(dialogOpen()).toBe(false));

    await waitFor(() => {
      expect(wishInput().value).toBe('');
      expect(screen.queryAllByRole('button', { name: /curse/ })).toHaveLength(0);
      const slots = [...document.querySelectorAll('[data-circle-ring] > li')];
      expect(slots).toHaveLength(5);
      expect(slots.every((slot) => slot.getAttribute('data-status') === 'empty')).toBe(true);
      expect(fingerText()).toBe('The paw rests, all fingers open.');
      expect(screen.queryByRole('button', { name: 'Stop and take the scroll' })).toBeNull();
      expect(document.querySelector('[data-granted-stamp]')).toBeNull();
    });
  });
});

describe('App: wish line and examples', () => {
  it('fills the wish line from an example and highlights it; typing clears the highlight and dims the row', async () => {
    renderApp(newApi());
    const card = await screen.findByRole('button', { name: EXAMPLE_NAME });
    fireEvent.click(card);
    expect(wishInput().value).toBe(EXAMPLE_TEXT);
    expect(screen.getByRole('textbox', { name: 'for…' })).toHaveProperty('value', 'A small web shop');
    expect(card.getAttribute('aria-pressed')).toBe('true');

    await typeWish(`${EXAMPLE_TEXT}!`);
    expect(card.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('[data-state="ready"]')?.className).toMatch(/dimmed/);
  });

  it('Escape in the example row deselects the card', async () => {
    renderApp(newApi());
    const card = await screen.findByRole('button', { name: EXAMPLE_NAME });
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(card.getAttribute('aria-pressed')).toBe('false');
  });

  it('examples-only play: an untouched example replays from its cache, an edited one gets the resting line', async () => {
    const api = newApi();
    api.postGrant.mockImplementationOnce(() => Promise.resolve(RESTING));
    renderApp(api);
    await screen.findByRole('button', { name: EXAMPLE_NAME });

    await typeWish('A wish of my own');
    fireEvent.click(makeButton());
    await waitFor(() => expect(screen.getAllByText(RESTING_MESSAGE).length).toBeGreaterThan(0));
    expect(api.postGrant).toHaveBeenCalledTimes(1);

    // An edited example is not an example any more.
    fireEvent.click(screen.getByRole('button', { name: EXAMPLE_NAME }));
    await typeWish(`${EXAMPLE_TEXT} today`);
    fireEvent.click(makeButton());
    expect(api.postGrant).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /curse, open/ })).toBeNull();

    // The untouched example plays, with no API call.
    fireEvent.click(screen.getByRole('button', { name: EXAMPLE_NAME }));
    fireEvent.click(makeButton());
    await waitFor(() => expect(circle('Permissions curse, open, click to bind')).toBeTruthy());
    expect(api.postGrant).toHaveBeenCalledTimes(1);

    // The Judge rests too: Accept is disabled and no bind request is sent.
    fireEvent.click(circle('Permissions curse, open, click to bind'));
    await waitFor(() => expect(dialogOpen()).toBe(true));
    await waitFor(() =>
      expect(within(dialog()).getByRole('button', { name: 'Accept this clause' }).getAttribute('aria-disabled')).toBe('true'),
    );
    expect(api.postBind).not.toHaveBeenCalled();
  });
});

describe('App: DOM order (Req 8.1)', () => {
  const FOCUSABLE = 'button, input, textarea, select, a[href], [tabindex]';

  function focusables(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) =>
        !el.hasAttribute('disabled') &&
        el.closest('[aria-hidden="true"]') === null &&
        el.getAttribute('tabindex') !== '-1',
    );
  }

  const nameOf = (el: HTMLElement): string =>
    el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName.toLowerCase();

  it('lists the controls in the required tab order, with the sound toggle last', async () => {
    renderApp(newApi());
    await screen.findByRole('button', { name: EXAMPLE_NAME });
    await makeWish();
    fireEvent.click(circle('Permissions curse, open, click to bind'));
    await waitFor(() => expect(dialogOpen()).toBe(true));

    expect(focusables().map(nameOf)).toEqual([
      'I wish that',
      'for… (optional context)',
      'Make the wish',
      EXAMPLE_NAME,
      'Permissions curse, open, click to bind',
      'Abuse curse, open, click to bind',
      'Data loss curse, open, click to bind',
      expect.stringMatching(/./), // the clause textarea (its text is the suggested clause)
      'Accept this clause',
      'Rewrite the whole wish',
      'Cancel',
      'Stop and take the scroll',
      'Sound',
    ]);

    // No positive tabindex anywhere.
    const positive = [...document.querySelectorAll('[tabindex]')].filter((el) => Number(el.getAttribute('tabindex')) > 0);
    expect(positive).toHaveLength(0);

    // The export slot (empty until the round ends) and the sound slot come after the Stop button. The sound toggle is last.
    const stop = screen.getByRole('button', { name: 'Stop and take the scroll' });
    const exportSlot = document.querySelector('[data-slot="export"]') as HTMLElement;
    const soundSlot = document.querySelector('[data-slot="sound"]') as HTMLElement;
    expect(exportSlot.querySelector(FOCUSABLE)).toBeNull();
    expect(soundSlot.querySelectorAll(FOCUSABLE)).toHaveLength(1);
    expect(soundSlot.querySelector(FOCUSABLE)).toBe(screen.getByRole('button', { name: 'Sound' }));
    expect(stop.compareDocumentPosition(exportSlot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(exportSlot.compareDocumentPosition(soundSlot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const layout = soundSlot.parentElement as HTMLElement;
    expect(layout.lastElementChild).toBe(soundSlot);
  });
});

describe('App: the end screen (tasks 37 to 39)', () => {
  const closedLabel = (type: string): string => `${type} curse, closed, sealed`;

  /** The fake Judge closes whatever curse it is asked about, and the Grant it returns keeps the earlier closures. */
  function judgeClosesAll(api: FakeApi): void {
    const closed = new Set<string>();
    api.postBind.mockImplementation((req) => {
      closed.add(req.curseId);
      const grant = [...closed].reduce((g, id) => withCurseStatus(g, id, 'closed'), sampleGrant());
      return Promise.resolve(ok({ grant, verdict: sampleVerdict(req.curseId, true) }));
    });
  }

  async function bind(type: string): Promise<void> {
    fireEvent.click(circle(`${type} curse, open, click to bind`));
    await waitFor(() => expect(dialogOpen()).toBe(true));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Accept this clause' }));
    await waitFor(() => expect(circle(closedLabel(type))).toBeTruthy());
  }

  const takeScroll = (): HTMLElement => screen.getByRole('button', { name: 'Take the scroll' });
  const rewriteButton = (): HTMLElement => screen.getByRole('button', { name: 'Rewrite' });
  const medalText = (): string => document.querySelector('[data-medal] [role="status"]')?.textContent ?? '';

  function expectReset(): void {
    expect(wishInput().value).toBe('');
    expect(document.activeElement).toBe(wishInput());
    expect(screen.queryAllByRole('button', { name: /curse/ })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Rewrite' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Take the scroll' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open in Kiro' })).toBeNull();
    expect(document.querySelector('[data-medal]')).toBeNull();
    expect(document.querySelector('[data-granted-stamp]')).toBeNull();
    expect(fingerText()).toBe('The paw rests, all fingers open.');
  }

  it('all closed: the medal reads 5/5 and export shows; Rewrite resets everything and focuses the wish input', async () => {
    const api = newApi();
    judgeClosesAll(api);
    api.postExport.mockImplementation(() => Promise.resolve(ok(sampleSpecExport())));
    renderApp(api);
    await makeWish();
    expect(screen.queryByRole('button', { name: 'Rewrite' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Take the scroll' })).toBeNull();

    await bind('Permissions');
    await bind('Abuse');
    await bind('Data loss');

    // Rewrite appears with the medal and the export buttons, not earlier (the paw may still be coming to rest).
    const together = (): void => {
      const shown = screen.queryByRole('button', { name: 'Rewrite' }) !== null;
      expect(shown).toBe(medalText() !== '');
      expect(shown).toBe(screen.queryByRole('button', { name: 'Take the scroll' }) !== null);
    };
    together();
    await waitFor(() => expect(medalText()).toBe('Integrity 5/5: 3 closed, 0 open'));
    together();
    await waitFor(() => {
      expect(document.querySelectorAll('[data-laurel="filled"]')).toHaveLength(5);
      expect(takeScroll()).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Open in Kiro' })).toBeTruthy();
    });

    // Tab order of the end screen: the export buttons, Rewrite, then the sound toggle (design.md, focus order).
    await waitFor(() => {
      const names = [...document.querySelectorAll<HTMLElement>('button')]
        .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim())
        .filter((name) => !/curse/.test(name ?? ''));
      expect(names.slice(-4)).toEqual(['Take the scroll', 'Open in Kiro', 'Rewrite', 'Sound']);
    });

    // Circles stay focusable and open no card.
    circle(closedLabel('Abuse')).focus();
    expect(document.activeElement).toBe(circle(closedLabel('Abuse')));
    fireEvent.click(circle(closedLabel('Abuse')));
    expect(dialogOpen()).toBe(false);

    fireEvent.click(rewriteButton());
    await waitFor(() => expectReset());
  });

  it('shows Rewrite under the same condition as the export buttons (view.showExport), not at phase ended', () => {
    // The paw may still be coming to rest in phase `ended`; the medal and export buttons wait for it, so Rewrite does too.
    const source = readText('./App.tsx', import.meta.url);
    expect(source).toMatch(/<RewriteButton show=\{view\.showExport\}/);
    expect(source).toMatch(/<ExportButtons show=\{view\.showExport\}/);
    expect(source).not.toMatch(/<RewriteButton show=\{ctx\.phase/);
  });

  it('Stop with 2 open: cracked seals, "The paw remembers.", laurel, medal and export; Rewrite resets', async () => {
    const api = newApi();
    judgeClosesAll(api);
    renderApp(api);
    await makeWish();
    await bind('Permissions');

    fireEvent.click(screen.getByRole('button', { name: 'Stop and take the scroll' }));
    await waitFor(() => expect(medalText()).toBe('Integrity 1/5: 1 closed, 2 open'));
    await waitFor(() => {
      expect(takeScroll()).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Open in Kiro' })).toBeTruthy();

      const open = document.querySelectorAll('[data-status="open-final"]');
      expect(open).toHaveLength(2);
      for (const slot of open) {
        expect(slot.querySelector('[data-seal="cracked"]')).toBeTruthy();
        expect(slot.textContent).toContain('The paw remembers.');
      }
      const closed = document.querySelector('[data-status="closed"]') as HTMLElement;
      expect(closed.querySelector('[data-seal="sealed"]')).toBeTruthy();
      expect(closed.querySelector('[data-laurel]')).toBeTruthy();
      expect(document.querySelectorAll('[data-status="open-final"] [data-laurel]')).toHaveLength(0);
    });

    // Circles stay focusable after the end and open no card.
    for (const name of ['Abuse curse, open, the paw remembers', 'Data loss curse, open, the paw remembers']) {
      circle(name).focus();
      expect(document.activeElement).toBe(circle(name));
      fireEvent.click(circle(name));
    }
    expect(dialogOpen()).toBe(false);
    expect(api.postBind).toHaveBeenCalledTimes(1);

    fireEvent.click(rewriteButton());
    await waitFor(() => expectReset());
  });

  it('the Stop ending exports: Take the scroll sends the projected grant, with the closed curse marked closed', async () => {
    const api = newApi();
    judgeClosesAll(api);
    api.postExport.mockImplementation(() => Promise.resolve(ok(sampleSpecExport())));
    // jsdom has no object URLs and cannot follow a download link.
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    renderApp(api);
    await makeWish();
    await bind('Permissions');
    fireEvent.click(screen.getByRole('button', { name: 'Stop and take the scroll' }));
    await waitFor(() => expect(takeScroll()).toBeTruthy());

    fireEvent.click(takeScroll());
    await waitFor(() => expect(document.querySelector('[data-slot="export"] [role="status"]')?.textContent).toBe('Scroll saved!'));
    const request = api.postExport.mock.calls[0]?.[0];
    expect(request?.wish.text).toBe(SAMPLE_WISH_TEXT);
    expect(request?.grant.curses.map((c) => `${c.id}:${c.status}`)).toEqual(['c1:closed', 'c2:open', 'c3:open']);
    vi.restoreAllMocks();
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });
});
