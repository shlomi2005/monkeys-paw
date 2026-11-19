import { describe, expect, it, vi } from 'vitest';
import { prefersReducedData, REDUCED_DATA_QUERY } from './reduced-data';

const never = () => ({ matches: false });

describe('prefersReducedData', () => {
  it('is true when navigator.connection.saveData is true', () => {
    expect(prefersReducedData({ connection: { saveData: true } }, never)).toBe(true);
  });

  it('is false when saveData is false or not exactly true', () => {
    expect(prefersReducedData({ connection: { saveData: false } }, never)).toBe(false);
    expect(prefersReducedData({ connection: { saveData: 'true' } }, never)).toBe(false);
    expect(prefersReducedData({ connection: {} }, never)).toBe(false);
  });

  it('is true when the prefers-reduced-data media query matches', () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query === REDUCED_DATA_QUERY }));
    expect(prefersReducedData({}, matchMedia)).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-data: reduce)');
  });

  it('is false when the media query does not match', () => {
    expect(prefersReducedData({}, never)).toBe(false);
  });

  it('is false when navigator.connection is missing or null', () => {
    expect(prefersReducedData({}, never)).toBe(false);
    expect(prefersReducedData({ connection: null }, never)).toBe(false);
    expect(prefersReducedData(null, never)).toBe(false);
  });

  it('is false when there is no navigator and no matchMedia', () => {
    expect(prefersReducedData(null, null)).toBe(false);
    expect(prefersReducedData(undefined, undefined)).toBe(false);
  });

  it('does not throw when matchMedia throws, and still honours saveData', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    expect(prefersReducedData({}, boom)).toBe(false);
    expect(prefersReducedData({ connection: { saveData: true } }, boom)).toBe(true);
  });

  it('does not throw when reading connection throws', () => {
    const nav = {
      get connection(): never {
        throw new Error('blocked');
      },
    };
    expect(prefersReducedData(nav, never)).toBe(false);
    expect(prefersReducedData(nav, () => ({ matches: true }))).toBe(true);
  });

  it('is false in the node test environment (no window, no navigator.connection)', () => {
    expect(prefersReducedData()).toBe(false);
  });
});
