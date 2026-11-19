// @vitest-environment jsdom
// PawStage and the lazy scene: gating by WebGL and reduced data, the post-paint import, one GLB choice, the poster
// fade, and failure. The scene module, the WebGL probe and the reduced-data check are mocked: jsdom has no WebGL and
// the r3f Canvas is never rendered here.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneBridgePort } from '../state/scene-bridge';
import type { PawSceneProps } from './PawScene';

const bridge: SceneBridgePort = {
  subscribe: () => Object.assign(() => undefined, { setReady: () => undefined }),
  done: () => undefined,
  setReady: () => undefined,
};

interface Setup {
  readonly webgl?: boolean;
  readonly reducedData?: boolean;
  readonly sceneThrows?: boolean;
}

/** Fresh module graph per test, so the module-level `lazy()` import is counted from zero. */
async function load(setup: Setup = {}) {
  vi.resetModules();
  const sceneImports = vi.fn();
  const probe = vi.fn(() => setup.webgl ?? true);
  const reducedData = vi.fn(() => setup.reducedData ?? false);
  const seen: { props: PawSceneProps | null; renders: number } = { props: null, renders: 0 };
  vi.doMock('./webgl-support', () => ({ hasWebGL: probe }));
  vi.doMock('./reduced-data', () => ({ prefersReducedData: reducedData }));
  vi.doMock('./PawScene', async () => {
    const { createElement } = await import('react');
    sceneImports();
    return {
      default: (props: PawSceneProps) => {
        seen.props = props;
        seen.renders += 1;
        if (setup.sceneThrows) throw new Error('scene boom');
        return createElement('div', { 'data-testid': 'scene' });
      },
    };
  });
  const { PawStage, POSTER_FADE_MS } = await import('./PawStage');
  return { PawStage, POSTER_FADE_MS, sceneImports, probe, reducedData, seen };
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const poster = (container: HTMLElement): HTMLElement => container.querySelector('[data-poster]') as HTMLElement;
const posterHidden = (container: HTMLElement): boolean => /hidden/.test(poster(container).className);
const slot = (container: HTMLElement): HTMLElement => container.querySelector('[data-canvas-slot]') as HTMLElement;

function stubMatchMedia(matches: boolean): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => ({ matches }));
  vi.stubGlobal('matchMedia', fn);
  return fn;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock('./webgl-support');
  vi.doUnmock('./reduced-data');
  vi.doUnmock('./PawScene');
  vi.restoreAllMocks();
});

describe('PawStage gating', () => {
  it('without WebGL: the scene module is never imported and the poster stays', async () => {
    const { PawStage, sceneImports, probe } = await load({ webgl: false });
    const { container } = render(<PawStage bridge={bridge} />);
    await flush(5000);
    expect(probe).toHaveBeenCalled();
    expect(sceneImports).not.toHaveBeenCalled();
    expect(screen.queryByTestId('scene')).toBeNull();
    expect(posterHidden(container)).toBe(false);
  });

  it('with reduced data: never imports the scene, never even probes WebGL, and the poster stays', async () => {
    const { PawStage, sceneImports, probe, reducedData } = await load({ reducedData: true });
    const { container } = render(<PawStage bridge={bridge} />);
    await flush(5000);
    expect(reducedData).toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(sceneImports).not.toHaveBeenCalled();
    expect(posterHidden(container)).toBe(false);
  });

  it('without a bridge: a plain poster box that checks nothing and imports nothing', async () => {
    const { PawStage, sceneImports, probe, reducedData } = await load();
    render(<PawStage />);
    await flush(5000);
    expect(probe).not.toHaveBeenCalled();
    expect(reducedData).not.toHaveBeenCalled();
    expect(sceneImports).not.toHaveBeenCalled();
  });

  it('with WebGL: imports only after first paint, through the 200 ms fallback when there is no requestIdleCallback', async () => {
    const { PawStage, sceneImports } = await load();
    render(<PawStage bridge={bridge} />);
    await flush(0);
    expect(sceneImports).not.toHaveBeenCalled(); // first paint is done, the import has not started
    await flush(199);
    expect(sceneImports).not.toHaveBeenCalled();
    await flush(1);
    expect(sceneImports).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('scene')).not.toBeNull();
  });

  it('with WebGL: uses requestIdleCallback when it exists', async () => {
    let idle: (() => void) | undefined;
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
      idle = cb;
      return 1;
    });
    vi.stubGlobal('cancelIdleCallback', () => undefined);
    const { PawStage, sceneImports } = await load();
    render(<PawStage bridge={bridge} />);
    await flush(1000);
    expect(sceneImports).not.toHaveBeenCalled();
    await act(async () => {
      idle?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sceneImports).toHaveBeenCalledTimes(1);
  });

  it('under StrictMode: one import, one GLB choice, one matchMedia read for the choice', async () => {
    const matchMedia = stubMatchMedia(false);
    const { PawStage, sceneImports, probe, seen } = await load();
    render(
      <StrictMode>
        <PawStage bridge={bridge} />
      </StrictMode>,
    );
    await flush(200);
    expect(sceneImports).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(matchMedia).toHaveBeenCalledTimes(1);
    expect(seen.props?.glb).toBe('web');
  });

  it('chooses the GLB once on mount: a later viewport change does not change it', async () => {
    const matchMedia = stubMatchMedia(true);
    const { PawStage, seen } = await load();
    const { rerender } = render(<PawStage bridge={bridge} />);
    await flush(200);
    expect(seen.props?.glb).toBe('mobile');
    matchMedia.mockImplementation(() => ({ matches: false }));
    rerender(<PawStage bridge={bridge} reducedMotion />);
    await flush(1000);
    expect(seen.props?.glb).toBe('mobile');
    expect(matchMedia).toHaveBeenCalledTimes(1);
  });

  it('hands the scene its props: bridge, initial pose, granting, motion preference and the two callbacks', async () => {
    const { PawStage, seen } = await load();
    render(<PawStage bridge={bridge} initialCurled={[0, 1]} initialPose="rested" granting reducedMotion />);
    await flush(200);
    expect(seen.props?.bridge).toBe(bridge);
    expect(seen.props?.initialCurled).toEqual([0, 1]);
    expect(seen.props?.initialPose).toBe('rested');
    expect(seen.props?.granting).toBe(true);
    expect(seen.props?.reducedMotion).toBe(true);
    expect(typeof seen.props?.onReady).toBe('function');
    expect(typeof seen.props?.onFailure).toBe('function');
  });
});

