import type { ReactNode } from 'react';
import styles from './PlateFrame.module.css';

export interface PlateFrameProps {
  /** The layout grid (paw, circles, wish line). Rendered above all decoration. */
  readonly children?: ReactNode;
  readonly className?: string;
}

/**
 * One corner of the engraved border, drawn for the top-left. CSS mirrors it into the other three corners.
 * The viewBox is 112 units. The outer rule sits at 4 and the inner rule at 11, which line up with the page rules at
 * 8 px and 15 px when the corner is drawn at scale 1. Original art: ink, sepia accents, one blood-red bead.
 */
function CornerOrnament({ className }: { readonly className: string }) {
  return (
    <svg className={className} viewBox="0 0 112 112" aria-hidden="true" focusable="false">
      {/* Tapered bracket: swells at the corner and thins along both arms. */}
      <path className={styles.fillInk} d="M4 4 H108 L100 8.5 H8.5 V100 L4 108 Z" />
      <path className={styles.strokeSepia} d="M11 96 V11 H96" fill="none" strokeWidth="1.25" />
      <g className={styles.fine}>
        {/* Concentric quarter arcs around the lozenge, like engraved lathe lines. */}
        <path className={styles.strokeInk} d="M22 58 A36 36 0 0 0 58 22" fill="none" strokeWidth="1.5" />
        <path className={styles.strokeSepia} d="M22 48 A26 26 0 0 0 48 22" fill="none" strokeWidth="1.25" />
        {/* A curled scroll hanging off each arm. */}
        <path
          className={styles.strokeInk}
          d="M64 15 C72 15 78 20 78 26 C78 31 73 33 70 31 C67 29 68 25 71 25"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          className={styles.strokeInk}
          d="M15 64 C15 72 20 78 26 78 C31 78 33 73 31 70 C29 67 25 68 25 71"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle className={styles.fillSepia} cx="88" cy="17" r="1.6" />
        <circle className={styles.fillSepia} cx="17" cy="88" r="1.6" />
      </g>
      {/* Lozenge with the blood-red bead. */}
      <path className={`${styles.fillParchment} ${styles.strokeInk}`} d="M22 12 L32 22 L22 32 L12 22 Z" strokeWidth="1.75" />
      <circle className={styles.fillBlood} cx="22" cy="22" r="3" />
    </svg>
  );
}

/** Centre-edge cartouche: a lozenge flanked by rules that end in beads. Hidden under 768 px. */
function Cartouche({ className }: { readonly className: string }) {
  return (
    <svg className={className} viewBox="0 0 96 24" aria-hidden="true" focusable="false">
      <path className={styles.strokeInk} d="M0 12 H32 M64 12 H96" fill="none" strokeWidth="1.25" />
      <circle className={styles.fillSepia} cx="3" cy="12" r="2" />
      <circle className={styles.fillSepia} cx="93" cy="12" r="2" />
      <path className={`${styles.fillParchment} ${styles.strokeInk}`} d="M48 1.5 L59 12 L48 22.5 L37 12 Z" strokeWidth="1.75" />
      <path className={styles.strokeSepia} d="M48 6.5 L54 12 L48 17.5 L42 12 Z" fill="none" strokeWidth="1" />
      <circle className={styles.fillBlood} cx="48" cy="12" r="2.2" />
    </svg>
  );
}

/** Full-viewport parchment plate: noise, engraved border, and a slot for the layout grid. */
export function PlateFrame({ children, className }: PlateFrameProps) {
  return (
    <div className={className ? `${styles.plate} ${className}` : styles.plate}>
      <div className={styles.decor} aria-hidden="true" data-decoration="plate-frame">
        <div className={styles.texture} />
        <svg className={styles.ruleOuter} aria-hidden="true" focusable="false">
          <rect width="100%" height="100%" fill="none" />
        </svg>
        <svg className={styles.ruleBeads} aria-hidden="true" focusable="false">
          <rect width="100%" height="100%" fill="none" />
        </svg>
        <svg className={styles.ruleInner} aria-hidden="true" focusable="false">
          <rect width="100%" height="100%" fill="none" />
        </svg>
        <CornerOrnament className={`${styles.corner} ${styles.cornerTopLeft}`} />
        <CornerOrnament className={`${styles.corner} ${styles.cornerTopRight}`} />
        <CornerOrnament className={`${styles.corner} ${styles.cornerBottomLeft}`} />
        <CornerOrnament className={`${styles.corner} ${styles.cornerBottomRight}`} />
        <Cartouche className={`${styles.cartouche} ${styles.cartoucheTop}`} />
        <Cartouche className={`${styles.cartouche} ${styles.cartoucheBottom}`} />
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
