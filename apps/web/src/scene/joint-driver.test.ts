import { Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createSceneBridge } from '../state/scene-bridge';
import type { SceneBridgeHost, SceneEffect } from '../state/scene-bridge';
import type { AnimCommand, Digit } from '../state/paw-machine-types';
import { CURL_MS, OPEN_MS, REST_MS } from './anim-sampler';
import { DIGIT_JOINTS, DRIVEN_JOINTS } from './digit-joints';
import type { DrivenJointName } from './digit-joints';
import { collectBones, createJointDriver } from './joint-driver';
import type { InitialPose, JointDriver } from './joint-driver';
import { poseJoint } from './joint-pose';
import { PAW_CONTROLS } from './paw-controls';
import { REST_SINK, REST_TILT_DEG } from './rest-pose';

const DEG = Math.PI / 180;

type Snapshot = Record<string, readonly number[]>;

interface Rig {
  readonly scene: Object3D;
  readonly root: Object3D;
  readonly wrist: Object3D;
  readonly bridge: SceneBridgeHost;
  readonly driver: JointDriver;
  readonly invalidate: ReturnType<typeof vi.fn>;
  readonly onReady: ReturnType<typeof vi.fn>;
  readonly done: AnimCommand[];
  readonly setTime: (ms: number) => void;
  readonly send: (effect: SceneEffect) => void;
  readonly quats: () => Snapshot;
  initial: InitialPose;
  lost: boolean;
}

/** A fake GLB skeleton: plain three Object3Ds named like the joints, each at its bind rotation. No WebGL. */
function buildRig(initial: InitialPose = { curled: [], pose: 'upright' }): Rig {
  const scene = new Object3D();
  const wrist = new Object3D();
  wrist.name = 'wrist';
  scene.add(wrist);
  for (const name of DRIVEN_JOINTS) {
    const bone = new Object3D();
    bone.name = name;
    bone.quaternion.set(...PAW_CONTROLS[name].bind);
    wrist.add(bone);
  }
  const root = new Object3D();
  const bridge = createSceneBridge();
  const done: AnimCommand[] = [];
  const doneSpy = vi.spyOn(bridge, 'done').mockImplementation((command) => {
    done.push(command);
  });
  void doneSpy;
  const invalidate = vi.fn();
  const onReady = vi.fn();
  let time = 0;

  const rig: Rig = {
    scene,
    root,
    wrist,
    bridge,
    invalidate,
    onReady,
    done,
    initial,
    lost: false,
    setTime: (ms) => {
      time = ms;
    },
    send: (effect) => {
      expect(bridge.send(effect)).toBe(true);
    },
    quats: () => {
      const out: Snapshot = {};
      for (const name of DRIVEN_JOINTS) out[name] = scene.getObjectByName(name)!.quaternion.toArray();
      return out;
    },
    driver: undefined as unknown as JointDriver,
  };
  const bones = collectBones(scene);
  if (bones === null) throw new Error('rig is missing bones');
  (rig as { driver: JointDriver }).driver = createJointDriver({
    bones,
    root,
    bridge,
    invalidate,
    getInitial: () => rig.initial,
    onReady,
    isLost: () => rig.lost,
    now: () => time,
  });
  return rig;
}

/** First frame, then the microtask that reports ready. */
async function readyRig(initial?: InitialPose): Promise<Rig> {
  const rig = buildRig(initial);
  rig.driver.frame();
  await Promise.resolve();
  expect(rig.bridge.isReady()).toBe(true);
  rig.invalidate.mockClear();
  return rig;
}

const bindOf = (name: DrivenJointName): readonly number[] => [...PAW_CONTROLS[name].bind];
const expectedQuat = (name: DrivenJointName, amount: number): readonly number[] => [...poseJoint(PAW_CONTROLS[name], amount)];

function digitOf(name: string): number {
  return DIGIT_JOINTS.findIndex((joints) => (joints as readonly string[]).includes(name));
}

