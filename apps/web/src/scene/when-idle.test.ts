import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_FALLBACK_MS, IDLE_TIMEOUT_MS, whenIdle } from './when-idle';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('whenIdle', () => {
  it('uses requestIdleCallback with a timeout when it exists, and runs nothing until it fires', () => {
    let run: (() => void) | undefined;
    const requestIdleCallback = vi.fn((cb: () => void) => {
      run = cb;
      return 7;
    });
    const callback = vi.fn();
    whenIdle(callback, { requestIdleCallback });
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: IDLE_TIMEOUT_MS });
    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();
    run?.();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('cancels the idle callback by its handle', () => {
    const cancelIdleCallback = vi.fn();
    const cancel = whenIdle(vi.fn(), { requestIdleCallback: () => 7, cancelIdleCallback });
    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it('falls back to a 200 ms timeout without requestIdleCallback', () => {
    const callback = vi.fn();
    whenIdle(callback, {});
    vi.advanceTimersByTime(IDLE_FALLBACK_MS - 1);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(IDLE_FALLBACK_MS).toBe(200);
  });

  it('cancels the timeout fallback', () => {
    const callback = vi.fn();
    const cancel = whenIdle(callback, {});
    cancel();
    vi.advanceTimersByTime(1000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('uses the timeout fallback when there is no window', () => {
    const callback = vi.fn();
    whenIdle(callback);
    vi.advanceTimersByTime(IDLE_FALLBACK_MS);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
