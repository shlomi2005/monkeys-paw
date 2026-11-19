import styles from './CircleArt.module.css';

// Original inline SVG for the curse circles: vignette frame, wax seal (whole or cracked) and laurel wreath.
// Every svg is aria-hidden: the circle button's aria-label already carries the state (design section 2, Req 8.4).

const round = (n: number): number => Math.round(n * 100) / 100;

const polar = (cx: number, cy: number, r: number, deg: number): readonly [number, number] => {
  const rad = (deg * Math.PI) / 180;
  return [round(cx + r * Math.sin(rad)), round(cy - r * Math.cos(rad))];
};

/** Fine tick marks between the two rules of the vignette, like the engraved edge of a medal. */
const TICKS = Array.from({ length: 36 }, (_, i) => {
  const [x1, y1] = polar(50, 50, 40.5, i * 10);
  const [x2, y2] = polar(50, 50, 44, i * 10);
  return `M${x1} ${y1} L${x2} ${y2}`;
}).join(' ');

/** Double ring with tick marks. Fills the disc (viewBox 100). */
export function VignetteFrame() {
  return (
    <svg className={styles.vignette} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle className={styles.ruleInk} cx="50" cy="50" r="46" fill="none" strokeWidth="1.25" />
      <path className={styles.ruleSepia} d={TICKS} fill="none" strokeWidth="0.75" />
      <circle className={styles.ruleSepia} cx="50" cy="50" r="40" fill="none" strokeWidth="1" />
    </svg>
  );
}

/** Scalloped wax edge: 10 lobes around a 16 unit radius. */
const SEAL_EDGE = (() => {
  const points = Array.from({ length: 80 }, (_, i) => {
    const deg = (i * 360) / 80;
    const radius = 16.5 + 1.5 * Math.cos((deg * 10 * Math.PI) / 180);
    const [x, y] = polar(20, 20, radius, deg);
    return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
  });
  return `${points.join(' ')} Z`;
})();

export interface WaxSealProps {
  /** `sealed`: the seal holds. `cracked`: the Judge said not closed. */
  readonly state: 'sealed' | 'cracked';
}

/** Blood-red wax seal (viewBox 40). The press and crack animations live on the wrapper in CurseCircle.module.css. */
export function WaxSeal({ state }: WaxSealProps) {
  return (
    <svg className={styles.seal} viewBox="0 0 40 40" aria-hidden="true" focusable="false" data-seal={state}>
      <path className={styles.wax} d={SEAL_EDGE} strokeWidth="1.5" strokeLinejoin="round" />
      <circle className={styles.waxRing} cx="20" cy="20" r="10.5" fill="none" strokeWidth="1" />
      <path className={styles.waxMark} d="M20 13.5 V26.5 M14.5 17.5 H25.5" fill="none" strokeWidth="1.5" strokeLinecap="round" />
      {state === 'cracked' ? (
        <path
          className={styles.crack}
          d="M21 2 L17.5 10 L23 15 L16.5 21 L22.5 27 L18.5 38"
          fill="none"
          strokeWidth="2"
          strokeLinejoin="miter"
        />
      ) : null}
    </svg>
  );
}

/** Two branches of leaves climbing from the bottom centre, as a sepia wreath around the disc (viewBox 100). */
const LEAVES = [-1, 1].flatMap((side) =>
  Array.from({ length: 7 }, (_, t) => {
    const deg = 180 + side * (14 + t * 17);
    const [x, y] = polar(50, 50, 37, deg);
    return { key: `${side}-${t}`, x, y, rotate: round(deg + 90 - side * 28), scale: round(1 - t * 0.05) };
  }),
);

/** The closed-circle laurel wreath. */
export function LaurelWreath() {
  return (
    <svg className={styles.laurel} viewBox="0 0 100 100" aria-hidden="true" focusable="false" data-laurel>
      {LEAVES.map((leaf) => (
        <ellipse
          key={leaf.key}
          className={styles.leaf}
          cx={leaf.x}
          cy={leaf.y}
          rx={2.6 * leaf.scale}
          ry={6.4 * leaf.scale}
          transform={`rotate(${leaf.rotate} ${leaf.x} ${leaf.y})`}
        />
      ))}
    </svg>
  );
}
