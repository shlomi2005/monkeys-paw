import { useMemo } from 'react';
import { Color, Mesh } from 'three';
import type { Material, MeshStandardMaterial, Object3D } from 'three';

/** Sepia multiplier for the base colour (design.md, "Material seam"). */
export const PAW_SEPIA_TINT = '#c9a97a';

interface PawMaterialData {
  /** Set on the tinted copy, so a second pass never tints it again. */
  pawPlaceholder?: true;
}

/** One tinted material per loaded scene. The GLB's own (shared, cached) material is never changed. */
const tintedByScene = new WeakMap<Object3D, Material | null>();

function firstMaterial(scene: Object3D): Material | null {
  let found: Material | null = null;
  scene.traverse((object) => {
    if (found !== null || !(object as Mesh).isMesh) return;
    const material = (object as Mesh).material;
    found = Array.isArray(material) ? (material[0] ?? null) : material;
  });
  return found;
}

function isStandard(material: Material): material is MeshStandardMaterial {
  return (material as MeshStandardMaterial).isMeshStandardMaterial === true;
}

/**
 * The placeholder look: a copy of the GLB's material that keeps its maps (base colour, normal, metallic-roughness)
 * and multiplies the base colour by the sepia tint. The red cord is painted in the same base-colour texture, so it
 * stays red, only darker. Returns null when the scene has no standard material; the model then keeps its own.
 *
 * Pure and idempotent: the same scene always gives the same instance, tinted once.
 */
export function createPawMaterial(scene: Object3D): Material | null {
  const cached = tintedByScene.get(scene);
  if (cached !== undefined) return cached;

  const source = firstMaterial(scene);
  let result: Material | null = null;
  if (source !== null && isStandard(source)) {
    const data = source.userData as PawMaterialData;
    if (data.pawPlaceholder === true) {
      result = source; // already the tinted copy: never tint twice
    } else {
      const copy = source.clone();
      copy.color.multiply(new Color(PAW_SEPIA_TINT));
      (copy.userData as PawMaterialData).pawPlaceholder = true;
      result = copy;
    }
  }
  tintedByScene.set(scene, result);
  return result;
}

/**
 * The single material seam. The ink cross-hatching shader (task 41) replaces the body of this hook and nothing
 * else; the cord's own look is left to that spec, which can mask it by texture.
 */
export function usePawMaterial(scene: Object3D): Material | null {
  return useMemo(() => createPawMaterial(scene), [scene]);
}
