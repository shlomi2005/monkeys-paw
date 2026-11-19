import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useRef } from 'react';
import type { Mesh } from 'three';
import { glbUrl } from './glb-choice';
import type { GlbChoice } from './glb-choice';
import { usePawGltf } from './use-paw-gltf';
import { usePawMaterial } from './use-paw-material';

export interface PawModelProps {
  readonly glb: GlbChoice;
  /** Called once, after the first frame that contains the model has been rendered. */
  readonly onReady: () => void;
}

/**
 * The paw. It suspends while the GLB loads (the canvas's own Suspense holds the scene back), applies the material
 * seam and reports the first rendered frame. It never creates an AnimationMixer and plays no clip: the 12 clips in
 * the GLB are ignored, and the joint driver (task 30) poses the bones itself.
 */
export function PawModel({ glb, onReady }: PawModelProps) {
  // `glb` is chosen once by the stage, so this URL is the same on every render.
  const gltf = usePawGltf(glbUrl(glb, import.meta.env.BASE_URL));
  // The GLB's default scene (the `scene` field), which three's GLTFLoader already resolved. Not scenes[0].
  const scene = gltf.scene;
  const material = usePawMaterial(scene);
  const invalidate = useThree((state) => state.invalidate);

  useLayoutEffect(() => {
    scene.traverse((object) => {
      if (!(object as Mesh).isMesh) return;
      const mesh = object as Mesh;
      mesh.castShadow = true;
      if (material !== null) mesh.material = material;
    });
    invalidate();
  }, [scene, material, invalidate]);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const reported = useRef(false);
  useFrame(() => {
    if (reported.current) return;
    reported.current = true;
    // Subscribers run before the render in the same tick, so a microtask fires after that frame was drawn.
    queueMicrotask(() => onReadyRef.current());
  });

  return <primitive object={scene} />;
}
