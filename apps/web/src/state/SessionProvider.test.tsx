// @vitest-environment jsdom

import { cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from './paw-session-test-support';
import { SessionProvider, useSession } from './SessionProvider';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useSession', () => {
  it('throws a clear error outside the provider', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useSession())).toThrow(/inside a <SessionProvider>/);
    quiet.mockRestore();
  });

  it('returns the session inside the provider', () => {
    const { result } = renderHook(() => useSession(), {
      wrapper: ({ children }) => <SessionProvider api={fakeApi()}>{children}</SessionProvider>,
    });
    expect(result.current.ctx.phase).toBe('idle');
    expect(result.current.ctx.reducedMotion).toBe(false);
  });
});

describe('initial reduced motion', () => {
  const read = () =>
    renderHook(() => useSession(), {
      wrapper: ({ children }) => <SessionProvider api={fakeApi()}>{children}</SessionProvider>,
    }).result.current.ctx.reducedMotion;

  it('is true when matchMedia reports it', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
    expect(read()).toBe(true);
  });

  it('is false when matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(read()).toBe(false);
  });

  it('is false when matchMedia throws', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new Error('no media');
    });
    expect(read()).toBe(false);
  });

  it('can be overridden by the prop', () => {
    const { result } = renderHook(() => useSession(), {
      wrapper: ({ children }) => (
        <SessionProvider api={fakeApi()} initialReducedMotion>
          {children}
        </SessionProvider>
      ),
    });
    expect(result.current.ctx.reducedMotion).toBe(true);
  });
});

describe('SessionProvider', () => {
  it('renders its children', () => {
    const { getByText } = render(
      <SessionProvider api={fakeApi()}>
        <p>inside</p>
      </SessionProvider>,
    );
    expect(getByText('inside')).not.toBeNull();
  });
});
