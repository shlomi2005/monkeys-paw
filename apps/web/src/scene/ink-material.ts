import { Color, Mesh, Vector2, Vector3 } from 'three';
import type { IUniform, Material, MeshStandardMaterial, Object3D, WebGLRenderer } from 'three';
import { hexToLinear, INK_DEFAULTS, INK_PALETTE } from './ink-math';
import { canInject, injectInkShader } from './ink-shader';
import type { InkUniformName } from './ink-shader';

/** Bump the suffix whenever the GLSL in ink-shader.ts changes. */
export const INK_PROGRAM_KEY = 'paw-ink-v1';

type PlaceholderFactory = (scene: Object3D) => Material | null;

export type InkUniforms = Record<InkUniformName, IUniform>;

function linearColor(hex: string): Color {
  const [r, g, b] = hexToLinear(hex);
  return new Color().setRGB(r, g, b);
}

/** The uniform objects shared by the material's `onBeforeRender` and the compiled program. */
export function createInkUniforms(): InkUniforms {
  const d = INK_DEFAULTS;
  return {
    uInk: { value: linearColor(INK_PALETTE.ink) },
    uSepia: { value: linearColor(INK_PALETTE.sepia) },
    uParchment: { value: linearColor(INK_PALETTE.parchment) },
    uBlood: { value: linearColor(INK_PALETTE.blood) },
    uPixelRatio: { value: d.pixelRatio },
    uViewport: { value: new Vector2(d.viewport[0], d.viewport[1]) },
    uSpacing: { value: d.spacing },
    uWidthMin: { value: d.widthMin },
    uWidthMax: { value: d.widthMax },
    uThresholds: { value: new Vector3(d.thresholds[0], d.thresholds[1], d.thresholds[2]) },
    uCross: { value: new Vector2(Math.cos(d.crossAngle), Math.sin(d.crossAngle)) },
    uBaseAngle: { value: d.baseAngle },
    uFollow: { value: d.follow },
    uNormalBend: { value: d.normalBend },
    uLightLo: { value: d.lightLo },
    uLightHi: { value: d.lightHi },
    uLightWeight: { value: d.lightWeight },
    uAlbedoWhite: { value: d.albedoWhite },
    uToneStrength: { value: d.toneStrength },
    uContourPx: { value: d.contourPx },
    uCordHue: { value: new Vector2(d.cordHue[0], d.cordHue[1]) },
    uCordSat: { value: new Vector2(d.cordSat[0], d.cordSat[1]) },
  };
}

interface InkMaterialData {
  /** Set on the ink copy, so a second pass never copies it again. */
  pawInk?: true;
}

/** One ink material per loaded scene. The GLB's own (shared, cached) material is never changed. */
const inkByScene = new WeakMap<Object3D, Material | null>();

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
 * The ink look: a clone of the GLB's standard material (maps kept, base colour white, tone mapping off) whose shader
 * is patched by `injectInkShader`. Returns null when the scene has no standard material. When the patch cannot be
 * applied to this three version, warns once and returns `placeholder(scene)` (or null when none is given).
 *
 * Pure and idempotent: the same scene always gives the same instance.
 */
export function createInkMaterial(scene: Object3D, placeholder?: PlaceholderFactory): Material | null {
  const cached = inkByScene.get(scene);
  if (cached !== undefined) return cached;

  const source = firstMaterial(scene);
  let result: Material | null = null;
  if (source !== null && isStandard(source)) {
    if ((source.userData as InkMaterialData).pawInk === true) {
      result = source; // already the ink copy
    } else if (!canInject()) {
      console.warn('paw ink shader: three changed an anchor in its physical shader; using the placeholder material.');
      result = placeholder !== undefined ? placeholder(scene) : null;
    } else {
      const uniforms = createInkUniforms();
      const copy = source.clone();
      copy.color.set(0xffffff);
      (copy.userData as InkMaterialData).pawInk = true;
      copy.toneMapped = false;
      copy.customProgramCacheKey = () => INK_PROGRAM_KEY;
      copy.onBeforeCompile = (shader) => injectInkShader(shader, uniforms);
      copy.onBeforeRender = (renderer: WebGLRenderer) => {
        uniforms.uPixelRatio.value = renderer.getPixelRatio();
        renderer.getDrawingBufferSize(uniforms.uViewport.value as Vector2);
      };
      result = copy;
    }
  }
  inkByScene.set(scene, result);
  return result;
}

export type PawMaterialStyleName = 'ink' | 'placeholder';

/** Picks the paw's material. The placeholder factory is a parameter, which avoids an import cycle with the hook. */
export function selectPawMaterial(
  style: PawMaterialStyleName,
  scene: Object3D,
  placeholder: PlaceholderFactory,
): Material | null {
  return style === 'ink' ? createInkMaterial(scene, placeholder) : placeholder(scene);
}