const curl = (id: number, digit: Digit): AnimCommand => ({ id, kind: 'curl', digit });
const open = (id: number, digit: Digit): AnimCommand => ({ id, kind: 'open', digit });
const rest: AnimCommand = { id: 9, kind: 'rest' };

describe('collectBones', () => {
  it('finds the 15 driven joints by name and never the wrist', () => {
    const rig = buildRig();
    const bones = collectBones(rig.scene)!;
    expect(Object.keys(bones).sort()).toEqual([...DRIVEN_JOINTS].sort());
    expect(Object.keys(bones)).not.toContain('wrist');
  });

  it('returns null when a joint is missing', () => {
    const rig = buildRig();
    rig.scene.getObjectByName('ring_pip')!.name = 'something_else';
    expect(collectBones(rig.scene)).toBeNull();
  });
});

describe('posing from bind', () => {
  it('sets every digit joint to exactly its bind rotation at amount 0, on creation and at the start of a curl', async () => {
    const rig = await readyRig();
    const expected = Object.fromEntries(DRIVEN_JOINTS.map((n) => [n, bindOf(n)]));
    expect(rig.quats()).toEqual(expected);
    rig.setTime(0);
    rig.send({ type: 'play', command: curl(1, 3) });
    rig.driver.frame();
    expect(rig.quats()).toEqual(expected);
  });

  it('never writes the wrist or the GLB root: only the 15 joints and the root group change', async () => {
    const rig = await readyRig();
    const wristBefore = rig.wrist.quaternion.toArray();
    rig.send({ type: 'play', command: curl(1, 1) });
    rig.setTime(250);
    rig.driver.frame();
    expect(rig.wrist.quaternion.toArray()).toEqual(wristBefore);
    expect(rig.scene.position.toArray()).toEqual([0, 0, 0]);
  });

  it('does not accumulate: the same elapsed time gives the same quaternions whatever came before', async () => {
    const a = await readyRig();
    a.send({ type: 'play', command: curl(1, 2) });
    for (const t of [40, 100, 160, 300]) {
      a.setTime(t);
      a.driver.frame();
    }

    const b = await readyRig();
    b.send({ type: 'play', command: curl(1, 2) });
    for (const t of [450, 20, 480, 7, 300]) {
      b.setTime(t);
      b.driver.frame();
    }
    expect(b.quats()).toEqual(a.quats());
    // And it matches the formula from bind, not a product of earlier frames.
    const amount = 1 - (1 - 300 / CURL_MS) ** 3;
    for (const name of DIGIT_JOINTS[2]) expect(a.quats()[name]).toEqual(expectedQuat(name, amount));
  });

  it.each([0, 1, 2, 3, 4] as const)('moves only the joints of digit %i during its curl', async (digit) => {
    const rig = await readyRig();
    const before = rig.quats();
    rig.send({ type: 'play', command: curl(1, digit) });
    for (const t of [60, 200, 499]) {
      rig.setTime(t);
      rig.driver.frame();
      const now = rig.quats();
      for (const name of DRIVEN_JOINTS) {
        if (digitOf(name) !== digit) expect(now[name]).toEqual(before[name]);
      }
      expect(DIGIT_JOINTS[digit].some((name) => now[name]!.some((v, i) => v !== before[name]![i]))).toBe(true);
    }
  });
});

