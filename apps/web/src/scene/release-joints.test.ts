import { describe, expect, it, vi } from 'vitest';
import { DRIVEN_JOINTS } from './digit-joints';
import { releaseJoints } from './release-joints';
import type { ActionLike } from './release-joints';

function action(trackNames: readonly string[]): ActionLike & { stop: ReturnType<typeof vi.fn> } {
  return { getClip: () => ({ tracks: trackNames.map((name) => ({ name })) }), stop: vi.fn() };
}

describe('releaseJoints', () => {
  it('stops only the actions whose clip tracks target the driven joints', () => {
    const fingers = action(['index_mcp.quaternion', 'index_pip.quaternion']);
    const thumb = action(['thumb_cmc.quaternion']);
    const mixed = action(['wrist.quaternion', 'little_dip.quaternion']);
    const wristOnly = action(['wrist.quaternion', 'wrist.position']);
    const other = action(['Camera.position', 'Light.intensity']);
    const empty = action([]);
    const stopped = releaseJoints({ _actions: [fingers, wristOnly, thumb, other, mixed, empty] }, DRIVEN_JOINTS);

    expect(stopped).toBe(3);
    expect(fingers.stop).toHaveBeenCalledTimes(1);
    expect(thumb.stop).toHaveBeenCalledTimes(1);
    expect(mixed.stop).toHaveBeenCalledTimes(1);
    expect(wristOnly.stop).not.toHaveBeenCalled();
    expect(other.stop).not.toHaveBeenCalled();
    expect(empty.stop).not.toHaveBeenCalled();
  });

  it('reads the node name out of the track name, with or without a path, and ignores near misses', () => {
    const withPath = action(['rig/Armature/ring_dip.quaternion']);
    const nearMiss = action(['ring_dip_extra.quaternion', 'xring_dip.quaternion']);
    expect(releaseJoints({ _actions: [withPath, nearMiss] }, DRIVEN_JOINTS)).toBe(1);
    expect(withPath.stop).toHaveBeenCalledTimes(1);
    expect(nearMiss.stop).not.toHaveBeenCalled();
  });

  it('only the names it is given count', () => {
    const a = action(['index_mcp.quaternion']);
    const b = action(['middle_mcp.quaternion']);
    expect(releaseJoints({ _actions: [a, b] }, ['middle_mcp'])).toBe(1);
    expect(a.stop).not.toHaveBeenCalled();
    expect(b.stop).toHaveBeenCalledTimes(1);
  });

  it('walks a copy of the mixer list: stopping an action may change the list', () => {
    const list: ActionLike[] = [];
    const make = (): ActionLike => ({
      getClip: () => ({ tracks: [{ name: 'thumb_ip.quaternion' }] }),
      stop: () => {
        list.splice(list.indexOf(self), 1);
      },
    });
    const self = make();
    const second = action(['thumb_mcp.quaternion']);
    list.push(self, second);
    expect(releaseJoints({ _actions: list }, DRIVEN_JOINTS)).toBe(2);
    expect(second.stop).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a mixer, which is the normal case (the app creates none)', () => {
    expect(releaseJoints(null, DRIVEN_JOINTS)).toBe(0);
    expect(releaseJoints(undefined, DRIVEN_JOINTS)).toBe(0);
    expect(releaseJoints({ _actions: [] }, DRIVEN_JOINTS)).toBe(0);
  });
});
