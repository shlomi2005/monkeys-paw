import { Canvas, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { pawCamera } from './camera-fit';

/** Device pixel ratio range. Phones stop at 1.5 to save fill rate. */
export const DPR_DESKTOP: [number, number] = [1, 2];
export const DPR_MOBILE: [number, number] = [1, 1.5];

export interface PawCanvasProps {
  readonly mobile: boolean;
  /** The GL context was lost. The stage drops the canvas and keeps the poster. */
  readonly onContextLost: () => void;
  readonly children?: ReactNode;
}

/** Listens for `webglcontextlost` on the canvas element for as long as the scene is mounted. */
function ContextLossWatcher({ onContextLost }: { readonly onContextLost: () => void }) {
  const element = useThree((state) => state.gl.domElement);
  useEffect(() => {
    element.addEventListener('webglcontextlost', onContextLost);
    return () => element.removeEventListener('webglcontextlost', onContextLost);
  }, [element, onContextLost]);
  return null;
}

/**
 * The r3f canvas: renders only on demand, transparent so the parchment and the red ray disc show through, never
 * takes pointer events, and is hidden from assistive technology (the text equivalent carries the meaning).
 */
export function PawCanvas({ mobile, onContextLost, children }: PawCanvasProps) {
  const camera = pawCamera();
  return (
    <Canvas
      frameloop="demand"
      dpr={mobile ? DPR_MOBILE : DPR_DESKTOP}
      gl={{ alpha: true, antialias: true }}
      // Soft shadows. In three 0.187 `PCFSoftShadowMap` is removed (and warns every frame); `PCFShadowMap` is the soft filter.
      shadows="percentage"
      // Starts aimed at the wrist (x = 0). `PawModel` centres it on the paw's bind-pose box as soon as the model is placed,
      // before the first frame that reports ready.
      camera={{ fov: camera.fov, position: [...camera.position], near: 0.1, far: 20 }}
      onCreated={({ camera: created }) => created.lookAt(...camera.target)}
      aria-hidden="true"
      style={{ pointerEvents: 'none', background: 'transparent' }}
    >
      <ContextLossWatcher onContextLost={onContextLost} />
      {children}
    </Canvas>
  );
}
