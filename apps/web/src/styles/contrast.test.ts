// Recomputes every contrast pair in design section 7 ("Contrast and size tokens") from the values in tokens.css and
// fails below each floor: 4.5:1 for body-size text, 3:1 for large text (--sepia, 24 px and more), the focus ring and
// control borders (WCAG 2.x, 1.4.3 and 1.4.11).

import { describe, expect, it } from 'vitest';
import { declarationsFor, parseCss, readText, resolveVars } from './css-test-support';

const tokensCss = readText('./tokens.css', import.meta.url);

const rules = parseCss(tokensCss);
const root = declarationsFor(rules, ':root', null);

const token = (name: string): string => {
  const value = root[name];
  if (value === undefined) throw new Error(`tokens.css does not define ${name}`);
  return resolveVars(value, root).toLowerCase();
};

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex);
  if (!match) throw new Error(`Expected a #rrggbb colour, got ${hex}`);
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => channel(parseInt(part as string, 16)));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi as number) + 0.05) / ((lo as number) + 0.05);
}

interface Pair {
  readonly use: string;
  readonly foreground: string;
  readonly background: string;
  readonly floor: number;
}

// One row per line of the design table, plus the control border.
const PAIRS: readonly Pair[] = [
  { use: 'body text: --ink on --parchment', foreground: '--ink', background: '--parchment', floor: 4.5 },
  { use: 'small sepia text: --sepia-text on --parchment', foreground: '--sepia-text', background: '--parchment', floor: 4.5 },
  { use: 'large text and borders: --sepia on --parchment', foreground: '--sepia', background: '--parchment', floor: 3 },
  { use: 'accent text: --blood on --parchment', foreground: '--blood', background: '--parchment', floor: 4.5 },
  { use: 'sound toggle, off: --ink icon on the --parchment roundel', foreground: '--ink', background: '--parchment', floor: 3 },
  { use: 'sound toggle, on: --parchment icon on the --ink roundel', foreground: '--parchment', background: '--ink', floor: 3 },
  { use: 'seal button text: --parchment on --blood', foreground: '--parchment', background: '--blood', floor: 4.5 },
  { use: 'focus ring against the parchment around it', foreground: '--focus-ring-color', background: '--parchment', floor: 3 },
  { use: 'control border against the parchment', foreground: '--control-border-color', background: '--parchment', floor: 3 },
];

describe('contrast tokens (design section 7)', () => {
  it.each(PAIRS)('$use is at least $floor:1', ({ foreground, background, floor }) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(floor);
  });

  it('uses the exact palette from the design', () => {
    expect(token('--ink')).toBe('#2b1d12');
    expect(token('--sepia-text')).toBe('#6b4d30');
    expect(token('--sepia')).toBe('#7a5a3a');
    expect(token('--blood')).toBe('#8f1d14');
    expect(token('--parchment')).toBe('#e9d8b4');
  });

  it('matches the ratios quoted in the design table (within 0.2)', () => {
    const near = (a: string, b: string, expected: number) =>
      expect(Math.abs(contrast(token(a), token(b)) - expected)).toBeLessThan(0.2);
    near('--ink', '--parchment', 11.6);
    near('--sepia-text', '--parchment', 5.5);
    near('--sepia', '--parchment', 4.5);
    near('--blood', '--parchment', 6.3);
  });

  it('keeps the focus ring at 3 px with a 2 px gap', () => {
    expect(token('--focus-ring-width')).toBe('3px');
    expect(token('--focus-ring-offset')).toBe('2px');
  });

  it('computes WCAG ratios correctly (sanity check of the calculation)', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#e9d8b4', '#e9d8b4')).toBeCloseTo(1, 5);
    // A too-light sepia on parchment must fall below the floor, so the checks above can fail.
    expect(contrast('#b09a78', token('--parchment'))).toBeLessThan(3);
  });
});
