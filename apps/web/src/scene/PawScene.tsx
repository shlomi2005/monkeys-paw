import type { Digit } from '../state/paw-machine-types';
import type { SceneBridge } from '../state/scene-bridge';
import type { GlbChoice } from './glb-choice';
import { PawCanvas } from './PawCanvas';
import { PawLights } from './PawLights';
import { PawModel } from './PawModel';

export interface PawSceneProps {
  /** Play and snap effects, and `done` reports. Connected by the joint driver (task 30). */
  readonly bridge: SceneBridge;
  /** Pose to start from when the grant arrived before this chunk did (task 30). */
  readonly initialCurled: readonly Digit[];
  readonly reducedMotion: boolean;
  readonly glb: GlbChoice;
  /** First frame rendered: the poster may fade. */
  readonly onReady: () => void;
  /** GLB error or context loss: the poster stays. */
  readonly onFailure: () => void;
}

/**
 * The lazy 3D chunk's entry (`React.lazy`, default export). This run draws the paw at rest and reports the first
 * frame. It does not drive joints and does not call `bridge.setReady(true)`: the session completes play effects on
 * a microtask while no scene is ready, and a scene that cannot pose joints must not swallow them. Task 30 does both.
 */
export default function PawScene({ glb, onReady, onFailure }: PawSceneProps) {
  return (
    <PawCanvas mobile={glb === 'mobile'} onContextLost={onFailure}>
      <PawLights mobile={glb === 'mobile'} />
      <PawModel glb={glb} onReady={onReady} />
    </PawCanvas>
  );
}
