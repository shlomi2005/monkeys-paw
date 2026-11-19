// The sound controller: what stays in the entry chunk. It holds the on/off state, remembers it, and loads the player
// (design.md "Sound (Req 7)"). While sound is off it does nothing: no import, no AudioContext, no nodes.
//
// The AudioContext is created inside a user gesture, then handed to the lazily imported player:
//   - turning sound on: inside the toggle's click handler;
//   - sound restored as on after a reload: inside the first `pointerdown` or `keydown` anywhere on the page. Never
//     earlier, because a browser would keep an earlier context suspended.
// If Web Audio is missing or throws, sound stays silent and the toggle goes back to off. No error is shown.

import { readSoundPreference, writeSoundPreference } from './sound-preference';
import type { PlayerContext } from './sound-player';
import type { SoundCue, SoundPlayer } from './sound-types';

export interface SoundController {
  /** True when sound is on. For `useSyncExternalStore`. */
  getSnapshot(): boolean;
  subscribe(listener: () => void): () => void;
  /** The toggle's click handler. It must run inside the user gesture. */
  setEnabled(enabled: boolean): void;
  /** Plays a cue. Does nothing while sound is off or the player is not ready. */
  cue(name: SoundCue): void;
  /** Arms the one-shot gesture listener when sound was restored as on. Safe to call again after `dispose`. */
  start(): void;
  dispose(): void;
}

/** What the controller needs from the outside. The defaults are the real thing; tests pass fakes. */
export interface SoundControllerDeps {
  readonly read?: () => boolean;
  readonly write?: (enabled: boolean) => void;
  /** Throws when Web Audio is missing. */
  readonly makeContext?: () => PlayerContext;
  /** The dynamic import of the player chunk. */
  readonly loadPlayer?: () => Promise<{ createSoundPlayer: (ctx: PlayerContext) => SoundPlayer }>;
  /** Where the first gesture is heard. Defaults to `document`. */
  readonly target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
}

/** The gesture events that count (Req 8.1: keyboard users too). */
const GESTURES = ['pointerdown', 'keydown'] as const;

function createAudioContext(): PlayerContext {
  const scope = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (Ctor === undefined) throw new Error('Web Audio is not available');
  return new Ctor();
}

const loadPlayerChunk = () => import('./sound-player');

function quietly(call: () => unknown): void {
  try {
    Promise.resolve(call()).catch(() => undefined);
  } catch {
    // Nothing to do: a context that will not resume or close just stays silent.
  }
}

export function createSoundController(deps: SoundControllerDeps = {}): SoundController {
  const read = deps.read ?? readSoundPreference;
  const write = deps.write ?? writeSoundPreference;
  const makeContext = deps.makeContext ?? createAudioContext;
  const loadPlayer = deps.loadPlayer ?? loadPlayerChunk;

  let enabled = read();
  let player: SoundPlayer | null = null;
  /** Bumped whenever an activation is superseded, so a late import cannot revive sound that was turned off. */
  let generation = 0;
  let disarm: (() => void) | null = null;
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of [...listeners]) listener();
  }

  /** Back to off, silently. Remembered, so the next load does not try again. */
  function giveUp(ctx: PlayerContext | null): void {
    enabled = false;
    player = null;
    write(false);
    if (ctx !== null) quietly(() => ctx.close());
    emit();
  }

  /** Must run inside a user gesture: it creates and resumes the context before anything is awaited. */
  function activate(): void {
    generation += 1;
    const mine = generation;
    let ctx: PlayerContext;
    try {
      ctx = makeContext();
      if (ctx.state === 'suspended') quietly(() => ctx.resume());
    } catch {
      giveUp(null);
      return;
    }
    loadPlayer().then(
      (module) => {
        if (mine !== generation || !enabled) {
          quietly(() => ctx.close());
          return;
        }
        try {
          player = module.createSoundPlayer(ctx);
        } catch {
          giveUp(ctx);
        }
      },
      () => {
        if (mine === generation) giveUp(ctx);
        else quietly(() => ctx.close());
      },
    );
  }

  function stopListening(): void {
    disarm?.();
    disarm = null;
  }

  function deactivate(): void {
    generation += 1;
    player?.dispose();
    player = null;
  }

  return {
    getSnapshot: () => enabled,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setEnabled(next) {
      stopListening();
      enabled = next;
      write(next);
      if (next) activate();
      else deactivate();
      emit();
    },
    cue(name) {
      if (enabled) player?.cue(name);
    },
    start() {
      if (!enabled || player !== null || disarm !== null) return;
      const target = deps.target ?? globalThis.document;
      if (target === undefined) return;
      const onGesture = (): void => {
        stopListening();
        if (enabled && player === null) activate();
      };
      for (const type of GESTURES) target.addEventListener(type, onGesture, { capture: true });
      disarm = () => {
        for (const type of GESTURES) target.removeEventListener(type, onGesture, { capture: true });
      };
    },
    dispose() {
      stopListening();
      deactivate();
    },
  };
}
