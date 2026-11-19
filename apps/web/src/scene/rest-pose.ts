import { clamp01 } from './joint-pose';

/** Units, down along Y. Tuned in the browser in task 31. */
export const REST_SINK = 0.1;
/** Degrees, about X. Negative: the fingertips lean back, away from the camera, so the paw lies back onto the plate. */
export const REST_TILT_DEG = -30;

export interface RestTransform {
  readonly sink: number;
  readonly tilt: number;
}

/** Whole-paw sink (units, down along Y) and tilt (degrees, about X) at progress `p`, clamped to [0, 1]. */
export function restTransform(p: number): RestTransform {
  const c = clamp01(p);
  return { sink: REST_SINK * c, tilt: REST_TILT_DEG * c + 0 }; // + 0 turns -0 into 0 for a negative tilt at p = 0
}
