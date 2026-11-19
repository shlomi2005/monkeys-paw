import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAMERA_FOV_DEG, CAMERA_TARGET, FRAME_HEIGHT_UNITS, fitDistance, pawCamera } from './camera-fit';
import type { Vec3 } from './camera-fit';
import { REST_SINK, REST_TILT_DEG } from './rest-pose';

interface Box {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** Test-only: reads the POSITION accessor min/max from the GLB header and JSON chunk (nothing else is parsed). */
function readGlbBox(fileName: string): Box {
  const path = fileURLToPath(new URL(`../../../../docs/art/paw/${fileName}`, import.meta.url));
  const buf = readFileSync(path);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const jsonLength = buf.readUInt32LE(12);
  expect(buf.readUInt32LE(16)).toBe(0x4e4f534a); // 'JSON'
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8')) as {
    meshes: { primitives: { attributes: { POSITION: number } }[] }[];
    accessors: { min?: number[]; max?: number[] }[];
  };
  const min: number[] = [Infinity, Infinity, Infinity];
  const max: number[] = [-Infinity, -Infinity, -Infinity];
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const acc = json.accessors[prim.attributes.POSITION];
      if (!acc?.min || !acc.max) throw new Error('POSITION accessor has no min/max');
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i] ?? Infinity, acc.min[i] ?? Infinity);
        max[i] = Math.max(max[i] ?? -Infinity, acc.max[i] ?? -Infinity);
      }
    }
  }
  return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}

function corners({ min, max }: Box): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) out.push([x, y, z]);
  return out;
}

/** Whole-paw rest transform: tilt about X through the origin, then sink down along Y. */
function restTransformPoint([x, y, z]: Vec3, tiltDeg: number, sink: number): Vec3 {
  const t = (tiltDeg * Math.PI) / 180;
  return [x, y * Math.cos(t) - z * Math.sin(t) - sink, y * Math.sin(t) + z * Math.cos(t)];
}

/** Perspective projection to normalised view coordinates (±1 at the edge) for the camera on +Z looking at -Z. */
function project([x, y, z]: Vec3): { nx: number; ny: number } {
  const cam = pawCamera();
  const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
  const depth = cam.position[2] - z;
  expect(depth).toBeGreaterThan(0); // in front of the camera
  const aspect = 1;
  return { nx: (x - cam.position[0]) / (depth * tanHalf * aspect), ny: (y - cam.position[1]) / (depth * tanHalf) };
}

const MARGIN = 0.95;
const POSES: readonly { name: string; tiltDeg: number; sink: number }[] = [
  { name: 'upright', tiltDeg: 0, sink: 0 },
  { name: 'rest, tilt +', tiltDeg: REST_TILT_DEG, sink: REST_SINK },
  { name: 'rest, tilt -', tiltDeg: -REST_TILT_DEG, sink: REST_SINK },
];

describe('fitDistance', () => {
  it('matches (h / 2) / tan(fov / 2) with fov in degrees', () => {
    expect(fitDistance(1.3, 30)).toBeCloseTo(0.65 / Math.tan(Math.PI / 12), 12);
    expect(fitDistance(1.3, 30)).toBeCloseTo(2.4256, 3);
    expect(fitDistance(2, 90)).toBeCloseTo(1, 12);
    expect(fitDistance(2, 60)).toBeCloseTo(Math.sqrt(3), 12);
  });
});

describe('pawCamera', () => {
  it('sits on +Z and looks at (0, 0.5, 0)', () => {
    const cam = pawCamera();
    expect(cam.fov).toBe(CAMERA_FOV_DEG);
    expect(cam.target).toEqual([0, 0.5, 0]);
    expect(cam.target).toEqual(CAMERA_TARGET);
    expect(cam.position[0]).toBe(0);
    expect(cam.position[1]).toBe(0.5);
    expect(cam.position[2]).toBeGreaterThan(0);
    expect(cam.position[2]).toBeCloseTo(fitDistance(FRAME_HEIGHT_UNITS, CAMERA_FOV_DEG), 12);
  });
});

describe.each(['paw-web.glb', 'paw-mobile.glb'])('the real bounding box of %s fits the view at 1:1', (file) => {
  const box = readGlbBox(file);

  it('has the documented size (about x [-0.16, 0.33], y [0, 1], z [-0.11, 0.13])', () => {
    expect(box.min[0]).toBeCloseTo(-0.16, 1);
    expect(box.max[0]).toBeCloseTo(0.33, 1);
    expect(box.min[1]).toBeCloseTo(0, 1);
    expect(box.max[1]).toBeCloseTo(1, 1);
    expect(box.min[2]).toBeCloseTo(-0.11, 1);
    expect(box.max[2]).toBeCloseTo(0.13, 1);
  });

  it.each(POSES)('keeps every corner inside 95% of the view, $name', ({ tiltDeg, sink }) => {
    for (const c of corners(box)) {
      const { nx, ny } = project(restTransformPoint(c, tiltDeg, sink));
      expect(Math.abs(nx)).toBeLessThanOrEqual(MARGIN);
      expect(Math.abs(ny)).toBeLessThanOrEqual(MARGIN);
    }
  });

  it('reports the horizontal offset of the box centre from the view centre', () => {
    const centreX = (box.min[0] + box.max[0]) / 2;
    const cam = pawCamera();
    const offsetUnits = centreX - cam.target[0];
    const { nx } = project([centreX, 0.5, 0]);
    // The target stays at x = 0 on purpose. The paw is not centred on the wrist: its box centre sits about
    // 0.085 units to the right (+X), which is about 13% of the half-width of the view at the wrist plane.
    console.info(`${file}: box centre x offset ${offsetUnits.toFixed(4)} units, ${(nx * 100).toFixed(1)}% of half-width`);
    expect(Math.abs(nx)).toBeLessThan(0.2);
  });
});
