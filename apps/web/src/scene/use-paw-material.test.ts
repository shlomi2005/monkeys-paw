import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { createPawMaterial, PAW_SEPIA_TINT } from './use-paw-material';

/** A small scene shaped like the GLB: one mesh, one material with three maps, base colour white. */
function sceneWithPaw(baseColor = '#ffffff') {
  const maps = { map: new Texture(), normalMap: new Texture(), metalnessMap: new Texture() };
  const source = new MeshStandardMaterial({ color: new Color(baseColor), ...maps });
  source.roughnessMap = maps.metalnessMap; // glTF packs both in one texture
  const mesh = new Mesh(new BoxGeometry(), source);
  const scene = new Group();
  scene.add(new Group()); // empty scenes and nodes around it, like the GLB's six scenes
  scene.add(mesh);
  return { scene, mesh, source, maps };
}

describe('createPawMaterial', () => {
  it('tints a white base colour to exactly the sepia tint', () => {
    const { scene } = sceneWithPaw();
    const material = createPawMaterial(scene) as MeshStandardMaterial;
    expect(PAW_SEPIA_TINT).toBe('#c9a97a');
    expect(material.color.getHexString()).toBe('c9a97a');
  });

  it('multiplies a non-white base colour by the tint, channel by channel', () => {
    const { scene, source } = sceneWithPaw('#808080');
    const material = createPawMaterial(scene) as MeshStandardMaterial;
    const tint = new Color(PAW_SEPIA_TINT);
    expect(material.color.r).toBeCloseTo(source.color.r * tint.r, 6);
    expect(material.color.g).toBeCloseTo(source.color.g * tint.g, 6);
    expect(material.color.b).toBeCloseTo(source.color.b * tint.b, 6);
  });

  it('keeps the base colour, normal and metallic-roughness maps', () => {
    const { scene, maps } = sceneWithPaw();
    const material = createPawMaterial(scene) as MeshStandardMaterial;
    expect(material.map).toBe(maps.map);
    expect(material.normalMap).toBe(maps.normalMap);
    expect(material.metalnessMap).toBe(maps.metalnessMap);
    expect(material.roughnessMap).toBe(maps.metalnessMap);
  });

  it('leaves the GLB material untouched (it is shared and cached by useGLTF)', () => {
    const { scene, source } = sceneWithPaw();
    const material = createPawMaterial(scene);
    expect(material).not.toBe(source);
    expect(source.color.getHexString()).toBe('ffffff');
  });

  it('applies the tint once: a second call returns the same tinted instance', () => {
    const { scene } = sceneWithPaw();
    const first = createPawMaterial(scene) as MeshStandardMaterial;
    const second = createPawMaterial(scene) as MeshStandardMaterial;
    expect(second).toBe(first);
    expect(first.color.getHexString()).toBe('c9a97a');
  });

  it('does not tint again when the mesh already holds the tinted copy (a StrictMode re-run after applying it)', () => {
    const { scene, mesh } = sceneWithPaw();
    const tinted = createPawMaterial(scene) as MeshStandardMaterial;
    mesh.material = tinted;
    // A fresh lookup that has lost its cache entry, as when a second pass walks an already-processed scene.
    const again = createPawMaterial(scene.clone()) as MeshStandardMaterial;
    expect(again.color.getHexString()).toBe('c9a97a');
    expect(again).toBe(tinted);
  });

  it('returns null when the scene has no mesh or no standard material', () => {
    expect(createPawMaterial(new Group())).toBeNull();
    const plain = new Group();
    plain.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    expect(createPawMaterial(plain)).toBeNull();
  });

  it('finds the mesh inside nested nodes', () => {
    const outer = new Group();
    const inner = new Group();
    outer.add(inner);
    inner.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()));
    expect(createPawMaterial(outer)).not.toBeNull();
  });
});
