// The sound controller: laziness, the user-gesture rule for the AudioContext, and the fall back to off.

import { describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from './fake-audio-context';
import { createSoundController } from './sound-controller';
import type { SoundControllerDeps } from './sound-controller';
import type { SoundPlayer } from './sound-types';

/** A page that records which gesture listeners are attached. */
function fakePage() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener: vi.fn((type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn);
    }),
    fire(type: string): void {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    attached(): number {
      return [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
    },
  };
}

function rig(options: { stored?: boolean; makeContext?: () => never } = {}) {
  const contexts: FakeAudioContext[] = [];
  const player: SoundPlayer = { cue: vi.fn(), dispose: vi.fn() };
  const createSoundPlayer = vi.fn<(ctx: unknown) => SoundPlayer>(() => player);
  const page = fakePage();
  const write = vi.fn<(on: boolean) => void>();
  const makeContext = vi.fn(
    options.makeContext ??
      (() => {
        const ctx = new FakeAudioContext();
        contexts.push(ctx);
        return ctx.asContext();
      }),
  );
  const loadPlayer = vi.fn(() => Promise.resolve({ createSoundPlayer }));
  const deps: SoundControllerDeps = { read: () => options.stored === true, write, makeContext, loadPlayer, target: page };
  return { controller: createSoundController(deps), contexts, player, createSoundPlayer, page, write, makeContext, loadPlayer };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('sound off', () => {
  it('imports nothing, creates no context and attaches no listener, whatever happens', async () => {
    const r = rig();
    r.controller.start();
    r.controller.cue('creak');
    r.page.fire('pointerdown');
    r.page.fire('keydown');
    await flush();
    expect(r.controller.getSnapshot()).toBe(false);
    expect(r.loadPlayer).not.toHaveBeenCalled();
    expect(r.makeContext).not.toHaveBeenCalled();
    expect(r.page.addEventListener).not.toHaveBeenCalled();
    expect(r.player.cue).not.toHaveBeenCalled();
  });
});

describe('turning sound on', () => {
  it('creates the context inside the click, before the player chunk has loaded', async () => {
    const r = rig();
    r.controller.setEnabled(true);
    expect(r.makeContext).toHaveBeenCalledTimes(1); // synchronously, still inside the gesture
    expect(r.contexts[0]?.resumeCalls).toBe(1); // a suspended context is resumed
    expect(r.createSoundPlayer).not.toHaveBeenCalled();
    await flush();
    expect(r.loadPlayer).toHaveBeenCalledTimes(1);
    expect(r.createSoundPlayer).toHaveBeenCalledWith(r.contexts[0]?.asContext());
    expect(r.write).toHaveBeenCalledWith(true);
    expect(r.controller.getSnapshot()).toBe(true);
  });

  it('passes cues to the player while on, and stops when turned off', async () => {
    const r = rig();
    r.controller.setEnabled(true);
    await flush();
    r.controller.cue('stamp');
    expect(r.player.cue).toHaveBeenCalledWith('stamp');
    r.controller.setEnabled(false);
    expect(r.player.dispose).toHaveBeenCalledTimes(1);
    r.controller.cue('creak');
    expect(r.player.cue).toHaveBeenCalledTimes(1);
    expect(r.write).toHaveBeenLastCalledWith(false);
  });

  it('turned off before the chunk arrives: the player is never made and the context is closed', async () => {
    const r = rig();
    r.controller.setEnabled(true);
    r.controller.setEnabled(false);
    await flush();
    expect(r.createSoundPlayer).not.toHaveBeenCalled();
    expect(r.contexts[0]?.closeCalls).toBe(1);
  });

  it('tells subscribers when the state changes', () => {
    const r = rig();
    const listener = vi.fn();
    const unsubscribe = r.controller.subscribe(listener);
    r.controller.setEnabled(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    r.controller.setEnabled(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('sound restored as on after a reload', () => {
  it('shows on at once but makes no context and loads nothing before a gesture', async () => {
    const r = rig({ stored: true });
    expect(r.controller.getSnapshot()).toBe(true);
    r.controller.start();
    await flush();
    expect(r.makeContext).not.toHaveBeenCalled();
    expect(r.loadPlayer).not.toHaveBeenCalled();
    expect(r.page.attached()).toBe(2);
  });

  it.each(['pointerdown', 'keydown'])('waits for the first %s, then acts once', async (type) => {
    const r = rig({ stored: true });
    r.controller.start();
    r.page.fire(type);
    expect(r.makeContext).toHaveBeenCalledTimes(1);
    await flush();
    expect(r.createSoundPlayer).toHaveBeenCalledTimes(1);
    expect(r.page.attached()).toBe(0); // one-shot: both listeners are gone
    r.page.fire('pointerdown');
    r.page.fire('keydown');
    expect(r.makeContext).toHaveBeenCalledTimes(1);
    r.controller.cue('sigh');
    expect(r.player.cue).toHaveBeenCalledWith('sigh');
  });

  it('is silent before the first gesture even when cues arrive', () => {
    const r = rig({ stored: true });
    r.controller.start();
    r.controller.cue('creak');
    expect(r.player.cue).not.toHaveBeenCalled();
  });

  it('dispose removes the waiting listeners', () => {
    const r = rig({ stored: true });
    r.controller.start();
    r.controller.dispose();
    expect(r.page.attached()).toBe(0);
  });
});

describe('when Web Audio fails', () => {
  const throwing = (): never => {
    throw new Error('no audio');
  };

  it('a throwing AudioContext turns the toggle off, silently and for good', async () => {
    const r = rig({ makeContext: throwing });
    expect(() => r.controller.setEnabled(true)).not.toThrow();
    await flush();
    expect(r.controller.getSnapshot()).toBe(false);
    expect(r.write).toHaveBeenLastCalledWith(false);
    expect(r.loadPlayer).not.toHaveBeenCalled();
    expect(() => r.controller.cue('creak')).not.toThrow();
  });

  it('a throwing AudioContext after a restored-on reload turns it off at the first gesture', () => {
    const r = rig({ stored: true, makeContext: throwing });
    r.controller.start();
    expect(() => r.page.fire('pointerdown')).not.toThrow();
    expect(r.controller.getSnapshot()).toBe(false);
  });

  it('a missing AudioContext (no Web Audio in this environment) turns it off', async () => {
    expect(globalThis.AudioContext).toBeUndefined();
    const loadPlayer = vi.fn(() => Promise.resolve({ createSoundPlayer: () => ({ cue: vi.fn(), dispose: vi.fn() }) }));
    const controller = createSoundController({ read: () => false, write: vi.fn(), loadPlayer });
    controller.setEnabled(true);
    await flush();
    expect(controller.getSnapshot()).toBe(false);
    expect(loadPlayer).not.toHaveBeenCalled();
  });

  it('a player chunk that fails to load turns it off and closes the context', async () => {
    const r = rig();
    r.loadPlayer.mockReturnValueOnce(Promise.reject(new Error('chunk 404')));
    r.controller.setEnabled(true);
    await flush();
    expect(r.controller.getSnapshot()).toBe(false);
    expect(r.contexts[0]?.closeCalls).toBe(1);
  });

  it('a player that throws on creation turns it off', async () => {
    const r = rig();
    r.createSoundPlayer.mockImplementationOnce(() => {
      throw new Error('graph failed');
    });
    r.controller.setEnabled(true);
    await flush();
    expect(r.controller.getSnapshot()).toBe(false);
  });
});
