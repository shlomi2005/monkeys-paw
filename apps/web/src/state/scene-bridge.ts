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
 * What `subscribe` returns: call it to unsubscribe. `setReady` is scoped to this one subscription, so a caller that
 * was already unsubscribed (a disposed driver) can never change the readiness of the subscriber that replaced it.
 */
export interface SceneSubscription {
  (): void;
  /** Marks this subscription ready (it receives effects) or not. A no-op once unsubscribed. */
  setReady(ready: boolean): void;
}

/**
 * The scene's side. If a `snap` arrives while a command is playing, the scene cancels that command
 * without calling `done`. The reducer has already cleared `anim.active`, so a late `done` is ignored.
 */
export interface SceneBridge {
  subscribe(listener: (effect: SceneEffect) => void): SceneSubscription;
  /** Dispatches `curl_done`, `open_done` or `rest_done` with the command's id. */
  done(command: AnimCommand): void;
}

/** What the scene holds: the contract plus the readiness switch. */
export interface SceneBridgePort extends SceneBridge {
  /**
   * Bridge-wide readiness: sets every current subscription ready or not. Only for a failure that ends the whole
   * scene (load error, error boundary, context loss) and for tests. The joint driver uses the `setReady` of its own
   * subscription instead, because readiness belongs to the driver (design.md section 4).
   */
  setReady(ready: boolean): void;
}

/** The session's side of the same bridge. */
export interface SceneBridgeHost extends SceneBridgePort {
  /** True when at least one subscription is ready. */
  isReady(): boolean;
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
  interface Entry {
    readonly listener: (effect: SceneEffect) => void;
    ready: boolean;
  }
  const entries = new Set<Entry>();
  const doneHandlers = new Set<(event: PawEvent) => void>();
  const detachHandlers = new Set<() => void>();

  const isReady = (): boolean => [...entries].some((entry) => entry.ready);

  /** Tells the session that a scene that was ready no longer is. */
  const notifyIfDetached = (wasReady: boolean): void => {
    if (!wasReady || isReady()) return;
    for (const handler of [...detachHandlers]) handler();
  };

  return {
    isReady,
    setReady(next) {
      const was = isReady();
      for (const entry of entries) entry.ready = next;
      notifyIfDetached(was);
    },
    subscribe(listener) {
      const entry: Entry = { listener, ready: false };
      entries.add(entry);
      const subscription = (() => {
        const was = isReady();
        entries.delete(entry);
        notifyIfDetached(was);
      }) as SceneSubscription;
      subscription.setReady = (next) => {
        if (!entries.has(entry)) return; // stale: this subscriber is gone
        const was = isReady();
        entry.ready = next;
        notifyIfDetached(was);
      };
      return subscription;
    },
    send(effect) {
      const targets = [...entries].filter((entry) => entry.ready);
      if (targets.length === 0) return false;
      for (const entry of targets) entry.listener(effect);
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
