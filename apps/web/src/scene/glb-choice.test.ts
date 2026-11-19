import { describe, expect, it, vi } from 'vitest';
import { chooseGlb, glbUrl } from './glb-choice';
import type { MatchMediaFn } from './glb-choice';

/** Fake `matchMedia` that evaluates `(max-width: Npx)` against a viewport width and records the queries. */
function fakeMatchMedia(viewportWidth: number): { fn: MatchMediaFn; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn((query: string) => {
    const m = /^\(max-width: (\d+)px\)$/.exec(query);
    if (!m) throw new Error(`unsupported query: ${query}`);
    return { matches: viewportWidth <= Number(m[1]) };
  });
  return { fn: spy as unknown as MatchMediaFn, spy };
}

describe('chooseGlb', () => {
  it.each([320, 767, 768])('returns mobile at %i px', (w) => {
    expect(chooseGlb(fakeMatchMedia(w).fn)).toBe('mobile');
  });

  it.each([769, 1280])('returns web at %i px', (w) => {
    expect(chooseGlb(fakeMatchMedia(w).fn)).toBe('web');
  });

  it('returns mobile when matchMedia is missing', () => {
    expect(chooseGlb(undefined)).toBe('mobile');
    expect(chooseGlb(null)).toBe('mobile');
  });

  it('returns mobile when matchMedia throws', () => {
    const throwing: MatchMediaFn = () => {
      throw new Error('boom');
    };
    expect(chooseGlb(throwing)).toBe('mobile');
  });

  it('passes exactly "(max-width: 768px)"', () => {
    const { fn, spy } = fakeMatchMedia(1000);
    chooseGlb(fn);
    expect(spy).toHaveBeenCalledWith('(max-width: 768px)');
  });

  it('calls matchMedia once per chooseGlb call', () => {
    const { fn, spy } = fakeMatchMedia(1000);
    chooseGlb(fn);
    expect(spy).toHaveBeenCalledTimes(1);
    chooseGlb(fn);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('glbUrl', () => {
  it('joins the base URL and the file name', () => {
    expect(glbUrl('web', '/')).toBe('/paw/paw-web.glb');
    expect(glbUrl('mobile', '/')).toBe('/paw/paw-mobile.glb');
    expect(glbUrl('web', '/app/')).toBe('/app/paw/paw-web.glb');
  });
});
