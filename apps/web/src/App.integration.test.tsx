// @vitest-environment jsdom
// The whole page in poster mode (no scene attached), inside StrictMode, against a fake ApiClient. No network.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_WISH_TEXT, sampleGrant, sampleVerdict, sampleWish, withCurseStatus } from './api/api-test-support';
import { RESTING_MESSAGE } from './api/api-messages';
import { App } from './App';
import { SessionProvider } from './state/SessionProvider';
import { fakeApi, ok, RESTING } from './state/paw-session-test-support';
import type { FakeApi } from './state/paw-session-test-support';

const EXAMPLE_TEXT = 'Users can reset their password by email';
const exampleEntry = { wish: { ...sampleWish(EXAMPLE_TEXT), id: 'ex-1', context: 'A small web shop' }, grant: sampleGrant() };

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

const wishInput = (): HTMLInputElement => screen.getByRole('textbox', { name: 'I wish that' });
const makeButton = (): HTMLElement => screen.getByRole('button', { name: 'Make the wish' });
const circle = (name: RegExp | string): HTMLElement => screen.getByRole('button', { name });
const fingerText = (): string => document.querySelector('[data-paw-state-text]')?.textContent ?? '';
const dialog = (): HTMLElement => document.querySelector('dialog') as HTMLElement;
const dialogOpen = (): boolean => dialog().hasAttribute('open');

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
    expect(await screen.findByRole('button', { name: `Example wish: ${EXAMPLE_TEXT}` })).toBeTruthy();
    expect(api.getExamples.mock.calls.length).toBeGreaterThanOrEqual(1);
    // Still a working page: a wish goes through after the double effect run.
    await makeWish();
    expect(api.postGrant).toHaveBeenCalledTimes(1);
  });

  it('grants a wish: stamp, narration, curls in poster mode, open circles', async () => {
    const api = newApi();
    renderApp(api);
    await makeWish();

    expect(api.postGrant).toHaveBeenCalledWith({ text: SAMPLE_WISH_TEXT }, expect.anything());
    expect(document.querySelector('[data-stamp]')?.textContent).toBe('Granted.');
    expect(screen.getByText('Granted. Exactly as written.')).toBeTruthy();
    await waitFor(() => expect(fingerText()).toBe('3 fingers curled.'));
    for (const name of [
      'Permissions curse, open, click to bind',
      'Abuse curse, open, click to bind',
      'Data loss curse, open, click to bind',
    ]) {
      expect(circle(name).getAttribute('aria-disabled')).toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Stop and take the scroll' })).toBeTruthy();
    // The wish line is free again for the next round only after a rewrite; the live region said "Granted.".
    expect(document.querySelector('[data-live-region]')?.textContent).toContain('Granted. 3 curses arrive.');
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
    expect(screen.getByText('Integrity 1/5: 1 closed, 2 open').getAttribute('role')).toBe('status');
    expect(screen.queryByRole('button', { name: 'Stop and take the scroll' })).toBeNull();
    expect(fingerText()).toBe('2 fingers stay curled.');

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

describe('App: wish line and examples', () => {
  it('fills the wish line from an example and highlights it; typing clears the highlight and dims the row', async () => {
    renderApp(newApi());
    const card = await screen.findByRole('button', { name: `Example wish: ${EXAMPLE_TEXT}` });
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
    const card = await screen.findByRole('button', { name: `Example wish: ${EXAMPLE_TEXT}` });
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(card.getAttribute('aria-pressed')).toBe('false');
  });

  it('examples-only play: an untouched example replays from its cache, an edited one gets the resting line', async () => {
    const api = newApi();
    api.postGrant.mockImplementationOnce(() => Promise.resolve(RESTING));
    renderApp(api);
    await screen.findByRole('button', { name: `Example wish: ${EXAMPLE_TEXT}` });

    await typeWish('A wish of my own');
    fireEvent.click(makeButton());
    await waitFor(() => expect(screen.getAllByText(RESTING_MESSAGE).length).toBeGreaterThan(0));
    expect(api.postGrant).toHaveBeenCalledTimes(1);

    // An edited example is not an example any more.
    fireEvent.click(screen.getByRole('button', { name: `Example wish: ${EXAMPLE_TEXT}` }));
    await typeWish(`${EXAMPLE_TEXT} today`);
    fireEvent.click(makeButton());
    expect(api.postGrant).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /curse, open/ })).toBeNull();

    // The untouched example plays, with no API call.
    fireEvent.click(screen.getByRole('button', { name: `Example wish: ${EXAMPLE_TEXT}` }));
    fireEvent.click(makeButton());
    await waitFor(() => expect(circle('Permissions curse, open, click to bind')).toBeTruthy());
    expect(api.postGrant).toHaveBeenCalledTimes(1);

    // The Judge rests too: Accept is disabled and no bind request is sent.
    fireEvent.click(circle('Permissions curse, open, click to bind'));
    await waitFor(() => expect(dialogOpen()).toBe(true));
    expect(within(dialog()).getByRole('button', { name: 'Accept this clause' }).getAttribute('aria-disabled')).toBe('true');
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

  it('lists the controls in the required tab order, with empty export and sound slots last', async () => {
    renderApp(newApi());
    await screen.findByRole('button', { name: `Example wish: ${EXAMPLE_TEXT}` });
    await makeWish();
    fireEvent.click(circle('Permissions curse, open, click to bind'));
    await waitFor(() => expect(dialogOpen()).toBe(true));

    expect(focusables().map(nameOf)).toEqual([
      'I wish that',
      'for… (optional context)',
      'Make the wish',
      `Example wish: ${EXAMPLE_TEXT}`,
      'Permissions curse, open, click to bind',
      'Abuse curse, open, click to bind',
      'Data loss curse, open, click to bind',
      expect.stringMatching(/./), // the clause textarea (its text is the suggested clause)
      'Accept this clause',
      'Rewrite the whole wish',
      'Cancel',
      'Stop and take the scroll',
    ]);

    // No positive tabindex anywhere.
    const positive = [...document.querySelectorAll('[tabindex]')].filter((el) => Number(el.getAttribute('tabindex')) > 0);
    expect(positive).toHaveLength(0);

    // The two slots come after the Stop button, last in the DOM, and hold no controls yet.
    const stop = screen.getByRole('button', { name: 'Stop and take the scroll' });
    const exportSlot = document.querySelector('[data-slot="export"]') as HTMLElement;
    const soundSlot = document.querySelector('[data-slot="sound"]') as HTMLElement;
    expect(exportSlot.querySelector(FOCUSABLE)).toBeNull();
    expect(soundSlot.querySelector(FOCUSABLE)).toBeNull();
    expect(stop.compareDocumentPosition(exportSlot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(exportSlot.compareDocumentPosition(soundSlot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const layout = soundSlot.parentElement as HTMLElement;
    expect(layout.lastElementChild).toBe(soundSlot);
  });
});
