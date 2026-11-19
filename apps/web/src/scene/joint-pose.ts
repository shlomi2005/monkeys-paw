export type Quat = readonly [x: number, y: number, z: number, w: number];
export type Vec3 = readonly [number, number, number];
export interface JointOp {
  readonly axis: Vec3;
  readonly maxDegrees: number;
}
export interface JointSpec {
  readonly bind: Quat;
  readonly ops: readonly JointOp[];
}

/** NaN and -Infinity map to 0, +Infinity maps to 1, everything else is clamped to [0, 1]. */
export function clamp01(amount: number): number {
  if (Number.isNaN(amount)) return 0;
  if (amount <= 0) return 0;
  if (amount >= 1) return 1;
  return amount;
}

const DEG_TO_RAD = Math.PI / 180;

/** Hamilton product a ⊗ b, same convention as three's `a.multiply(b)`. */
function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Rotation of `radians` about `axis`. The axis is normalised here. Returns null for a zero or non-finite axis. */
function fromAxisAngle(axis: Vec3, radians: number): Quat | null {
  const length = Math.hypot(axis[0], axis[1], axis[2]);
  if (!(length > 0) || !Number.isFinite(length)) return null;
  const half = radians / 2;
  const s = Math.sin(half) / length;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

/**
 * local quaternion = bind ⊗ R(op1) ⊗ R(op2) ⊗ …, angle = maxDegrees · clamp(amount, 0, 1)
 *
 * Always starts from `spec.bind`, never reads earlier results and never re-normalises. At an effective amount of
 * 0 it returns a copy of `bind` with the same numbers (including the sign of zero).
 */
export function poseJoint(spec: JointSpec, amount: number): Quat {
  const t = clamp01(amount);
  const [bx, by, bz, bw] = spec.bind;
  if (t === 0) return [bx, by, bz, bw];

  let q: Quat = [bx, by, bz, bw];
  for (const op of spec.ops) {
    const r = fromAxisAngle(op.axis, op.maxDegrees * t * DEG_TO_RAD);
    if (r !== null) q = multiply(q, r);
  }
  return q;
}