describe('PawStage poster and fade', () => {
  it('keeps the poster visible while the scene loads, and hides it 300 ms after onReady', async () => {
    const { PawStage, POSTER_FADE_MS, seen } = await load();
    const { container } = render(<PawStage bridge={bridge} />);
    await flush(200);
    expect(posterHidden(container)).toBe(false);
    expect(slot(container).className).toMatch(/sceneLoading/);

    await act(async () => seen.props?.onReady());
    expect(POSTER_FADE_MS).toBe(300);
    expect(slot(container).className).toMatch(/sceneShown/);
    expect(slot(container).className).not.toMatch(/sceneLoading/);
    expect(posterHidden(container)).toBe(false);
    await flush(299);
    expect(posterHidden(container)).toBe(false);
    await flush(1);
    expect(posterHidden(container)).toBe(true);
  });

  it('under reduced motion: no fade, the poster is hidden at once', async () => {
    const { PawStage, seen } = await load();
    const { container } = render(<PawStage bridge={bridge} reducedMotion />);
    await flush(200);
    await act(async () => seen.props?.onReady());
    expect(slot(container).className).toMatch(/instant/);
    expect(posterHidden(container)).toBe(true);
  });

  it('keeps the poster when the scene reports failure before it is ready, and drops the scene', async () => {
    const { PawStage, seen } = await load();
    const { container } = render(<PawStage bridge={bridge} />);
    await flush(200);
    await act(async () => seen.props?.onFailure());
    expect(screen.queryByTestId('scene')).toBeNull();
    expect(posterHidden(container)).toBe(false);
    await flush(5000);
    expect(posterHidden(container)).toBe(false);
  });

  it('brings the poster back when the scene fails after it was ready (context lost), and never reloads', async () => {
    const { PawStage, sceneImports, seen } = await load();
    const { container } = render(<PawStage bridge={bridge} />);
    await flush(200);
    await act(async () => seen.props?.onReady());
    await flush(300);
    expect(posterHidden(container)).toBe(true);
    await act(async () => seen.props?.onFailure());
    expect(screen.queryByTestId('scene')).toBeNull();
    expect(posterHidden(container)).toBe(false);
    await flush(5000);
    expect(sceneImports).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('scene')).toBeNull();
  });

  it('a scene that throws leaves the poster visible, and the rest of the page keeps working', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { PawStage } = await load({ sceneThrows: true });
    function Page(): ReactElement {
      const [n, setN] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setN(n + 1)}>
            clicks {n}
          </button>
          <PawStage bridge={bridge} />
        </>
      );
    }
    const { container } = render(<Page />);
    await flush(200);
    await flush(0);
    expect(screen.queryByTestId('scene')).toBeNull();
    expect(posterHidden(container)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'clicks 0' }));
    expect(screen.getByRole('button', { name: 'clicks 1' })).not.toBeNull();
    await flush(5000);
    expect(posterHidden(container)).toBe(false);
  });

  it('still honours the posterHidden prop and keeps rendering children in the slot', async () => {
    const { PawStage } = await load();
    const { container } = render(
      <PawStage posterHidden>
        <i data-testid="kid" />
      </PawStage>,
    );
    expect(posterHidden(container)).toBe(true);
    expect(slot(container).querySelector('[data-testid="kid"]')).not.toBeNull();
  });
});