describe('a command from start to done', () => {
  it('curl: sets the final values, calls done once with the command, and stops invalidating', async () => {
    const rig = await readyRig();
    const command = curl(7, 0);
    rig.setTime(1000);
    rig.send({ type: 'play', command });
    expect(rig.invalidate).toHaveBeenCalledTimes(1); // the first frame is requested

    rig.setTime(1000 + CURL_MS - 1);
    rig.driver.frame();
    expect(rig.invalidate).toHaveBeenCalledTimes(2);
    expect(rig.done).toEqual([]);
    expect(rig.driver.active).toEqual(command);

    rig.setTime(1000 + CURL_MS);
    rig.driver.frame();
    for (const name of DIGIT_JOINTS[0]) expect(rig.quats()[name]).toEqual(expectedQuat(name, 1));
    expect(rig.done).toEqual([command]);
    expect(rig.driver.active).toBeNull();
    expect(rig.invalidate).toHaveBeenCalledTimes(2); // none at done

    rig.setTime(5000);
    rig.driver.frame();
    rig.driver.frame();
    expect(rig.done).toHaveLength(1);
    expect(rig.invalidate).toHaveBeenCalledTimes(2); // none after done
  });

  it('open: starts from the curled digit and ends at exactly bind', async () => {
    const rig = await readyRig({ curled: [3], pose: 'upright' });
    for (const name of DIGIT_JOINTS[3]) expect(rig.quats()[name]).toEqual(expectedQuat(name, 1));
    rig.setTime(0);
    rig.send({ type: 'play', command: open(2, 3) });
    rig.driver.frame();
    for (const name of DIGIT_JOINTS[3]) expect(rig.quats()[name]).toEqual(expectedQuat(name, 1));
    rig.setTime(OPEN_MS + 500);
    rig.driver.frame();
    for (const name of DIGIT_JOINTS[3]) expect(rig.quats()[name]).toEqual(bindOf(name));
    expect(rig.done).toHaveLength(1);
  });

  it('keeps earlier digits curled while another one moves', async () => {
    const rig = await readyRig();
    rig.setTime(0);
    rig.send({ type: 'play', command: curl(1, 0) });
    rig.setTime(CURL_MS);
    rig.driver.frame();
    rig.send({ type: 'play', command: curl(2, 1) });
    rig.setTime(CURL_MS + 100);
    rig.driver.frame();
    for (const name of DIGIT_JOINTS[0]) expect(rig.quats()[name]).toEqual(expectedQuat(name, 1));
    for (const name of DIGIT_JOINTS[2]) expect(rig.quats()[name]).toEqual(bindOf(name));
  });

  it('rest: sinks and tilts the root group only, digits stay as they were, then done', async () => {
    const rig = await readyRig();
    const before = rig.quats();
    rig.setTime(0);
    rig.send({ type: 'play', command: rest });
    rig.setTime(REST_MS / 2);
    rig.driver.frame();
    expect(rig.root.position.y).toBeCloseTo(-REST_SINK / 2, 12);
    expect(rig.root.rotation.x).toBeCloseTo((REST_TILT_DEG / 2) * DEG, 12);
    expect(rig.quats()).toEqual(before);
    expect(rig.done).toEqual([]);
    rig.setTime(REST_MS);
    rig.driver.frame();
    expect(rig.root.position.y).toBeCloseTo(-REST_SINK, 12);
    expect(rig.root.rotation.x).toBeCloseTo(REST_TILT_DEG * DEG, 12);
    expect(rig.done).toEqual([rest]);
  });

  it('measures elapsed time from the clock, so a command that should have ended completes on the next frame', async () => {
    const rig = await readyRig();
    rig.setTime(10);
    rig.send({ type: 'play', command: curl(1, 4) });
    rig.setTime(10 + 60_000); // a hidden tab: no frames for a minute
    rig.driver.frame();
    expect(rig.done).toHaveLength(1);
    for (const name of DIGIT_JOINTS[4]) expect(rig.quats()[name]).toEqual(expectedQuat(name, 1));
  });

  it('lets the session start the next command from inside done', async () => {
    const rig = await readyRig();
    const next = open(2, 0);
    const spy = vi.spyOn(rig.bridge, 'done').mockImplementation((command) => {
      rig.done.push(command);
      if (command.id === 1) rig.send({ type: 'play', command: next });
    });
    void spy;
    rig.setTime(0);
    rig.send({ type: 'play', command: curl(1, 0) });
    rig.setTime(CURL_MS);
    rig.driver.frame();
    expect(rig.driver.active).toEqual(next);
    rig.setTime(CURL_MS + OPEN_MS);
    rig.driver.frame();
    expect(rig.done.map((c) => c.id)).toEqual([1, 2]);
  });
});

