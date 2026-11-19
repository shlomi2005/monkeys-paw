// @vitest-environment jsdom
// Bridge readiness through PawScene under StrictMode. jsdom has no WebGL, so PawCanvas, PawLights and PawModel are
// mocked. PawScene lives in the react-dom root and the joint driver in the r3f root, so StrictMode's simulated unmount
// of PawScene runs its effect cleanups at a moment that is unordered against the driver's lifecycle (and does not
// re-run the driver's). The mocked PawModel plays the driver's part in that other root: it starts once per mount (not
// per StrictMode pass), runs the pair of drivers r3f's own StrictMode makes (the first is disposed, the second
// replaces it) and reports ready either at once, before PawScene's passive cleanup, or later. The scene must leave the
// bridge ready whichever comes first.

import { act, cleanup, render } from '@testing-library/react';
import { StrictMode, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSceneBridge } from '../state/scene-bridge';
import type { SceneBridgeHost, SceneBridgePort, SceneEffect, SceneSubscription } from '../state/scene-bridge';

type ReadyMode = 'before-cleanup' | 'after-cleanup';

const model = vi.hoisted(() => ({
  mode: 'after-cleanup' as 'before-cleanup' | 'after-cleanup',
  received: [] as unknown[],
  fail: null as (() => void) | null,
  teardown: null as (() => void) | null,
}));

vi.mock('./PawCanvas', () => ({ PawCanvas: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('./PawLights', () => ({ PawLights: () => null }));
vi.mock('./PawModel', () => ({
  PawModel: ({ bridge, onFailure }: { bridge: SceneBridgePort; onFailure: () => void }) => {
    const started = useRef(false);
    useLayoutEffect(() => {
      model.fail = onFailure;
      if (started.current) return; // the driver's root is not re-run by PawScene's simulated unmount
      started.current = true;
      const report = (subscription: SceneSubscription, delayMs: number): void => {
        if (model.mode === 'before-cleanup') subscription.setReady(true);
        else setTimeout(() => subscription.setReady(true), delayMs);
      };
      const first = bridge.subscribe((effect) => model.received.push(effect));
      report(first, 10);
      first(); // disposed by r3f's StrictMode
      const second = bridge.subscribe((effect) => model.received.push(effect));
      report(second, 50);
      setTimeout(() => first.setReady(false), 100); // the disposed driver reports late: must change nothing
      model.teardown = () => second();
    }, [bridge, onFailure]);
    return null;
  },
}));

import PawScene from './PawScene';

const PLAY: SceneEffect = { type: 'play', command: { id: 1, kind: 'curl', digit: 0 } };

function mount(bridge: SceneBridgeHost) {
  return render(
    <StrictMode>
      <PawScene
        bridge={bridge}
        initialCurled={[]}
        initialPose="upright"
        granting={false}
        reducedMotion={false}
        glb="web"
        onReady={() => undefined}
        onFailure={() => undefined}
      />
    </StrictMode>,
  );
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  model.received = [];
  model.fail = null;
  model.teardown = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe.each<ReadyMode>(['after-cleanup', 'before-cleanup'])("PawScene in StrictMode, driver ready %s PawScene's cleanup", (mode) => {
  it('leaves the bridge ready and delivers a play effect', async () => {
    model.mode = mode;
    const bridge = createSceneBridge();
    mount(bridge);
    await advance(200);

    expect(bridge.isReady()).toBe(true);
    expect(bridge.send(PLAY)).toBe(true);
    expect(model.received).toEqual([PLAY]);
  });

  it('tells the session when the scene unmounts', async () => {
    model.mode = mode;
    const bridge = createSceneBridge();
    const detached = vi.fn();
    bridge.onDetach(detached);
    const view = mount(bridge);
    await advance(200);

    detached.mockClear(); // the first, StrictMode-disposed driver may have reported its own detach already
    view.unmount();
    model.teardown?.(); // the driver's own dispose, in the other root
    expect(bridge.isReady()).toBe(false);
    expect(detached).toHaveBeenCalledTimes(1);
  });

  it('a failure still makes the bridge unready', async () => {
    model.mode = mode;
    const bridge = createSceneBridge();
    mount(bridge);
    await advance(200);

    act(() => model.fail?.());
    expect(bridge.isReady()).toBe(false);
    expect(bridge.send(PLAY)).toBe(false);
  });
});
