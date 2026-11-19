import { afterEach, describe, expect, it, vi } from 'vitest';
import { countedInvalidate, invalidateCount, resetInvalidateCount } from './invalidate-counter';

afterEach(() => resetInvalidateCount());

describe('invalidate counter', () => {
  it('counts every call and forwards it', () => {
    const invalidate = vi.fn();
    const counted = countedInvalidate(invalidate);
    expect(invalidateCount()).toBe(0);
    counted();
    counted();
    expect(invalidateCount()).toBe(2);
    expect(invalidate).toHaveBeenCalledTimes(2);
    resetInvalidateCount();
    expect(invalidateCount()).toBe(0);
  });

  it('writes nothing to storage', () => {
    const storage = { setItem: vi.fn(), getItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    countedInvalidate(() => undefined)();
    expect(storage.setItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
