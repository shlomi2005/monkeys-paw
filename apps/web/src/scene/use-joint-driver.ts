import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type { Object3D } from 'three';
import type { SceneBridgePort } from '../state/scene-bridge';
import { collectBones, createJointDriver } from './joint-driver';
import type { InitialPose, JointDriver, RootLike } from './joint-driver';
import { countedInvalidate } from './invalidate-counter';

export interface UseJointDriverOptions {
  /** The loaded GLB scene: the bones are looked up in it by name. */
  readonly scene: Object3D;
  /** The model root group (`RestGroup`). */
  readonly root: RefObject<RootLike | null>;
  readonly bridge: SceneBridgePort;
  /** The starting pose. Read when the model is placed and just before the scene reports ready, never afterwards. */
  readonly getInitial: () => InitialPose;
  /** First rendered frame with the model in place. The bridge is already ready when this runs. */
  readonly onReady: () => void;
  /** A required joint is missing from the GLB. */
  readonly onFailure: () => void;
  readonly isLost: () => boolean;
}

/**
 * Connects the joint driver to the r3f frame loop and the session's bridge. The `useFrame` callback runs on every
 * rendered frame but the driver only does work, and only asks for more frames, while a command is active. No mixer
 * is ever created here.
 */
export function useJointDriver(options: UseJointDriverOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const invalidate = useThree((state) => state.invalidate);
  const counted = useMemo(() => countedInvalidate(invalidate), [invalidate]);
  const driverRef = useRef<JointDriver | null>(null);
  const { scene, root, bridge } = options;

  useLayoutEffect(() => {
    const rootObject = root.current;
    const bones = collectBones(scene);
    if (rootObject === null || bones === null) {
      latest.current.onFailure();
      return;
    }
    const driver = createJointDriver({
      bones,
      root: rootObject,
      bridge,
      invalidate: counted,
      getInitial: () => latest.current.getInitial(),
      onReady: () => latest.current.onReady(),
      isLost: () => latest.current.isLost(),
    });
    driverRef.current = driver;
    return () => {
      driver.dispose();
      driverRef.current = null;
    };
  }, [scene, root, bridge, counted]);

  useFrame(() => driverRef.current?.frame());
}
