export type Vec3 = readonly [number, number, number];

/** Vertical field of view of the paw camera, in degrees. */
export const CAMERA_FOV_DEG = 30;
/** Visible height at the paw's depth: 1 unit of paw plus about 15% margin each side. */
export const FRAME_HEIGHT_UNITS = 1.3;
/** The camera looks at the middle of the paw (wrist at the origin, paw 1 unit high). */
export const CAMERA_TARGET: Vec3 = [0, 0.5, 0];

export interface PawCamera {
  readonly fov: number;
  readonly position: Vec3;
  readonly target: Vec3;
}

/** Distance at which a vertical extent of `heightUnits` exactly fills a view with vertical field of view `fovDeg`. */
export function fitDistance(heightUnits: number, fovDeg: number): number {
  return heightUnits / 2 / Math.tan((fovDeg * Math.PI) / 360);
}

/** Camera on the +Z side of the paw, looking back at it (palm faces +Z). */
export function pawCamera(): PawCamera {
  const d = fitDistance(FRAME_HEIGHT_UNITS, CAMERA_FOV_DEG);
  return {
    fov: CAMERA_FOV_DEG,
    position: [CAMERA_TARGET[0], CAMERA_TARGET[1], d],
    target: CAMERA_TARGET,
  };
}
