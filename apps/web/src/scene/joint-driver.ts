// The joint driver without React or WebGL (design.md section 3, "Driver"). It poses a set of bones and one root
// group from the effects the session sends, and reports back through the bridge. `use-joint-driver.ts` is the thin
// r3f wrapper. Everything here runs in Vitest's node environment against three `Object3D`s or plain objects.

import type { AnimCommand, Digit } from '../state/paw-machine-types';
import { amountsFor } from '../state/paw-machine';
import type { SceneBridgePort, SceneEffect } from '../state/scene-bridge';
import { sample, snapSample } from './anim-sampler';
import type { Amounts } from './anim-sampler';
import { DIGIT_JOINTS, DRIVEN_JOINTS } from './digit-joints';
import type { DrivenJointName, JointName } from './digit-joints';
import { poseJoint } from './joint-pose';
import type { JointSpec } from './joint-pose';
import { PAW_CONTROLS } from './paw-controls';
import { releaseJoints } from './release-joints';
import type { MixerLike } from './release-joints';
import type { RestTransform } from './rest-pose';

const DEG_TO_RAD = Math.PI / 180;

/** Anything with a writable quaternion: a three `Bone` or `Object3D`. */
export interface BoneLike {
  readonly quaternion: { set(x: number, y: number, z: number, w: number): unknown };
}

/** The model root group (`RestGroup`). Sink goes on `position.y`, tilt on `rotation.x`. */
export interface RootLike {
  readonly position: { y: number };
  readonly rotation: { x: number };
}

export type Bones = Readonly<Record<DrivenJointName, BoneLike>>;

/** Where the paw starts: read when the driver is built and again just before it reports ready. */
export interface InitialPose {
  readonly curled: readonly Digit[];
  readonly pose: 'upright' | 'rested';
}

/**
 * Looks the 15 driven joints up by name (the GLB nodes are named exactly like the joints in runtime-controls.json).
 * Returns null if any is missing, so a wrong asset fails loudly instead of posing half a paw.
 */
export function collectBones(scene: { getObjectByName(name: string): BoneLike | null | undefined }): Bones | null {
  const found: Partial<Record<DrivenJointName, BoneLike>> = {};
  for (const name of DRIVEN_JOINTS) {
    const bone = scene.getObjectByName(name);
    if (bone === null || bone === undefined) return null;
    found[name] = bone;
  }
  return found as Bones;
}

export interface JointDriverOptions {
  readonly bones: Bones;
  readonly root: RootLike;
  readonly bridge: SceneBridgePort;
  /** The scene's counted `invalidate`. Called only while something moves. */
  readonly invalidate: () => void;
  /** The starting pose. The scene reads it until it is ready, never afterwards. */
  readonly getInitial: () => InitialPose;
  /** Called once, after the driver's subscription became ready. */
  readonly onReady: () => void;
  /** True once the scene failed or the context was lost: the driver must not become ready again. */
  readonly isLost?: () => boolean;
  readonly specs?: Readonly<Record<JointName, JointSpec>>;
  readonly now?: () => number;
  readonly mixer?: MixerLike | null;
  readonly microtask?: (fn: () => void) => void;
}

export interface JointDriver {
  /** Call once per rendered frame (r3f `useFrame`). Does nothing while no command is active. */
  frame(): void;
  /** The command being played, or null. */
  readonly active: AnimCommand | null;
  /** Unsubscribes (which ends this driver's readiness and tells the session), and drops the active command without `done`. */
  dispose(): void;
}

interface Running {
  readonly command: AnimCommand;
  readonly startedAt: number;
  /** Amounts before the command started; only the command's own digit differs from these. */
  readonly base: Amounts;
}

