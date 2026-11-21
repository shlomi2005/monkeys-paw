import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  albedoLuma,
  cordMask,
  darkness,
  familyWeights,
  binBlend,
  hexToLinear,
  INK_BIN_BLEND,
  INK_BIN_COUNT,
  INK_BIN_STEP,
  INK_DEFAULTS,
  INK_FADE,
  INK_PALETTE,
  lightness,
  lineFwidth,
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
    expect(familyWeights(t0 + INK_FADE / 2)[0]).toBeCloseTo(0.5, 6);
    expect(familyWeights(t0 + INK_FADE)[0]).toBe(1);
    expect(familyWeights(t1 - 0.01)[1]).toBe(0);
    expect(familyWeights(t1 + INK_FADE)[1]).toBe(1);
    expect(familyWeights(t2 - 0.01)[2]).toBe(0);
    expect(familyWeights(t2 + INK_FADE)[2]).toBe(1);
  });

  it('keeps B and C off while A grows', () => {
    const [t0, t1] = INK_DEFAULTS.thresholds;
    const w = familyWeights(t0 + INK_FADE + 0.02);
    expect(t0 + INK_FADE + 0.02).toBeLessThan(t1);
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

describe('direction bins', () => {
  const deg = (d: number) => (d * Math.PI) / 180;

  it('has sixteen bins of 11.25 degrees, crossfaded over a share of a bin in (0, 1]', () => {
    expect(INK_BIN_COUNT).toBe(16);
    expect(INK_BIN_STEP).toBeCloseTo(deg(11.25), 12);
    expect(INK_BIN_BLEND).toBeGreaterThan(0);
    expect(INK_BIN_BLEND).toBeLessThanOrEqual(1);
  });

  it('gives the two bin angles around an angle', () => {
    const b = binBlend(deg(30));
    expect([b.index0, b.index1]).toEqual([2, 3]);
    expect(b.angle0).toBeCloseTo(deg(22.5), 12);
    expect(b.angle1).toBeCloseTo(deg(33.75), 12);
  });

  it('weights only the lower bin near it, only the upper bin near the next, and half at the edge', () => {
    const step = 11.25;
    const lo = 0.5 - INK_BIN_BLEND / 2;
    expect(binBlend(deg(step)).weight).toBe(0);
    expect(binBlend(deg(step * (1 + lo / 2))).weight).toBe(0);
    expect(binBlend(deg(step * 1.5)).weight).toBeCloseTo(0.5, 9);
    expect(binBlend(deg(step * (2 - lo / 2))).weight).toBe(1);
  });

  it('keeps the crossfade within INK_BIN_BLEND of a bin', () => {
    const lo = 0.5 - INK_BIN_BLEND / 2;
    expect(binBlend((1 + lo - 1e-6) * INK_BIN_STEP).weight).toBe(0);
    expect(binBlend((1 + 1 - lo + 1e-6) * INK_BIN_STEP).weight).toBe(1);
  });

  it('wraps at 180 degrees: angle and angle + 180 agree, and the last bin runs into bin 0', () => {
    const a = binBlend(deg(10));
    const b = binBlend(deg(190));
    const c = binBlend(deg(-170));
    expect(b.index0).toBe(a.index0);
    expect(c.index0).toBe(a.index0);
    expect(b.weight).toBeCloseTo(a.weight, 9);
    const top = binBlend(deg(170));
    expect([top.index0, top.index1]).toEqual([INK_BIN_COUNT - 1, 0]);
    expect(top.angle1).toBeCloseTo(Math.PI, 12);
    expect(binBlend(-1e-12).index0).toBe(INK_BIN_COUNT - 1);
  });

  it('is continuous across bin edges, including 0 and 180 degrees', () => {
    // Pattern of a bin pair as a direction pair; a tiny step in angle must change the blended direction by a tiny amount.
    const blended = (angle: number) => {
      const b = binBlend(angle);
      const w1 = b.weight;
      const w0 = 1 - w1;
      // Lines have no sign: compare the double-angle form of each bin direction, weighted.
      const f = (a: number) => [Math.cos(2 * a), Math.sin(2 * a)] as const;
      const [x0, y0] = f(b.angle0);
      const [x1, y1] = f(b.angle1);
      return [w0 * x0 + w1 * x1, w0 * y0 + w1 * y1];
    };
    for (let k = 0; k <= 2 * INK_BIN_COUNT; k++) {
      const edge = (k * INK_BIN_STEP) / 2; // bin centres and bin edges
      const [ax, ay] = blended(edge - 1e-9);
      const [bx, by] = blended(edge + 1e-9);
      expect(Math.hypot(ax - bx, ay - by)).toBeLessThan(1e-6);
    }
  });

  it('keeps the weight in 0..1, the indices below INK_BIN_COUNT and the weight monotone inside a bin', () => {
    fc.assert(
      fc.property(fc.double({ min: -20, max: 20, noNaN: true }), (angle) => {
        const b = binBlend(angle);
        expect(b.weight).toBeGreaterThanOrEqual(0);
        expect(b.weight).toBeLessThanOrEqual(1);
        expect(b.index0).toBeGreaterThanOrEqual(0);
        expect(b.index0).toBeLessThan(INK_BIN_COUNT);
        expect(b.index1).toBe((b.index0 + 1) % INK_BIN_COUNT);
        const later = binBlend(angle + 1e-3);
        if (later.index0 === b.index0) expect(later.weight).toBeGreaterThanOrEqual(b.weight - 1e-12);
      }),
    );
  });
});

describe('lineFwidth', () => {
  it('is 1 / (spacing * pixelRatio) for a line direction along an axis', () => {
    expect(lineFwidth(1, 0, 3.5, 1)).toBeCloseTo(1 / 3.5, 12);
    expect(lineFwidth(0, -1, 3.5, 2)).toBeCloseTo(1 / 7, 12);
  });

  it('is sqrt(2) times larger at 45 degrees, and halves from 1x to 2x', () => {
    const r = Math.SQRT1_2;
    expect(lineFwidth(r, r, 3.5, 1)).toBeCloseTo(Math.SQRT2 / 3.5, 12);
    expect(lineFwidth(r, r, 3.5, 2)).toBeCloseTo(lineFwidth(r, r, 3.5, 1) / 2, 12);
  });

  it('does not depend on the direction of the line, only on its axis', () => {
    expect(lineFwidth(-0.6, 0.8, 3.5, 1)).toBeCloseTo(lineFwidth(0.6, -0.8, 3.5, 1), 12);
  });

  it('matches the finite difference of u = dot(q, dir) / spacing in device px', () => {
    const [dx, dy, spacing, ratio] = [0.6, 0.8, 3.5, 2] as const;
    const u = (px: number, py: number) => ((px / ratio) * dx + (py / ratio) * dy) / spacing;
    const fw = Math.abs(u(1, 0) - u(0, 0)) + Math.abs(u(0, 1) - u(0, 0));
    expect(lineFwidth(dx, dy, spacing, ratio)).toBeCloseTo(fw, 12);
  });

  it('stays below the mean-density fade (0.4) at 2x for every direction and at 1x on an axis', () => {
    const { spacing } = INK_DEFAULTS;
    expect(lineFwidth(Math.SQRT1_2, Math.SQRT1_2, spacing, 2)).toBeLessThan(0.4);
    expect(lineFwidth(1, 0, spacing, 1)).toBeLessThan(0.4);
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
