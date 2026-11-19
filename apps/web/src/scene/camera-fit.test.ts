import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAMERA_FOV_DEG, CAMERA_TARGET, FRAME_HEIGHT_UNITS, centredPawCamera, fitDistance, pawCamera } from './camera-fit';
import type { Bounds, PawCamera, Vec3 } from './camera-fit';
import { REST_SINK, REST_TILT_DEG } from './rest-pose';

type Box = Bounds;

/** The bind-pose bounds of both GLBs (docs/art/paw/PAW-ASSET.md). */
const REAL_BOUNDS: Bounds = { min: [-0.164, 0, -0.108], max: [0.335, 1, 0.129] };

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
function project([x, y, z]: Vec3, cam: PawCamera): { nx: number; ny: number } {
  const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
  const depth = cam.position[2] - z;
  expect(depth).toBeGreaterThan(0); // in front of the camera
  const aspect = 1;
  return { nx: (x - cam.position[0]) / (depth * tanHalf * aspect), ny: (y - cam.position[1]) / (depth * tanHalf) };
}

/** Upright keeps 95% of the half-view. At rest the sunk wrist is the lowest point and is allowed up to 98% (still inside). */
const POSES: readonly { name: string; tiltDeg: number; sink: number; margin: number }[] = [
  { name: 'upright', tiltDeg: 0, sink: 0, margin: 0.95 },
  { name: 'rest', tiltDeg: REST_TILT_DEG, sink: REST_SINK, margin: 0.98 },
];

describe('fitDistance', () => {
  it('matches (h / 2) / tan(fov / 2) with fov in degrees', () => {
    expect(fitDistance(1.3, 30)).toBeCloseTo(0.65 / Math.tan(Math.PI / 12), 12);
    expect(fitDistance(1.3, 30)).toBeCloseTo(2.4256, 3);
    expect(fitDistance(2, 90)).toBeCloseTo(1, 12);
    expect(fitDistance(2, 60)).toBeCloseTo(Math.sqrt(3), 12);
  });
});

describe('pawCamera (the camera before the model is known)', () => {
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

describe('centredPawCamera', () => {
  const centreX = (REAL_BOUNDS.min[0] + REAL_BOUNDS.max[0]) / 2;

  it('puts the target and the position at the box centre x (about 0.085) and keeps y, fov and distance', () => {
    const cam = centredPawCamera(REAL_BOUNDS);
    expect(centreX).toBeCloseTo(0.0855, 4);
    expect(cam.target).toEqual([centreX, 0.5, 0]);
    expect(cam.position[0]).toBe(centreX);
    expect(cam.position[1]).toBe(CAMERA_TARGET[1]);
    expect(cam.position[2]).toBe(pawCamera().position[2]);
    expect(cam.position[2]).toBeCloseTo(fitDistance(FRAME_HEIGHT_UNITS, CAMERA_FOV_DEG), 12);
    expect(cam.fov).toBe(CAMERA_FOV_DEG);
  });

  it('looks straight down -Z: the position and the target differ only in z', () => {
    const cam = centredPawCamera(REAL_BOUNDS);
    expect(cam.position[0]).toBe(cam.target[0]);
    expect(cam.position[1]).toBe(cam.target[1]);
  });

  it('puts the middle of the paw in the middle of the view', () => {
    const cam = centredPawCamera(REAL_BOUNDS);
    expect(Math.abs(project([centreX, 0.5, 0], cam).nx)).toBeLessThan(1e-12);
    // The old wrist-centred camera put it off by about 13% of the half-width at the wrist plane.
    expect(Math.abs(project([centreX, 0.5, 0], pawCamera()).nx)).toBeGreaterThan(0.1);
  });

  it.each(POSES)('keeps every corner of the real bounds inside the 1:1 view with a margin, $name', ({ tiltDeg, sink, margin }) => {
    const cam = centredPawCamera(REAL_BOUNDS);
    for (const c of corners(REAL_BOUNDS)) {
      const { nx, ny } = project(restTransformPoint(c, tiltDeg, sink), cam);
      expect(Math.abs(nx)).toBeLessThanOrEqual(margin);
      expect(Math.abs(ny)).toBeLessThanOrEqual(margin);
    }
  });

  it('leaves a margin on both sides in x that is the same left and right', () => {
    const cam = centredPawCamera(REAL_BOUNDS);
    const left = project([REAL_BOUNDS.min[0], 0.5, REAL_BOUNDS.max[2]], cam).nx;
    const right = project([REAL_BOUNDS.max[0], 0.5, REAL_BOUNDS.max[2]], cam).nx;
    expect(left).toBeCloseTo(-right, 12);
  });

  it('falls back to the default camera for bounds that are not finite', () => {
    expect(centredPawCamera({ min: [Infinity, 0, 0], max: [-Infinity, 1, 0] })).toEqual(pawCamera());
    expect(centredPawCamera({ min: [Number.NaN, 0, 0], max: [1, 1, 0] })).toEqual(pawCamera());
  });
});

describe.each(['paw-web.glb', 'paw-mobile.glb'])('the real bounding box of %s', (file) => {
  const box = readGlbBox(file);

  it('has the documented size (about x [-0.16, 0.33], y [0, 1], z [-0.11, 0.13])', () => {
    expect(box.min[0]).toBeCloseTo(-0.164, 2);
    expect(box.max[0]).toBeCloseTo(0.335, 2);
    expect(box.min[1]).toBeCloseTo(0, 1);
    expect(box.max[1]).toBeCloseTo(1, 1);
    expect(box.min[2]).toBeCloseTo(-0.108, 2);
    expect(box.max[2]).toBeCloseTo(0.129, 2);
  });

  it.each(POSES)('is centred and fits the view at 1:1 with a margin with the centred camera, $name', ({ tiltDeg, sink, margin }) => {
    const cam = centredPawCamera(box);
    expect(cam.position[0]).toBeCloseTo(0.085, 2);
    for (const c of corners(box)) {
      const { nx, ny } = project(restTransformPoint(c, tiltDeg, sink), cam);
      expect(Math.abs(nx)).toBeLessThanOrEqual(margin);
      expect(Math.abs(ny)).toBeLessThanOrEqual(margin);
    }
  });
});
