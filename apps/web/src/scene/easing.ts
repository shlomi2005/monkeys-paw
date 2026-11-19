import { clamp01 } from './joint-pose';

/** Fast attack, quiet settle: 1 - (1 - u)^3. `u` is clamped to [0, 1] first (NaN counts as 0). */
export function cubicOut(u: number): number {
  const inv = 1 - clamp01(u);
  return 1 - inv * inv * inv;
}

/** Smooth start and end: u^2 (3 - 2u). `u` is clamped to [0, 1] first (NaN counts as 0). */
export function smoothstep(u: number): number {
  const c = clamp01(u);
  return c * c * (3 - 2 * c);
}
