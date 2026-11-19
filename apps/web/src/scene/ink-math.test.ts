import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  albedoLuma,
  cordMask,
  darkness,
  familyWeights,
  hexToLinear,
  INK_DEFAULTS,
  INK_PALETTE,
  lightness,
  lineWidthPx,
} from './ink-math';

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
const mask = (hex: string) => cordMask(...rgb(hex));

describe('hexToLinear', () => {
  it('maps black and white to 0 and 1', () => {
    expect(hexToLinear('#000000')).toEqual([0, 0, 0]);
    expect(hexToLinear('#ffffff')).toEqual([1, 1, 1]);
  });

  it('applies the sRGB transfer to #8f1d14', () => {
    const [r, g, b] = hexToLinear('#8f1d14');
    expect(r).toBeCloseTo(0.2747, 3); // 0x8f = 143
    expect(g).toBeCloseTo(0.0123, 3); // 0x1d = 29
    expect(b).toBeCloseTo(0.007, 3); // 0x14 = 20
  });

  it('has the four palette colours from the design', () => {
    expect(INK_PALETTE).toEqual({ ink: '#2b1d12', sepia: '#7a5a3a', parchment: '#e9d8b4', blood: '#8f1d14' });
  });
});

describe('familyWeights', () => {
  it('is bare paper at D = 0 and all families at D = 1', () => {
    expect(familyWeights(0)).toEqual([0, 0, 0]);
    expect(familyWeights(1)).toEqual([1, 1, 1]);
  });

  it('grows each family in at its threshold', () => {
    const [t0, t1, t2] = INK_DEFAULTS.thresholds;
    expect(familyWeights(t0)[0]).toBe(0);
    expect(familyWeights(t0 - 0.01)[0]).toBe(0);
    expect(familyWeights(t0 + 0.06)[0]).toBeCloseTo(0.5, 6);
    expect(familyWeights(t0 + 0.12)[0]).toBe(1);
    expect(familyWeights(t1 - 0.01)[1]).toBe(0);
    expect(familyWeights(t1 + 0.12)[1]).toBe(1);
    expect(familyWeights(t2 - 0.01)[2]).toBe(0);
    expect(familyWeights(t2 + 0.12)[2]).toBe(1);
  });

  it('keeps B and C off while A grows', () => {
    const w = familyWeights(0.3);
    expect(w[0]).toBe(1);
    expect(w[1]).toBe(0);
    expect(w[2]).toBe(0);
  });
});

describe('lineWidthPx, lightness, darkness, albedoLuma', () => {
  it('runs the line width from min at D = 0 to max at D = 1', () => {
    expect(lineWidthPx(0, 0.4, 1.7)).toBeCloseTo(0.4, 9);
    expect(lineWidthPx(1, 0.4, 1.7)).toBeCloseTo(1.7, 9);
  });

  it('clamps lightness to 0..1 over the light window', () => {
    const { lightLo, lightHi } = INK_DEFAULTS;
    expect(lightness(0, lightLo, lightHi)).toBe(0);
    expect(lightness(lightLo, lightLo, lightHi)).toBe(0);
    expect(lightness(lightHi, lightLo, lightHi)).toBe(1);
    expect(lightness(9, lightLo, lightHi)).toBe(1);
    expect(lightness((lightLo + lightHi) / 2, lightLo, lightHi)).toBeCloseTo(0.5, 9);
  });

  it('keeps darkness in 0..1 and gives dark albedo more ink under the same light', () => {
    expect(darkness(1, 1, 0.75)).toBe(0);
    expect(darkness(0, 0, 0.75)).toBe(1);
    expect(darkness(0.5, 0.1, 0.75)).toBeGreaterThan(darkness(0.5, 0.9, 0.75));
  });

  it('gives albedo luma 0 for black and 1 for white', () => {
    expect(albedoLuma(0, 0, 0)).toBe(0);
    expect(albedoLuma(1, 1, 1)).toBeCloseTo(1, 9);
  });
});

describe('cordMask', () => {
  it.each(['#6d0b18', '#591e22', '#7b212b', '#690d12', '#52131e'])('is at least 0.9 on the cord red %s', (hex) => {
    expect(mask(hex)).toBeGreaterThanOrEqual(0.9);
  });

  it.each(['#52483e', '#42352d', '#655347', '#2a1911', '#1c0e08', '#2d1b15', '#2a1d14', '#e9d8b4'])(
    'is at most 0.05 on the fur, skin, dark brown or parchment colour %s',
    (hex) => {
      expect(mask(hex)).toBeLessThanOrEqual(0.05);
    },
  );
});

describe('properties', () => {
  const unit = fc.double({ min: 0, max: 1, noNaN: true });

  it('keeps family weights in 0..1 and monotone in D', () => {
    fc.assert(
      fc.property(unit, unit, (a, b) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const wl = familyWeights(lo);
        const wh = familyWeights(hi);
        for (let k = 0; k < 3; k++) {
          expect(wl[k]).toBeGreaterThanOrEqual(0);
          expect(wh[k]).toBeLessThanOrEqual(1);
          expect(wh[k]).toBeGreaterThanOrEqual(wl[k]);
        }
      }),
    );
  });

  it('keeps the cord mask in 0..1 for any colour', () => {
    fc.assert(
      fc.property(unit, unit, unit, (r, g, b) => {
        const m = cordMask(r, g, b);
        expect(m).toBeGreaterThanOrEqual(0);
        expect(m).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('makes the cord mask monotone in saturation at a fixed red hue and value', () => {
    fc.assert(
      fc.property(unit, unit, unit, (v, s1, s2) => {
        const lo = Math.min(s1, s2);
        const hi = Math.max(s1, s2);
        const at = (s: number) => cordMask(v, v * (1 - s), v * (1 - s));
        expect(at(hi)).toBeGreaterThanOrEqual(at(lo) - 1e-12);
      }),
    );
  });
});
