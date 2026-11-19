import { clamp01 } from './joint-pose';

/** Starting value in units, down along Y. Tune in task 31. */
export const REST_SINK = 0.04;
/** Starting value in degrees, about X. Tune in task 31. */
export const REST_TILT_DEG = 12;

export interface RestTransform {
  readonly sink: number;
  readonly tilt: number;
}

/** Whole-paw sink (units, down along Y) and tilt (degrees, about X) at progress `p`, clamped to [0, 1]. */
export function restTransform(p: number): RestTransform {
  const c = clamp01(p);
  return { sink: REST_SINK * c, tilt: REST_TILT_DEG * c };
}
