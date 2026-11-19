/**
 * Pure maths and defaults for the paw's ink shader (paw-ink-shader design.md, "The maths").
 * This file is the TypeScript reference: ink-shader.ts builds its GLSL from the constants here, so the two
 * cannot drift. No imports, no DOM, no GL.
 */

/** Palette as sRGB hex. Converted to linear with `hexToLinear` before it reaches a uniform. */
export const INK_PALETTE = {
  ink: '#2b1d12',
  sepia: '#7a5a3a',
  parchment: '#e9d8b4',
  blood: '#8f1d14',
} as const;

/** Width of the smooth step at which each hatch family grows in. */
export const INK_FADE = 0.12;
/** Edges of the value gate in `cordMask` (fixed, not a uniform). */
export const INK_CORD_VALUE: readonly [number, number] = [0.08, 0.15];
/** Luma weights (Rec. 709), shared with the GLSL. */
export const INK_LUMA: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];
/** Gamma used for the sRGB-like albedo luma and the cord mask. */
export const INK_GAMMA = 2.2;

/** Starting values of every tunable uniform. Task 5 (the reviewer's browser check) tunes them. */
export const INK_DEFAULTS = {
  pixelRatio: 1,
  viewport: [1, 1] as readonly [number, number],
  spacing: 3.5,
  widthMin: 0.4,
  widthMax: 1.7,
  thresholds: [0.15, 0.42, 0.7] as readonly [number, number, number],
  /** Angle of families B and C to family A, in radians (55 degrees). */
  crossAngle: (55 * Math.PI) / 180,
  /** Fallback line angle in radians (25 degrees). */
  baseAngle: 0.44,
  /** 0 gives straight lines. Must stay at 0.9 or below. */
  follow: 0.85,
  normalBend: 0.25,
  lightLo: 0.4,
  lightHi: 1.45,
  lightWeight: 0.75,
  albedoWhite: 0.75,
  toneStrength: 0.85,
  contourPx: 1.4,
  /** Hue distance to red, as fractions of a turn: full at 10 degrees, zero at 13.5 degrees. */
  cordHue: [0.0278, 0.0375] as readonly [number, number],
  cordSat: [0.5, 0.65] as readonly [number, number],
};

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** GLSL `smoothstep`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** `#rrggbb` (sRGB) to linear RGB 0..1, the same transfer three's `Color.setHex` uses with colour management on. */
export function hexToLinear(hex: string): [number, number, number] {
  const value = parseInt(hex.replace('#', ''), 16);
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

/** Light luma `L` mapped through the window [lo, hi] to 0..1. */
export function lightness(luma: number, lo: number, hi: number): number {
  return clamp01((luma - lo) / (hi - lo));
}

/** sRGB-like luma of a linear albedo (not yet divided by `albedoWhite`). */
export function albedoLuma(r: number, g: number, b: number): number {
  const inv = 1 / INK_GAMMA;
  return (
    INK_LUMA[0] * Math.pow(Math.max(r, 0), inv) +
    INK_LUMA[1] * Math.pow(Math.max(g, 0), inv) +
    INK_LUMA[2] * Math.pow(Math.max(b, 0), inv)
  );
}

/** Ink darkness D in 0..1: dark nails get more lines than fur under the same light. */
export function darkness(lightnessValue: number, a01: number, lightWeight: number): number {
  return clamp01(lightWeight * (1 - lightnessValue) + (1 - lightWeight) * (1 - a01));
}

/** Weights of the three hatch families at darkness D: each grows in at its threshold over `INK_FADE`. */
export function familyWeights(
  d: number,
  thresholds: readonly [number, number, number] = INK_DEFAULTS.thresholds,
): [number, number, number] {
  return [
    smoothstep(thresholds[0], thresholds[0] + INK_FADE, d),
    smoothstep(thresholds[1], thresholds[1] + INK_FADE, d),
    smoothstep(thresholds[2], thresholds[2] + INK_FADE, d),
  ];
}

/** Line width in CSS px at darkness D. */
export function lineWidthPx(d: number, widthMin: number, widthMax: number): number {
  return widthMin + (widthMax - widthMin) * d;
}

/**
 * Cord mask for an sRGB colour (0..1 per channel): 1 on the red cord, 0 on fur, skin, dark brown patches and
 * parchment. Hue gate times saturation gate times value gate.
 */
export function cordMask(
  r: number,
  g: number,
  b: number,
  cordHue: readonly [number, number] = INK_DEFAULTS.cordHue,
  cordSat: readonly [number, number] = INK_DEFAULTS.cordSat,
): number {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 1e-5) {
    if (mx === r) h = (((g - b) / d) % 6 + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const sat = mx > 1e-5 ? d / mx : 0;
  const dh = Math.min(h, 1 - h);
  return (
    (1 - smoothstep(cordHue[0], cordHue[1], dh)) *
    smoothstep(cordSat[0], cordSat[1], sat) *
    smoothstep(INK_CORD_VALUE[0], INK_CORD_VALUE[1], mx)
  );
}
