import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo } from 'react';
import type { Object3D } from 'three';
import { measureBindBounds } from './bind-bounds';
import { centredPawCamera } from './camera-fit';
import { countedInvalidate } from './invalidate-counter';

/**
 * Centres the camera on the paw's bind-pose box as soon as the model is placed, in the same commit as the model and
 * so before the first frame that reports ready. The box is measured from the geometry, which is the bind pose, so
 * posing the fingers can never move the camera: it is not refit afterwards.
 */
export function usePawCamera(scene: Object3D): void {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const counted = useMemo(() => countedInvalidate(invalidate), [invalidate]);

  useLayoutEffect(() => {
    const bounds = measureBindBounds(scene);
    if (bounds === null) return;
    const { position, target } = centredPawCamera(bounds);
    camera.position.set(position[0], position[1], position[2]);
    camera.lookAt(target[0], target[1], target[2]);
    counted();
  }, [scene, camera, counted]);
}
