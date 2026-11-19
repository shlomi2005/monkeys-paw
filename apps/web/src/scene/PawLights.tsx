import type { Vec3 } from './camera-fit';

// Named constants, tuned in the browser in task 31. Colours come from design.md section 3. The intensities are high
// because the GLB material has metalness 1 and there is no environment map, and the sepia tint is applied in linear space.
export const AMBIENT_COLOR = '#f0dcb8';
export const AMBIENT_INTENSITY = 1.8;
export const KEY_COLOR = '#ffe2b0';
export const KEY_INTENSITY = 4.8;
/** Upper left, in front of the paw. */
export const KEY_POSITION: Vec3 = [-2.5, 3, 3.5];
export const RIM_COLOR = '#8f1d14';
export const RIM_INTENSITY = 1.0;
/** Behind and to the right. */
export const RIM_POSITION: Vec3 = [2.5, 1.5, -3];

/** Sepia ambient, a warm key and a faint red rim. No environment map, no cast shadow (the engraving has none). */
export function PawLights() {
  return (
    <>
      <ambientLight color={AMBIENT_COLOR} intensity={AMBIENT_INTENSITY} />
      <directionalLight color={KEY_COLOR} intensity={KEY_INTENSITY} position={[...KEY_POSITION]} />
      <directionalLight color={RIM_COLOR} intensity={RIM_INTENSITY} position={[...RIM_POSITION]} />
    </>
  );
}
