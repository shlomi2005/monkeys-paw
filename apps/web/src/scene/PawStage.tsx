import type { ReactNode } from 'react';
import { PawPoster } from './PawPoster';
import styles from './PawStage.module.css';

export interface PawStageProps {
  /** The lazy canvas (task 28). It is placed absolutely over the poster and fills the box. */
  readonly children?: ReactNode;
  /** Hide the poster after the canvas has faded in. */
  readonly posterHidden?: boolean;
  readonly className?: string;
}

/**
 * The 1:1 paw box. Its size comes from --paw-size, the same custom property the static shell in index.html reserves
 * (150 to 200 px on mobile, 300 to 400 px from 768 px), so swapping the shell for this box moves nothing (CLS).
 * It holds the poster and, later, the canvas. No canvas and no three import live here.
 */
export function PawStage({ children, posterHidden = false, className }: PawStageProps) {
  return (
    <div className={className ? `${styles.box} ${className}` : styles.box} data-paw-stage>
      <PawPoster hidden={posterHidden} />
      <div className={styles.canvasSlot} aria-hidden="true" data-canvas-slot>
        {children}
      </div>
    </div>
  );
}
