export type Vec3 = readonly [number, number, number];

/** Vertical field of view of the paw camera, in degrees. */
export const CAMERA_FOV_DEG = 30;
/** Visible height at the paw's depth: 1 unit of paw plus about 15% margin each side. */
export const FRAME_HEIGHT_UNITS = 1.3;
/**
 * Height of the camera target and the default target before the model's bounds are known (x = 0 is the wrist, the
 * paw is 1 unit high). Once the GLB is loaded `centredPawCamera` replaces x with the centre of its bounding box.
 */
export const CAMERA_TARGET: Vec3 = [0, 0.5, 0];

/** An axis-aligned box in paw units. */
export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface PawCamera {
  readonly fov: number;
  readonly position: Vec3;
  readonly target: Vec3;
}

/** Distance at which a vertical extent of `heightUnits` exactly fills a view with vertical field of view `fovDeg`. */
export function fitDistance(heightUnits: number, fovDeg: number): number {
  return heightUnits / 2 / Math.tan((fovDeg * Math.PI) / 360);
}

/**
 * Camera on the +Z side of the paw, looking back at it (palm faces +Z), aimed at x = 0 (the wrist). This is the
 * camera the canvas starts with, before the model exists. The paw is not symmetric about the wrist, so the loaded
 * scene switches to `centredPawCamera`.
 */
export function pawCamera(): PawCamera {
  const d = fitDistance(FRAME_HEIGHT_UNITS, CAMERA_FOV_DEG);
  return {
    fov: CAMERA_FOV_DEG,
    position: [CAMERA_TARGET[0], CAMERA_TARGET[1], d],
    target: CAMERA_TARGET,
  };
}

/**
 * The same camera, centred horizontally on the middle of the paw's box so the paw sits in the middle of the plate.
 * `bounds` is the bind-pose box, measured once at load before any pose is applied. The vertical target (y = 0.5),
 * the field of view and the distance are unchanged. Position and target share the same x, so the camera still looks
 * straight down -Z. Without finite bounds it falls back to `pawCamera()`.
 */
export function centredPawCamera(bounds: Bounds): PawCamera {
  const centreX = (bounds.min[0] + bounds.max[0]) / 2;
  if (!Number.isFinite(centreX)) return pawCamera();
  const base = pawCamera();
  return {
    fov: base.fov,
    position: [centreX, base.position[1], base.position[2]],
    target: [centreX, CAMERA_TARGET[1], CAMERA_TARGET[2]],
  };
}
