import { useCallback, useRef } from 'react';
import type { Digit } from '../state/paw-machine-types';
import type { SceneBridgePort } from '../state/scene-bridge';
import type { GlbChoice } from './glb-choice';
import type { InitialPose } from './joint-driver';
import { PawCanvas } from './PawCanvas';
import { PawLights } from './PawLights';
import { PawModel } from './PawModel';

export interface PawSceneProps {
  /** Play and snap effects, `done` reports and readiness. Connected by the joint driver. */
  readonly bridge: SceneBridgePort;
  /**
   * Pose to start from when the grant arrived before this chunk did. Read until the scene is ready (the model may
   * take a while to load and the session moves on meanwhile), never afterwards: from then on only play and snap
   * effects move the paw.
   */
  readonly initialCurled: readonly Digit[];
  /** `rested` when the round already ended in a rest (all curses closed). Read like `initialCurled`. */
  readonly initialPose: 'upright' | 'rested';
  /** True while the session's phase is `granting`. The paw twitches when it turns true. */
  readonly granting: boolean;
  readonly reducedMotion: boolean;
  readonly glb: GlbChoice;
  /** First frame rendered: the poster may fade. */
  readonly onReady: () => void;
  /** GLB error or context loss: the poster stays. */
  readonly onFailure: () => void;
}

/**
 * The lazy 3D chunk's entry (`React.lazy`, default export). It draws the paw, lets the joint driver pose it from the
 * session's effects, and tells the bridge when it can play commands and when it is gone.
 */
export default function PawScene({
  bridge,
  initialCurled,
  initialPose,
  granting,
  reducedMotion,
  glb,
  onReady,
  onFailure,
}: PawSceneProps) {
  const initial = useRef<InitialPose>({ curled: initialCurled, pose: initialPose });
  initial.current = { curled: initialCurled, pose: initialPose };
  const getInitial = useCallback(() => initial.current, []);

  const lost = useRef(false);
  const isLost = useCallback(() => lost.current, []);
  /** Not ready any more, for every way a scene can go: context loss, load error and thrown errors all end here. */
  const handleFailure = useCallback(() => {
    lost.current = true;
    bridge.setReady(false);
    onFailure();
  }, [bridge, onFailure]);

  // No readiness cleanup here: readiness belongs to the joint driver. Its dispose leaves the bridge when the scene goes
  // away, and `handleFailure` covers errors. A cleanup here runs in the react-dom root, unordered against the driver's
  // first frame in the r3f root, and could clear a live driver's readiness for good.

  return (
    <PawCanvas mobile={glb === 'mobile'} onContextLost={handleFailure}>
      <PawLights />
      <PawModel
        glb={glb}
        bridge={bridge}
        getInitial={getInitial}
        granting={granting}
        reducedMotion={reducedMotion}
        onReady={onReady}
        onFailure={handleFailure}
        isLost={isLost}
      />
    </PawCanvas>
  );
}