export function createJointDriver(options: JointDriverOptions): JointDriver {
  const { bones, root, bridge, invalidate, getInitial, onReady } = options;
  const specs = options.specs ?? PAW_CONTROLS;
  const now = options.now ?? (() => performance.now());
  const microtask = options.microtask ?? ((fn: () => void) => queueMicrotask(fn));
  const isLost = options.isLost ?? (() => false);

  let disposed = false;
  let sawFirstFrame = false;
  let running: Running | null = null;
  /** The last settled state. Commands start from it. */
  let amounts: Amounts = [0, 0, 0, 0, 0];
  let rest: RestTransform = { sink: 0, tilt: 0 };

  /** Every joint of every digit, rebuilt from bind (`poseJoint`), never from the previous quaternion. */
  function write(nextAmounts: Amounts, nextRest: RestTransform): void {
    DIGIT_JOINTS.forEach((joints, digit) => {
      for (const name of joints) {
        const q = poseJoint(specs[name], nextAmounts[digit] ?? 0);
        bones[name].quaternion.set(q[0], q[1], q[2], q[3]);
      }
    });
    root.position.y = 0 - nextRest.sink;
    root.rotation.x = nextRest.tilt * DEG_TO_RAD;
  }

  function settle(nextAmounts: Amounts, nextRest: RestTransform): void {
    amounts = nextAmounts;
    rest = nextRest;
    write(amounts, rest);
  }

  function applyInitial(): InitialPose {
    const initial = getInitial();
    const s = snapSample(amountsFor(initial.curled), initial.pose);
    settle(s.amounts, s.rest);
    return initial;
  }

  function sameInitial(a: InitialPose, b: InitialPose): boolean {
    return a.pose === b.pose && amountsFor(a.curled).join() === amountsFor(b.curled).join();
  }

  function guard(): void {
    releaseJoints(options.mixer, DRIVEN_JOINTS);
  }

  function start(command: AnimCommand): void {
    guard();
    // Only one command is active at a time (the machine's queue). A second `play` would be a contract breach: keep
    // the paw consistent by landing the first command's end values, without a `done`.
    if (running !== null) {
      const s = sample(running.command, Number.POSITIVE_INFINITY, running.base);
      amounts = s.amounts;
      if (running.command.kind === 'rest') rest = s.rest;
    }
    running = { command, startedAt: now(), base: amounts };
    invalidate();
  }

  function snap(effect: Extract<SceneEffect, { type: 'snap' }>): void {
    guard();
    running = null; // cancelled, no `done`: the reducer already cleared `anim.active`
    const s = snapSample(effect.amounts, effect.pose);
    settle(s.amounts, s.rest);
    invalidate(); // one frame draws it
  }

  const subscription = bridge.subscribe((effect) => {
    if (disposed) return;
    if (effect.type === 'play') start(effect.command);
    else snap(effect);
  });

  function reportReady(applied: InitialPose): void {
    microtask(() => {
      if (disposed || isLost()) return;
      // Effects sent before this point were dropped, so take the pose the session holds now.
      const latest = getInitial();
      if (!sameInitial(applied, latest)) {
        applyInitial();
        invalidate();
      }
      subscription.setReady(true); // this driver's own readiness, never the bridge-wide switch
      onReady();
    });
  }

  // Take direct control: stop competing actions, pose every joint from bind and ask for the first frame.
  guard();
  const applied = applyInitial();
  invalidate();

  return {
    get active() {
      return running?.command ?? null;
    },
    frame() {
      if (disposed) return;
      if (!sawFirstFrame) {
        sawFirstFrame = true;
        // Subscribers run before the render in the same tick, so a microtask runs after this frame was drawn.
        reportReady(applied);
      }
      if (running === null) return;

      const elapsed = now() - running.startedAt;
      const s = sample(running.command, elapsed, running.base);
      const nextRest = running.command.kind === 'rest' ? s.rest : rest;
      write(s.amounts, nextRest);
      if (!s.done) {
        invalidate();
        return;
      }
      const finished = running.command;
      amounts = s.amounts;
      rest = nextRest;
      running = null; // before `done`: a command the session starts in reply must not be cleared
      bridge.done(finished);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      running = null;
      subscription(); // leaving the bridge also ends this driver's readiness and tells the session
    },
  };
}
