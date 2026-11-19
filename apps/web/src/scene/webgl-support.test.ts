import { describe, expect, it, vi } from 'vitest';
import { hasWebGL } from './webgl-support';
import type { ProbeCanvas } from './webgl-support';

/** Fake canvas whose `getContext` returns the given context per id (null when absent). */
function fakeCanvas(contexts: Record<string, unknown>): { canvas: ProbeCanvas; getContext: ReturnType<typeof vi.fn> } {
  const getContext = vi.fn((id: string) => contexts[id] ?? null);
  return { canvas: { getContext }, getContext };
}

function glWithLose(loseContext: () => void): unknown {
  return { getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null) };
}

describe('hasWebGL', () => {
  it('is true when webgl2 works, without trying webgl', () => {
    const { canvas, getContext } = fakeCanvas({ webgl2: {} });
    expect(hasWebGL(() => canvas)).toBe(true);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledWith('webgl2');
  });

  it('is true when only webgl works', () => {
    const { canvas, getContext } = fakeCanvas({ webgl: {} });
    expect(hasWebGL(() => canvas)).toBe(true);
    expect(getContext.mock.calls.map((c) => c[0])).toEqual(['webgl2', 'webgl']);
  });

  it('is false when both contexts are null', () => {
    const { canvas } = fakeCanvas({});
    expect(hasWebGL(() => canvas)).toBe(false);
  });

  it('is false when getContext throws', () => {
    const canvas: ProbeCanvas = {
      getContext: () => {
        throw new Error('blocked');
      },
    };
    expect(hasWebGL(() => canvas)).toBe(false);
  });

  it('is false when createCanvas throws', () => {
    expect(
      hasWebGL(() => {
        throw new Error('no canvas');
      }),
    ).toBe(false);
  });

  it('is false without a document (node environment, default canvas factory)', () => {
    expect(typeof document).toBe('undefined');
    expect(hasWebGL()).toBe(false);
  });

  it('releases the context through WEBGL_lose_context when available', () => {
    const loseContext = vi.fn();
    const { canvas } = fakeCanvas({ webgl2: glWithLose(loseContext) });
    expect(hasWebGL(() => canvas)).toBe(true);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it('is fine when the extension is absent', () => {
    const { canvas } = fakeCanvas({ webgl2: { getExtension: () => null } });
    expect(hasWebGL(() => canvas)).toBe(true);
  });

  it('is fine when the context has no getExtension at all', () => {
    const { canvas } = fakeCanvas({ webgl: {} });
    expect(hasWebGL(() => canvas)).toBe(true);
  });

  it('stays true when releasing the context throws', () => {
    const { canvas } = fakeCanvas({
      webgl2: glWithLose(() => {
        throw new Error('already lost');
      }),
    });
    expect(hasWebGL(() => canvas)).toBe(true);
  });
});
