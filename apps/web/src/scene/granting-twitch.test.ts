import { Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DRIVEN_JOINTS } from './digit-joints';
import { createTwitch, TWITCH_MS, TWITCH_ROLL_DEG, twitchRoll } from './granting-twitch';

function setup(reduced = false) {
  const root = new Object3D();
  const bones = DRIVEN_JOINTS.map((name) => {
    const bone = new Object3D();
    bone.name = name;
    root.add(bone);
    return bone;
  });
  const invalidate = vi.fn();
  let time = 0;
  const twitch = createTwitch({ root, invalidate, isReducedMotion: () => reduced, now: () => time });
  return {
    root,
    bones,
    invalidate,
    twitch,
    at: (ms: number) => {
      time = ms;
    },
  };
}

describe('twitchRoll', () => {
  it('lasts 250 ms: zero at the start, zero from 250 ms on, and small in between', () => {
    expect(TWITCH_MS).toBe(250);
    expect(twitchRoll(0)).toBe(0);
    expect(twitchRoll(TWITCH_MS)).toBe(0);
    expect(twitchRoll(10_000)).toBe(0);
    expect(twitchRoll(-5)).toBe(0);
    expect(twitchRoll(Number.NaN)).toBe(0);
    for (let t = 0; t <= TWITCH_MS; t += 5) expect(Math.abs(twitchRoll(t))).toBeLessThanOrEqual(TWITCH_ROLL_DEG);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => Math.abs(twitchRoll(i * 5))))).toBeGreaterThan(1);
  });
});

describe('createTwitch', () => {
  it('touches only rotation.z of the root group, never a digit joint or the rest transform', () => {
    const { root, bones, twitch, at } = setup();
    const bonesBefore = bones.map((b) => b.quaternion.toArray());
    twitch.start();
    for (const t of [20, 50, 90, 140, 200, 249]) {
      at(t);
      twitch.frame();
      expect(root.rotation.x).toBe(0);
      expect(root.rotation.y).toBe(0);
      expect(root.position.toArray()).toEqual([0, 0, 0]);
      expect(root.scale.toArray()).toEqual([1, 1, 1]);
    }
    expect(bones.map((b) => b.quaternion.toArray())).toEqual(bonesBefore);
  });

  it('actually moves the root while it runs, and puts it back at 250 ms', () => {
    const { root, twitch, at } = setup();
    twitch.start();
    let moved = false;
    for (let t = 0; t < TWITCH_MS; t += 10) {
      at(t);
      twitch.frame();
      if (root.rotation.z !== 0) moved = true;
    }
    expect(moved).toBe(true);
    at(TWITCH_MS);
    twitch.frame();
    expect(root.rotation.z).toBe(0);
    expect(twitch.running).toBe(false);
  });

  it('requests frames only while it runs, none at the end or after', () => {
    const { invalidate, twitch, at } = setup();
    twitch.frame();
    expect(invalidate).not.toHaveBeenCalled(); // idle: nothing
    twitch.start();
    expect(invalidate).toHaveBeenCalledTimes(1);
    at(100);
    twitch.frame();
    expect(invalidate).toHaveBeenCalledTimes(2);
    at(TWITCH_MS);
    twitch.frame();
    twitch.frame();
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('never runs under reduced motion', () => {
    const { root, invalidate, twitch, at } = setup(true);
    twitch.start();
    at(100);
    twitch.frame();
    expect(twitch.running).toBe(false);
    expect(root.rotation.z).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('cancel puts the root back at once', () => {
    const { root, twitch, at } = setup();
    twitch.start();
    at(60);
    twitch.frame();
    expect(root.rotation.z).not.toBe(0);
    twitch.cancel();
    expect(root.rotation.z).toBe(0);
    expect(twitch.running).toBe(false);
  });
});