describe('snap', () => {
  it('applies the amounts in one step, with one invalidate', async () => {
    const rig = await readyRig();
    rig.send({ type: 'snap', amounts: [1, 0, 1, 0, 0], pose: 'upright' });
    expect(rig.invalidate).toHaveBeenCalledTimes(1);
    for (const name of DRIVEN_JOINTS) {
      const amount = [1, 0, 1, 0, 0][digitOf(name)]!;
      expect(rig.quats()[name]).toEqual(expectedQuat(name, amount));
    }
    expect(rig.root.position.y).toBe(0);
    expect(rig.root.rotation.x).toBe(0);
  });

  it('rested pose: full sink and tilt on the root group', async () => {
    const rig = await readyRig();
    rig.send({ type: 'snap', amounts: [0, 0, 0, 0, 0], pose: 'rested' });
    expect(rig.root.position.y).toBeCloseTo(-REST_SINK, 12);
    expect(rig.root.rotation.x).toBeCloseTo(REST_TILT_DEG * DEG, 12);
  });

  it('cancels a playing command without done, and a late frame afterwards does nothing', async () => {
    const rig = await readyRig();
    rig.setTime(0);
    rig.send({ type: 'play', command: curl(1, 2) });
    rig.setTime(200);
    rig.driver.frame();
    rig.invalidate.mockClear();

    rig.send({ type: 'snap', amounts: [0, 0, 0, 0, 0], pose: 'upright' });
    expect(rig.driver.active).toBeNull();
    const after = rig.quats();
    expect(after).toEqual(Object.fromEntries(DRIVEN_JOINTS.map((n) => [n, bindOf(n)])));
    expect(rig.invalidate).toHaveBeenCalledTimes(1);

    rig.setTime(900); // past the end of the cancelled curl
    rig.driver.frame();
    rig.driver.frame();
    expect(rig.quats()).toEqual(after);
    expect(rig.done).toEqual([]);
    expect(rig.invalidate).toHaveBeenCalledTimes(1);
  });

  it('a command after a snap starts from the snapped amounts', async () => {
    const rig = await readyRig();
    rig.send({ type: 'snap', amounts: [0, 1, 0, 0, 0], pose: 'upright' });
    rig.setTime(0);
    rig.send({ type: 'play', command: curl(3, 4) });
    rig.setTime(CURL_MS);
    rig.driver.frame();
    for (const name of DIGIT_JOINTS[1]) expect(rig.quats()[name]).toEqual(expectedQuat(name, 1));
    for (const name of DIGIT_JOINTS[4]) expect(rig.quats()[name]).toEqual(expectedQuat(name, 1));
  });
});

describe('the starting pose', () => {
  it('poses the curled digits at once on creation (a Grant may arrive before the chunk)', () => {
    const rig = buildRig({ curled: [0, 2], pose: 'upright' });
    for (const name of DRIVEN_JOINTS) {
      const amount = [0, 2].includes(digitOf(name)) ? 1 : 0;
      expect(rig.quats()[name]).toEqual(expectedQuat(name, amount));
    }
    expect(rig.root.position.y).toBe(0);
    expect(rig.root.rotation.x).toBe(0);
  });

  it('poses the rested pose when the round already ended in a rest', () => {
    const rig = buildRig({ curled: [], pose: 'rested' });
    for (const name of DRIVEN_JOINTS) expect(rig.quats()[name]).toEqual(bindOf(name));
    expect(rig.root.position.y).toBeCloseTo(-REST_SINK, 12);
    expect(rig.root.rotation.x).toBeCloseTo(REST_TILT_DEG * DEG, 12);
  });

  it('asks for a frame on creation, so the pose is drawn', () => {
    expect(buildRig().invalidate).toHaveBeenCalledTimes(1);
  });

  it('takes the pose the session holds just before it reports ready, and not afterwards', async () => {
    const rig = buildRig({ curled: [], pose: 'upright' });
    rig.initial = { curled: [1], pose: 'upright' }; // a grant arrived while the model was loading
    rig.driver.frame();
    await Promise.resolve();
    for (const name of DIGIT_JOINTS[1]) expect(rig.quats()[name]).toEqual(expectedQuat(name, 1));
    expect(rig.invalidate).toHaveBeenCalledTimes(2);

    rig.initial = { curled: [1, 2, 3], pose: 'rested' }; // after ready this changes nothing
    rig.driver.frame();
    expect(rig.quats()[DIGIT_JOINTS[2][0]]).toEqual(bindOf(DIGIT_JOINTS[2][0]));
  });
});

