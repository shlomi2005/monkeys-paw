// @vitest-environment jsdom
// The whole page under reduced motion with a mocked `matchMedia` (task 33, Req 2.9, 8.2): the second engraved line
// "Finger curled." / "Finger open." appears only while the preference is on, and follows a change after mount.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_WISH_TEXT, sampleGrant, sampleVerdict, withCurseStatus } from './api/api-test-support';
import { App } from './App';
import { REDUCED_MOTION_QUERY } from './hooks/use-reduced-motion';
import { SessionProvider } from './state/SessionProvider';
import { fakeApi, ok } from './state/paw-session-test-support';
import type { FakeApi } from './state/paw-session-test-support';

vi.mock('./scene/webgl-support', () => ({ hasWebGL: () => false }));

/** A `matchMedia` for the reduced-motion query only. `set` flips the value and fires the listeners. */
function mockMatchMedia(initial: boolean): { set(reduced: boolean): void } {
  let matches = initial;
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const list = {
    get matches() {
      return matches;
    },
    media: REDUCED_MOTION_QUERY,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => list);
  return {
    set(reduced) {
      matches = reduced;
      act(() => {
        for (const listener of [...listeners]) listener({ matches });
      });
    },
  };
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

const caption = (): string => document.querySelector('[data-paw-state-text]')?.textContent ?? '';
const cue = (): string | null => document.querySelector('[data-paw-finger-cue]')?.textContent ?? null;
const circle = (name: string): HTMLElement => screen.getByRole('button', { name });
const dialog = (): HTMLElement => document.querySelector('dialog') as HTMLElement;

async function makeWish(): Promise<void> {
  fireEvent.change(screen.getByRole('textbox', { name: 'I wish that' }), { target: { value: SAMPLE_WISH_TEXT } });
  fireEvent.click(screen.getByRole('button', { name: 'Make the wish' }));
  await waitFor(() => expect(circle('Data loss curse, open, click to bind')).toBeTruthy());
  await waitFor(() => expect(caption()).toBe('3 fingers curled.'));
}

async function closeOneCurse(api: FakeApi): Promise<void> {
  api.postBind.mockImplementation(() =>
    Promise.resolve(ok({ grant: withCurseStatus(sampleGrant(), 'c1', 'closed'), verdict: sampleVerdict('c1', true) })),
  );
  fireEvent.click(circle('Permissions curse, open, click to bind'));
  await waitFor(() => expect(dialog().hasAttribute('open')).toBe(true));
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Accept this clause' }));
  await waitFor(() => expect(caption()).toBe('2 fingers curled.'));
}

beforeEach(() => {
  document.getElementById('static-shell')?.remove();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App under reduced motion', () => {
  it('shows "Finger curled." after the grant and "Finger open." after a close, and clears it on rewrite', async () => {
    mockMatchMedia(true);
    const api = fakeApi();
    renderApp(api);
    expect(cue()).toBeNull();

    await makeWish();
    expect(cue()).toBe('Finger curled.');
    expect(caption()).toBe('3 fingers curled.');

    await closeOneCurse(api);
    expect(cue()).toBe('Finger open.');

    fireEvent.click(screen.getByRole('button', { name: 'Stop and take the scroll' }));
    await waitFor(() => expect(caption()).toBe('2 fingers stay curled.'));
    expect(cue()).toBe('Finger open.');

    fireEvent.click(circle('Abuse curse, open, the paw remembers'));
    expect(cue()).toBe('Finger open.');
  });

  it('clears the line on a rewrite', async () => {
    mockMatchMedia(true);
    renderApp(fakeApi());
    await makeWish();
    expect(cue()).toBe('Finger curled.');
    fireEvent.click(circle('Abuse curse, open, click to bind'));
    await waitFor(() => expect(dialog().hasAttribute('open')).toBe(true));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Rewrite the whole wish' }));
    await waitFor(() => expect(caption()).toBe('The paw rests, all fingers open.'));
    expect(cue()).toBeNull();
  });

  it('shows nothing extra without reduced motion', async () => {
    mockMatchMedia(false);
    const api = fakeApi();
    renderApp(api);
    await makeWish();
    expect(cue()).toBeNull();
    await closeOneCurse(api);
    expect(cue()).toBeNull();
    expect(document.querySelector('[data-paw-state-text]')?.parentElement?.children).toHaveLength(1);
  });

  it('starts showing the line when the preference turns on after mount, from the next change on', async () => {
    const media = mockMatchMedia(false);
    const api = fakeApi();
    renderApp(api);
    await makeWish();
    expect(cue()).toBeNull();

    media.set(true);
    expect(cue()).toBeNull();
    await closeOneCurse(api);
    expect(cue()).toBe('Finger open.');

    media.set(false);
    expect(cue()).toBeNull();
  });
});
