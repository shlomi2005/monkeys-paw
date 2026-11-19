// The joint-driver contract between the session and the 3D scene (design.md section 4).
// The scene never decides what to animate. It receives effects here and reports back with `done`.
// No React, three or DOM: the session owns one bridge and the lazy scene chunk attaches to it.

import type { AnimCommand, PawEvent } from './paw-machine-types';

export type SceneEffect =
  | { type: 'play'; command: AnimCommand }
  | {
      type: 'snap';
      amounts: readonly [number, number, number, number, number];
      pose: 'upright' | 'rested';
    };

/**
 * The scene's side. If a `snap` arrives while a command is playing, the scene cancels that command
 * without calling `done`. The reducer has already cleared `anim.active`, so a late `done` is ignored.
 */
export interface SceneBridge {
  subscribe(listener: (effect: SceneEffect) => void): () => void;
  /** Dispatches `curl_done`, `open_done` or `rest_done` with the command's id. */
  done(command: AnimCommand): void;
}

/** The session's side of the same bridge. */
export interface SceneBridgeHost extends SceneBridge {
  /** True when a scene has subscribed and called `setReady(true)`. */
  isReady(): boolean;
  /**
   * The scene calls `setReady(true)` once it can play commands (after its first frame) and
   * `setReady(false)` when it is lost or unmounting.
   */
  setReady(ready: boolean): void;
  /** Delivers `effect` to the subscribed scene. Returns false, delivering nothing, when no scene is ready. */
  send(effect: SceneEffect): boolean;
  /** The session registers where `done` events go. Returns an unregister function. */
  onDone(handler: (event: PawEvent) => void): () => void;
  /** The session learns when the scene goes away, so it can finish a command that will never report back. */
  onDetach(handler: () => void): () => void;
}

/** The event a finished command reports: `curl` to `curl_done`, `open` to `open_done`, `rest` to `rest_done`. */
export function doneEventOf(command: AnimCommand): Extract<PawEvent, { id: number }> {
  switch (command.kind) {
    case 'curl':
      return { type: 'curl_done', id: command.id };
    case 'open':
      return { type: 'open_done', id: command.id };
    case 'rest':
      return { type: 'rest_done', id: command.id };
  }
}

export function createSceneBridge(): SceneBridgeHost {
  const listeners = new Set<(effect: SceneEffect) => void>();
  const doneHandlers = new Set<(event: PawEvent) => void>();
  const detachHandlers = new Set<() => void>();
  let ready = false;

  const isReady = (): boolean => ready && listeners.size > 0;

  /** Tells the session that a scene that was ready no longer is. */
  const notifyIfDetached = (wasReady: boolean): void => {
    if (!wasReady || isReady()) return;
    for (const handler of [...detachHandlers]) handler();
  };

  return {
    isReady,
    setReady(next) {
      const was = isReady();
      ready = next;
      notifyIfDetached(was);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        const was = isReady();
        listeners.delete(listener);
        notifyIfDetached(was);
      };
    },
    send(effect) {
      if (!isReady()) return false;
      for (const listener of [...listeners]) listener(effect);
      return true;
    },
    done(command) {
      const event = doneEventOf(command);
      for (const handler of [...doneHandlers]) handler(event);
    },
    onDone(handler) {
      doneHandlers.add(handler);
      return () => {
        doneHandlers.delete(handler);
      };
    },
    onDetach(handler) {
      detachHandlers.add(handler);
      return () => {
        detachHandlers.delete(handler);
      };
    },
  };
}
