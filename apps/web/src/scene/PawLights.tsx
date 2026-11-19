import type { Vec3 } from './camera-fit';

// Named constants, tuned by eye in task 31. Colours and rough intensities come from design.md section 3.
export const AMBIENT_COLOR = '#f0dcb8';
export const AMBIENT_INTENSITY = 0.6;
export const KEY_COLOR = '#ffe2b0';
export const KEY_INTENSITY = 1.6;
/** Upper left, in front of the paw. */
export const KEY_POSITION: Vec3 = [-2.5, 3, 3.5];
export const RIM_COLOR = '#8f1d14';
export const RIM_INTENSITY = 0.35;
/** Behind and to the right. */
export const RIM_POSITION: Vec3 = [2.5, 1.5, -3];

export const SHADOW_MAP_SIZE = 1024;
export const SHADOW_MAP_SIZE_MOBILE = 512;
/** Half-extent of the key light's shadow camera, in paw units. The paw is 1 unit high. */
export const SHADOW_FRUSTUM = 1.5;

/** The transparent plane that catches the drop shadow, behind the paw (the mesh spans z -0.11 to 0.13). */
export const SHADOW_PLANE_POSITION: Vec3 = [0.085, 0.5, -0.25];
export const SHADOW_PLANE_SIZE = 3;
export const SHADOW_OPACITY = 0.3;

export interface PawLightsProps {
  readonly mobile: boolean;
}

/** Sepia ambient, a warm key with a soft shadow, a faint red rim, and the shadow receiver. No environment map. */
export function PawLights({ mobile }: PawLightsProps) {
  const mapSize = mobile ? SHADOW_MAP_SIZE_MOBILE : SHADOW_MAP_SIZE;
  return (
    <>
      <ambientLight color={AMBIENT_COLOR} intensity={AMBIENT_INTENSITY} />
      <directionalLight
        color={KEY_COLOR}
        intensity={KEY_INTENSITY}
        position={[...KEY_POSITION]}
        castShadow
        shadow-mapSize={[mapSize, mapSize]}
        shadow-camera-left={-SHADOW_FRUSTUM}
        shadow-camera-right={SHADOW_FRUSTUM}
        shadow-camera-top={SHADOW_FRUSTUM}
        shadow-camera-bottom={-SHADOW_FRUSTUM}
        shadow-camera-near={0.5}
        shadow-camera-far={10}
      />
      <directionalLight color={RIM_COLOR} intensity={RIM_INTENSITY} position={[...RIM_POSITION]} />
      <mesh position={[...SHADOW_PLANE_POSITION]} receiveShadow>
        <planeGeometry args={[SHADOW_PLANE_SIZE, SHADOW_PLANE_SIZE]} />
        <shadowMaterial transparent opacity={SHADOW_OPACITY} />
      </mesh>
    </>
  );
}
