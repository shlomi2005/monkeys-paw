// @vitest-environment jsdom
// SessionProvider and the reduced-motion preference after mount (task 33, Req 2.9, 8.2): the media query listener sends
// `motion_preference_changed` to the session once per real change. `matchMedia` is mocked and its listeners are fired
// by hand.

import { act, cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REDUCED_MOTION_QUERY } from '../hooks/use-reduced-motion';
import { fakeApi } from './paw-session-test-support';
import type { PawEvent } from './paw-machine-types';
import { SessionProvider, useSession } from './SessionProvider';
import type { SceneEffect } from './scene-bridge';
import type { PawSession, Scheduler } from './use-paw-session';

// Wraps the real session so every dispatch is recorded. The wrapper is stable per real dispatch, like the original.
const dispatched = vi.hoisted(() => ({ events: [] as PawEvent[] }));
vi.mock('./use-paw-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./use-paw-session')>();
  const wrappers = new WeakMap<object, (event: PawEvent) => void>();
  return {
    ...actual,
    usePawSession: (options?: Parameters<typeof actual.usePawSession>[0]): PawSession => {
      const session = actual.usePawSession(options);
      let wrapper = wrappers.get(session.bridge);
      if (wrapper === undefined) {
        const real = session.dispatch;
        wrapper = (event) => {
          dispatched.events.push(event);
          real(event);
        };
        wrappers.set(session.bridge, wrapper);
      }
      return { ...session, dispatch: wrapper };
    },
  };
});

interface MediaMock {
  /** The user changes the preference: the value flips, then every listener fires. */
  set(reduced: boolean): void;
  /** The query fires again with the same value. */
  fireSame(): void;
  listenerCount(): number;
}

function mockMatchMedia(initial: boolean): MediaMock {
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
  const fire = () => {
    act(() => {
      for (const listener of [...listeners]) listener({ matches });
    });
  };
  return {
    set(reduced) {
      matches = reduced;
      fire();
    },
    fireSame: fire,
    listenerCount: () => listeners.size,
  };
}

const motionEvents = (): PawEvent[] => dispatched.events.filter((event) => event.type === 'motion_preference_changed');

let latest: PawSession | null = null;
function Probe() {
  latest = useSession();
  return null;
}
const session = (): PawSession => {
  if (latest === null) throw new Error('Probe has not rendered');
  return latest;
};

beforeEach(() => {
  dispatched.events.length = 0;
  latest = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SessionProvider: motion_preference_changed', () => {
  it('sends nothing on mount, with the preference off or on', () => {
    mockMatchMedia(false);
    render(
      <SessionProvider api={fakeApi()}>
        <Probe />
      </SessionProvider>,
    );
    expect(motionEvents()).toEqual([]);
    cleanup();

    mockMatchMedia(true);
    render(
      <SessionProvider api={fakeApi()}>
        <Probe />
      </SessionProvider>,
    );
    expect(motionEvents()).toEqual([]);
    expect(session().ctx.reducedMotion).toBe(true);
  });

  it('sends nothing on mount in StrictMode (the effect runs twice)', () => {
    mockMatchMedia(false);
    render(
      <StrictMode>
        <SessionProvider api={fakeApi()}>
          <Probe />
        </SessionProvider>
      </StrictMode>,
    );
    expect(motionEvents()).toEqual([]);
  });

  it('sends one event per real change, with the new value', () => {
    const media = mockMatchMedia(false);
    render(
      <SessionProvider api={fakeApi()}>
        <Probe />
      </SessionProvider>,
    );
    media.set(true);
    expect(motionEvents()).toEqual([{ type: 'motion_preference_changed', reduced: true }]);
    expect(session().ctx.reducedMotion).toBe(true);

    media.set(false);
    expect(motionEvents()).toEqual([
      { type: 'motion_preference_changed', reduced: true },
      { type: 'motion_preference_changed', reduced: false },
    ]);
    expect(session().ctx.reducedMotion).toBe(false);
  });

  it('sends nothing when the query fires with the value it already had', () => {
    const media = mockMatchMedia(false);
    render(
      <SessionProvider api={fakeApi()}>
        <Probe />
      </SessionProvider>,
    );
    media.fireSame();
    media.fireSame();
    expect(motionEvents()).toEqual([]);

    media.set(true);
    media.fireSame();
    expect(motionEvents()).toHaveLength(1);
  });

  it('stops listening when the provider unmounts', () => {
    const media = mockMatchMedia(false);
    const { unmount } = render(
      <SessionProvider api={fakeApi()}>
        <Probe />
      </SessionProvider>,
    );
    expect(media.listenerCount()).toBeGreaterThan(0);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('turning reduced motion on mid-curl ends in phase ready with every curl snapped', async () => {
    const media = mockMatchMedia(false);
    // Nothing finishes on its own: the curls stay in flight until the preference changes.
    const stalled: Scheduler = { after: () => () => undefined, microtask: () => undefined };
    render(
      <SessionProvider api={fakeApi()} scheduler={stalled}>
        <Probe />
      </SessionProvider>,
    );
    await act(async () => {
      session().setAdultConfirmed(true);
      session().submitWish({ text: 'Only the owner can delete a project' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(session().ctx.phase).toBe('curling');
    expect(session().ctx.anim.active).not.toBeNull();
    const k = session().ctx.grant?.curses.length ?? 0;
    expect(k).toBeGreaterThanOrEqual(3);

    // A scene that is listening gets the snap.
    const received: SceneEffect[] = [];
    session().bridge.subscribe((effect) => received.push(effect)).setReady(true);

    media.set(true);

    expect(motionEvents()).toEqual([{ type: 'motion_preference_changed', reduced: true }]);
    expect(session().ctx.phase).toBe('ready');
    expect(session().ctx.anim.active).toBeNull();
    expect(session().ctx.anim.queue).toEqual([]);
    expect(session().ctx.reducedMotion).toBe(true);
    expect(session().ctx.curled).toHaveLength(k);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'snap', pose: 'upright' });
  });
});
