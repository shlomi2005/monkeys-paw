import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, ShaderLib, Texture, Vector2, Vector3 } from 'three';
import type { Material, Object3D, WebGLRenderer } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hexToLinear, INK_DEFAULTS, INK_PALETTE } from './ink-math';
import { createInkMaterial, createInkUniforms, INK_PROGRAM_KEY, selectPawMaterial } from './ink-material';
import { INK_UNIFORM_TYPES } from './ink-shader';
import type { InkShaderSource } from './ink-shader';
import { createPawMaterial } from './use-paw-material';

/** GLSL is not compiled here (no GL in Vitest). This file covers the material around the shader. */

/** A scene shaped like the GLB: one mesh, one material with three maps. */
function sceneWithPaw() {
  const maps = { map: new Texture(), normalMap: new Texture(), metalnessMap: new Texture() };
  const source = new MeshStandardMaterial({ color: new Color('#ffffff'), metalness: 1, roughness: 0.6, ...maps });
  source.roughnessMap = maps.metalnessMap;
  const mesh = new Mesh(new BoxGeometry(), source);
  const scene = new Group();
  scene.add(new Group());
  scene.add(mesh);
  return { scene, mesh, source, maps };
}

function ink(scene: Group): MeshStandardMaterial {
  return createInkMaterial(scene) as MeshStandardMaterial;
}

describe('createInkUniforms', () => {
  it('has exactly the uniforms of the shader, with the design types', () => {
    const uniforms = createInkUniforms();
    expect(Object.keys(uniforms).sort()).toEqual(Object.keys(INK_UNIFORM_TYPES).sort());
    for (const [name, type] of Object.entries(INK_UNIFORM_TYPES)) {
      const value = uniforms[name as keyof typeof INK_UNIFORM_TYPES].value as unknown;
      if (type === 'float') expect(typeof value).toBe('number');
      if (type === 'vec2') expect(value).toBeInstanceOf(Vector2);
      if (type === 'vec3') expect(value instanceof Color || value instanceof Vector3).toBe(true);
    }
  });

  it('holds the four palette colours as linear values', () => {
    const u = createInkUniforms();
    for (const [name, hex] of [
      ['uInk', INK_PALETTE.ink],
      ['uSepia', INK_PALETTE.sepia],
      ['uParchment', INK_PALETTE.parchment],
      ['uBlood', INK_PALETTE.blood],
    ] as const) {
      const color = u[name].value as Color;
      const [r, g, b] = hexToLinear(hex);
      expect([color.r, color.g, color.b]).toEqual([r, g, b]);
    }
  });

  it('starts from the design defaults', () => {
    const u = createInkUniforms();
    expect(u.uSpacing.value).toBe(3.5);
    expect(u.uPixelRatio.value).toBe(1);
    expect((u.uViewport.value as Vector2).toArray()).toEqual([1, 1]);
    expect((u.uThresholds.value as Vector3).toArray()).toEqual([0.15, 0.42, 0.7]);
    const cross = u.uCross.value as Vector2;
    expect(Math.atan2(cross.y, cross.x)).toBeCloseTo(INK_DEFAULTS.crossAngle, 9);
    expect(u.uFollow.value).toBeLessThanOrEqual(0.9);
  });
});

describe('createInkMaterial', () => {
  it('makes a white, tone-mapping-free copy with its own program key, keeping the maps', () => {
    const { scene, source, maps } = sceneWithPaw();
    const material = ink(scene);
    expect(material).not.toBe(source);
    expect(material.color.getHexString()).toBe('ffffff');
    expect(material.toneMapped).toBe(false);
    expect(material.customProgramCacheKey()).toBe(INK_PROGRAM_KEY);
    expect(material.customProgramCacheKey()).not.toBe(source.customProgramCacheKey());
    expect(material.map).toBe(maps.map);
    expect(material.normalMap).toBe(maps.normalMap);
    expect(material.metalnessMap).toBe(maps.metalnessMap);
    expect(material.roughnessMap).toBe(maps.metalnessMap);
    expect(material.metalness).toBe(1); // the patch overrides it in the shader
    expect(material.userData).toMatchObject({ pawInk: true });
  });

  it('leaves the GLB material unchanged', () => {
    const { scene, source } = sceneWithPaw();
    const before = source.onBeforeCompile;
    ink(scene);
    expect(source.color.getHexString()).toBe('ffffff');
    expect(source.toneMapped).toBe(true);
    expect(source.userData).toEqual({});
    expect(source.onBeforeCompile).toBe(before);
  });

  it('sets pixel ratio and viewport from the renderer, on the objects the compiled program holds', () => {
    const { scene } = sceneWithPaw();
    const material = ink(scene);
    // Run the real injection on three's physical source, as the renderer would.
    const shader: InkShaderSource = {
      vertexShader: ShaderLib.physical.vertexShader,
      fragmentShader: ShaderLib.physical.fragmentShader,
      uniforms: {},
    };
    (material.onBeforeCompile as (s: InkShaderSource) => void)(shader);
    const renderer = {
      getPixelRatio: () => 2,
      getDrawingBufferSize: (target: Vector2) => target.set(1600, 1200),
    } as unknown as WebGLRenderer;
    (material.onBeforeRender as (r: WebGLRenderer) => void)(renderer);
    expect(shader.uniforms.uPixelRatio?.value).toBe(2);
    expect((shader.uniforms.uViewport?.value as Vector2).toArray()).toEqual([1600, 1200]);
  });

  it('gives the same instance for the same scene', () => {
    const { scene } = sceneWithPaw();
    expect(createInkMaterial(scene)).toBe(createInkMaterial(scene));
  });

  it('does not copy again when the mesh already holds the ink copy', () => {
    const { scene, mesh } = sceneWithPaw();
    const first = ink(scene);
    mesh.material = first;
    expect(createInkMaterial(scene.clone())).toBe(first);
  });

  it('returns null when the scene has no mesh or no standard material', () => {
    expect(createInkMaterial(new Group())).toBeNull();
    const plain = new Group();
    plain.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    expect(createInkMaterial(plain)).toBeNull();
  });
});

describe('selectPawMaterial', () => {
  it("returns exactly the placeholder factory's result for 'placeholder'", () => {
    const { scene } = sceneWithPaw();
    expect(selectPawMaterial('placeholder', scene, createPawMaterial)).toBe(createPawMaterial(scene));
  });

  it("returns the ink material for 'ink' and never calls the placeholder", () => {
    const { scene } = sceneWithPaw();
    const placeholder = vi.fn<(s: Object3D) => Material | null>(() => null);
    const material = selectPawMaterial('ink', scene, placeholder);
    expect(material).toBe(createInkMaterial(scene));
    expect((material as MeshStandardMaterial).userData).toMatchObject({ pawInk: true });
    expect(placeholder).not.toHaveBeenCalled();
  });
});

describe('when three has changed an anchor', () => {
  afterEach(() => {
    vi.doUnmock('./ink-shader');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('warns once and returns the placeholder', async () => {
    vi.resetModules();
    vi.doMock('./ink-shader', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./ink-shader')>()),
      canInject: () => false,
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fresh = await import('./ink-material');
    const { scene } = sceneWithPaw();
    const placeholder = createPawMaterial(scene);
    const first = fresh.createInkMaterial(scene, createPawMaterial);
    const second = fresh.createInkMaterial(scene, createPawMaterial);
    expect(first).toBe(placeholder);
    expect(second).toBe(first);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
