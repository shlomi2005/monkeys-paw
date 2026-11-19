// The granting twitch (design.md section 3, "Demand rendering"; ui-brief moment 1): a short roll of the whole paw
// about the wrist when the phase becomes `granting`. It only ever writes `rotation.z` of the model root group. It
// never touches a digit joint, and the rest transform (position.y, rotation.x) is left alone, so it cannot fight
// the joint driver. Reduced motion turns it off.

import { clamp01 } from './joint-pose';

/** How long the twitch lasts. */
export const TWITCH_MS = 250;
/** Peak roll about Z, in degrees. Small on purpose: a flinch, not a wave. */
export const TWITCH_ROLL_DEG = 2.5;
/** Full swings during the twitch. */
const TWITCH_SWINGS = 2;

/** Roll in degrees `elapsedMs` after the start. Exactly 0 at the start and from `TWITCH_MS` on. */
export function twitchRoll(elapsedMs: number): number {
  const u = clamp01(elapsedMs / TWITCH_MS);
  if (u >= 1) return 0;
  return TWITCH_ROLL_DEG * Math.sin(u * TWITCH_SWINGS * 2 * Math.PI) * (1 - u);
}

/** The model root group. Only `rotation.z` is written. */
export interface TwitchRoot {
  readonly rotation: { z: number };
}

export interface TwitchOptions {
  readonly root: TwitchRoot;
  /** The scene's counted `invalidate`. Called only while the twitch runs. */
  readonly invalidate: () => void;
  readonly isReducedMotion: () => boolean;
  readonly now?: () => number;
}

export interface Twitch {
  /** Starts the twitch. Does nothing under reduced motion. Restarts one that is running. */
  start(): void;
  /** Call once per rendered frame. Does nothing while the twitch is not running. */
  frame(): void;
  /** Stops it and puts the root back. */
  cancel(): void;
  readonly running: boolean;
}

export function createTwitch(options: TwitchOptions): Twitch {
  const { root, invalidate, isReducedMotion } = options;
  const now = options.now ?? (() => performance.now());
  let startedAt: number | null = null;

  return {
    get running() {
      return startedAt !== null;
    },
    start() {
      if (isReducedMotion()) return;
      startedAt = now();
      invalidate();
    },
    frame() {
      if (startedAt === null) return;
      const elapsed = now() - startedAt;
      root.rotation.z = (twitchRoll(elapsed) * Math.PI) / 180;
      if (elapsed >= TWITCH_MS) {
        startedAt = null; // the last frame has put the root back, no further invalidate
        return;
      }
      invalidate();
    },
    cancel() {
      if (startedAt === null) return;
      startedAt = null;
      root.rotation.z = 0;
    },
  };
}
