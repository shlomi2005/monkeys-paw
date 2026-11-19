// Where the five curse circles sit around the paw (design.md section 1, "Circle positions").
// Pure TypeScript: no DOM, no React.
//
// The circles lie on a regular pentagon, point up: three above the paw's centre line, two below. Angles run clockwise
// from 12 o'clock. Circle index equals curse index equals digit index.

/** 0 upper-left, 1 top-centre, 2 upper-right, 3 lower-right, 4 lower-left. */
export type CirclePosIndex = 0 | 1 | 2 | 3 | 4;

/** Every circle index, in the order the DOM renders them and in the mobile list order. */
export const CIRCLE_INDEXES: readonly [0, 1, 2, 3, 4] = [0, 1, 2, 3, 4];

/** Under 768 px the circles form a vertical list under the paw, in index order (design section 1, "Mobile"). */
export const MOBILE_CIRCLE_ORDER: readonly [0, 1, 2, 3, 4] = CIRCLE_INDEXES;

/** Degrees clockwise from 12 o'clock. Index 4 is +216°, which is the same direction as -144°. */
export const CIRCLE_ANGLES_DEG: readonly [number, number, number, number, number] = [-72, 0, 72, 144, 216];

export interface CirclePosition {
  /** Pixels (or any unit) right of the plate origin. */
  readonly x: number;
  /** Down is positive, as on screen. */
  readonly y: number;
}

function assertIndex(index: number): asserts index is CirclePosIndex {
  if (!Number.isInteger(index) || index < 0 || index > 4) {
    throw new RangeError(`Circle index must be an integer from 0 to 4, got ${String(index)}`);
  }
}

/** Angle of a circle from 12 o'clock, clockwise, in degrees. */
export function circleAngleDeg(index: number): number {
  assertIndex(index);
  return CIRCLE_ANGLES_DEG[index];
}

/**
 * Centre of circle `index`: `x = cx + rx·sin θ`, `y = cy − ry·cos θ`, y down. `rx` and `ry` are the ring radii
 * (`--ring-rx`, `--ring-ry`, with rx > ry because the plate is wider than tall). `cx` and `cy` default to the paw
 * centre as the origin. The stylesheet calls this with rx = ry = 1 and multiplies by the real radii in `calc()`.
 */
export function circlePosition(index: number, rx: number, ry: number, cx = 0, cy = 0): CirclePosition {
  const theta = (circleAngleDeg(index) * Math.PI) / 180;
  return { x: cx + rx * Math.sin(theta), y: cy - ry * Math.cos(theta) };
}
