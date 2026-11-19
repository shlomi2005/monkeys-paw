import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useRef } from 'react';
import type { Group, Mesh } from 'three';
import type { SceneBridgePort } from '../state/scene-bridge';
import { glbUrl } from './glb-choice';
import type { GlbChoice } from './glb-choice';
import { countedInvalidate } from './invalidate-counter';
import type { InitialPose } from './joint-driver';
import { RestGroup } from './RestGroup';
import { useGrantingTwitch } from './use-granting-twitch';
import { useJointDriver } from './use-joint-driver';
import { usePawCamera } from './use-paw-camera';
import { usePawGltf } from './use-paw-gltf';
import { usePawMaterial } from './use-paw-material';

export interface PawModelProps {
  readonly glb: GlbChoice;
  readonly bridge: SceneBridgePort;
  /** The starting pose, read until the scene is ready. */
  readonly getInitial: () => InitialPose;
  readonly granting: boolean;
  readonly reducedMotion: boolean;
  /** Called once, after the first frame that contains the model has been rendered and the bridge is ready. */
  readonly onReady: () => void;
  /** The GLB lacks a joint the driver needs. */
  readonly onFailure: () => void;
  readonly isLost: () => boolean;
}

/**
 * The paw. It suspends while the GLB loads (the canvas's own Suspense holds the scene back), applies the material
 * seam, centres the camera on the bind-pose box, poses the joints through the driver and reports the first rendered
 * frame. It never creates an AnimationMixer and plays no clip: the 12 clips in the GLB are ignored.
 */
export function PawModel({
  glb,
  bridge,
  getInitial,
  granting,
  reducedMotion,
  onReady,
  onFailure,
  isLost,
}: PawModelProps) {
  // `glb` is chosen once by the stage, so this URL is the same on every render.
  const gltf = usePawGltf(glbUrl(glb, import.meta.env.BASE_URL));
  // The GLB's default scene (the `scene` field), which three's GLTFLoader already resolved. Not scenes[0].
  const scene = gltf.scene;
  const material = usePawMaterial(scene);
  const invalidate = useThree((state) => state.invalidate);
  const root = useRef<Group>(null);

  useLayoutEffect(() => {
    scene.traverse((object) => {
      if (!(object as Mesh).isMesh) return;
      const mesh = object as Mesh;
      mesh.castShadow = true;
      if (material !== null) mesh.material = material;
    });
    countedInvalidate(invalidate)();
  }, [scene, material, invalidate]);

  usePawCamera(scene);
  useJointDriver({ scene, root, bridge, getInitial, onReady, onFailure, isLost });
  useGrantingTwitch({ root, granting, reducedMotion });

  return (
    <RestGroup ref={root}>
      <primitive object={scene} />
    </RestGroup>
  );
}
