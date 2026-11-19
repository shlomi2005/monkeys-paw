import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Digit } from '../state/paw-machine-types';
import type { SceneBridge } from '../state/scene-bridge';
import { chooseGlb } from './glb-choice';
import type { GlbChoice } from './glb-choice';
import { PawPoster } from './PawPoster';
import { PawSceneBoundary } from './PawSceneBoundary';
import styles from './PawStage.module.css';
import { prefersReducedData } from './reduced-data';
import { whenIdle } from './when-idle';
import { hasWebGL } from './webgl-support';

// The 3D chunk (three, r3f, drei, the scene). Nothing in the entry graph imports it statically.
const PawScene = lazy(() => import('./PawScene'));

/** The canvas fades in over the poster for this long (0 ms under reduced motion), then the poster is hidden. */
export const POSTER_FADE_MS = 300;

export interface PawStageProps {
  /** Extra content for the canvas slot. It is placed absolutely over the poster and fills the box. */
  readonly children?: ReactNode;
  /** Hide the poster after the canvas has faded in. The stage also hides it by itself once the scene is ready. */
  readonly posterHidden?: boolean;
  readonly className?: string;
  /**
   * The session's scene bridge. Without it the stage is a plain poster box and never loads the scene.
   * With it, the stage loads the 3D chunk when WebGL works and the visitor has not asked for reduced data.
   */
  readonly bridge?: SceneBridge;
  readonly initialCurled?: readonly Digit[];
  readonly reducedMotion?: boolean;
}

interface ScenePlan {
  /** False when the poster must stay the only paw picture and the scene chunk must never be requested. */
  readonly scene: boolean;
  readonly glb: GlbChoice;
}

function planScene(): ScenePlan {
  const glb: GlbChoice = chooseGlb(
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? (query) => window.matchMedia(query)
      : undefined,
  );
  // Reduced data first: it is the cheaper check, and it must win even when WebGL works.
  if (prefersReducedData() || !hasWebGL()) return { scene: false, glb };
  return { scene: true, glb };
}

/**
 * The 1:1 paw box. Its size comes from --paw-size, the same custom property the static shell in index.html reserves
 * (150 to 200 px on mobile, 300 to 400 px from 768 px), so swapping the shell for this box moves nothing (CLS).
 *
 * It holds the poster and, when WebGL works, the lazy canvas. The scene is requested after first paint, once. The
 * poster stays the only paw picture when WebGL is missing, the visitor asked for reduced data, or the scene fails.
 */
export function PawStage({
  children,
  posterHidden = false,
  className,
  bridge,
  initialCurled = [],
  reducedMotion = false,
}: PawStageProps) {
  /** Set once the scene has been requested. It also holds the GLB choice, read once on mount. */
  const [glb, setGlb] = useState<GlbChoice | null>(null);
  const [ready, setReady] = useState(false);
  const [faded, setFaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // Decided once per mount. A ref survives StrictMode's second effect run, so nothing is probed or chosen twice.
  const plan = useRef<ScenePlan | null>(null);
  const enabled = bridge !== undefined;

  useEffect(() => {
    if (!enabled || failed) return;
    plan.current ??= planScene();
    const { scene, glb: chosen } = plan.current;
    if (!scene) return;
    return whenIdle(() => setGlb(chosen));
  }, [enabled, failed]);

  const handleReady = useCallback(() => setReady(true), []);
  const handleFailure = useCallback(() => {
    setFailed(true);
    setReady(false);
    setFaded(false);
    setGlb(null);
  }, []);

  // After the first frame the canvas fades in; the poster is hidden once that is done.
  useEffect(() => {
    if (!ready) return;
    if (reducedMotion) {
      setFaded(true);
      return;
    }
    const timer = setTimeout(() => setFaded(true), POSTER_FADE_MS);
    return () => clearTimeout(timer);
  }, [ready, reducedMotion]);

  const sceneMounted = bridge !== undefined && glb !== null && !failed;
  const slotClass = [
    styles.canvasSlot,
    sceneMounted && !ready ? styles.sceneLoading : '',
    ready ? styles.sceneShown : '',
    ready && reducedMotion ? styles.instant : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className ? `${styles.box} ${className}` : styles.box} data-paw-stage>
      <PawPoster hidden={posterHidden || faded} />
      <div className={slotClass} aria-hidden="true" data-canvas-slot>
        {sceneMounted ? (
          <PawSceneBoundary onFailure={handleFailure}>
            <Suspense fallback={null}>
              <PawScene
                bridge={bridge}
                initialCurled={initialCurled}
                reducedMotion={reducedMotion}
                glb={glb}
                onReady={handleReady}
                onFailure={handleFailure}
              />
            </Suspense>
          </PawSceneBoundary>
        ) : null}
        {children}
      </div>
    </div>
  );
}
