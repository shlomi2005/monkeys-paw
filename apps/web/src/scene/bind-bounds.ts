import type { BufferGeometry, Object3D } from 'three';
import type { Bounds, Vec3 } from './camera-fit';

interface MeshLike {
  readonly isMesh?: boolean;
  readonly geometry?: BufferGeometry;
}

/**
 * The bind-pose box of a loaded scene: the union of its meshes' geometry bounding boxes. A geometry's box is the
 * bind pose by definition (the skin is applied later on the GPU), so this must not use `Box3.setFromObject`, which
 * would follow the bones. Measure once at load, before any pose is applied, and never refit while fingers move.
 * Returns null when the scene has no mesh with geometry.
 */
export function measureBindBounds(scene: Object3D): Bounds | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let found = false;
  scene.traverse((object) => {
    const mesh = object as MeshLike;
    if (mesh.isMesh !== true || mesh.geometry === undefined) return;
    const geometry = mesh.geometry;
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null || box.isEmpty()) return;
    found = true;
    min[0] = Math.min(min[0], box.min.x);
    min[1] = Math.min(min[1], box.min.y);
    min[2] = Math.min(min[2], box.min.z);
    max[0] = Math.max(max[0], box.max.x);
    max[1] = Math.max(max[1], box.max.y);
    max[2] = Math.max(max[2], box.max.z);
  });
  return found ? { min: min as unknown as Vec3, max: max as unknown as Vec3 } : null;
}