describe('bridge readiness', () => {
  it('is not ready before the first frame, and ready after it', async () => {
    const rig = buildRig();
    expect(rig.bridge.isReady()).toBe(false);
    expect(rig.bridge.send({ type: 'snap', amounts: [0, 0, 0, 0, 0], pose: 'upright' })).toBe(false);
    rig.driver.frame();
    expect(rig.bridge.isReady()).toBe(false); // the frame is being rendered
    expect(rig.onReady).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(rig.bridge.isReady()).toBe(true);
    expect(rig.onReady).toHaveBeenCalledTimes(1);
    rig.driver.frame();
    await Promise.resolve();
    expect(rig.onReady).toHaveBeenCalledTimes(1);
  });

  it('is not ready again after dispose, and a pending ready report is dropped', async () => {
    const early = buildRig();
    early.driver.frame();
    early.driver.dispose();
    await Promise.resolve();
    expect(early.bridge.isReady()).toBe(false);
    expect(early.onReady).not.toHaveBeenCalled();

    const rig = await readyRig();
    rig.driver.dispose();
    expect(rig.bridge.isReady()).toBe(false);
    rig.driver.frame();
    await Promise.resolve();
    expect(rig.bridge.isReady()).toBe(false);
  });

  it('is not ready after a failure or a lost context, even when the first frame was already drawn', async () => {
    const rig = buildRig();
    rig.driver.frame();
    rig.lost = true;
    await Promise.resolve();
    expect(rig.bridge.isReady()).toBe(false);
    expect(rig.onReady).not.toHaveBeenCalled();
  });

  it('stops listening on dispose: later effects reach nobody and the active command is dropped', async () => {
    const rig = await readyRig();
    rig.send({ type: 'play', command: curl(1, 0) });
    rig.driver.dispose();
    expect(rig.bridge.send({ type: 'play', command: curl(2, 1) })).toBe(false);
    rig.setTime(10_000);
    rig.driver.frame();
    expect(rig.done).toEqual([]);
  });

  it('a session sees the detach when a ready scene goes away', async () => {
    const rig = await readyRig();
    const detached = vi.fn();
    rig.bridge.onDetach(detached);
    rig.driver.dispose();
    expect(detached).toHaveBeenCalledTimes(1);
  });
});

describe('competing animation', () => {
  it('calls the release guard on creation and before each command', () => {
    const stop = vi.fn();
    const mixer = {
      _actions: [{ getClip: () => ({ tracks: [{ name: 'index_pip.quaternion' }] }), stop }],
    };
    const scene = new Object3D();
    for (const name of DRIVEN_JOINTS) {
      const bone = new Object3D();
      bone.name = name;
      scene.add(bone);
    }
    const bridge = createSceneBridge();
    const driver = createJointDriver({
      bones: collectBones(scene)!,
      root: new Object3D(),
      bridge,
      invalidate: () => undefined,
      getInitial: () => ({ curled: [], pose: 'upright' }),
      onReady: () => undefined,
      mixer,
      now: () => 0,
    });
    expect(stop).toHaveBeenCalledTimes(1);
    driver.frame();
    return Promise.resolve().then(() => {
      bridge.send({ type: 'play', command: curl(1, 1) });
      expect(stop).toHaveBeenCalledTimes(2);
    });
  });
});
