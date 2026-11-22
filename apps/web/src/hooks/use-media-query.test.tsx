// @vitest-environment jsdom
// useMediaQuery (paw-web design.md "Mobile" B): a live reading of a media query. A missing or throwing `matchMedia`
// means "no match", which is desktop for the phone query.

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHONE_QUERY, useMediaQuery } from './use-media-query';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe({ query = PHONE_QUERY }: { query?: string }) {
  return <p data-testid="probe">{String(useMediaQuery(query))}</p>;
}

const shown = (container: HTMLElement): string => container.querySelector('[data-testid="probe"]')?.textContent ?? '';

interface FakeList {
  matches: boolean;
  media: string;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

/** A `matchMedia` with one query that can change. `set` flips the value and fires the listeners. */
function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const asked: string[] = [];
  vi.stubGlobal('matchMedia', (query: string): FakeList => {
    asked.push(query);
    return {
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_type, listener) => void listeners.add(listener),
      removeEventListener: (_type, listener) => void listeners.delete(listener),
    };
  });
  return {
    asked,
    listeners,
    set(value: boolean) {
      matches = value;
      act(() => {
        for (const listener of [...listeners]) listener();
      });
    },
  };
}

describe('useMediaQuery', () => {
  it('uses the phone query "(max-width: 767.98px)"', () => {
    expect(PHONE_QUERY).toBe('(max-width: 767.98px)');
    const media = stubMatchMedia(true);
    const { container } = render(<Probe />);
    expect(shown(container)).toBe('true');
    expect(new Set(media.asked)).toEqual(new Set([PHONE_QUERY]));
  });

  it('follows a change after mount, and lets go of the listener on unmount', () => {
    const media = stubMatchMedia(false);
    const { container, unmount } = render(<Probe />);
    expect(shown(container)).toBe('false');
    expect(media.listeners.size).toBe(1);
    media.set(true);
    expect(shown(container)).toBe('true');
    media.set(false);
    expect(shown(container)).toBe('false');
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it('means false when matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(shown(render(<Probe />).container)).toBe('false');
  });

  it('means false when matchMedia throws, and does not throw itself', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new Error('no media');
    });
    expect(shown(render(<Probe />).container)).toBe('false');
  });

  it('uses the deprecated addListener pair where addEventListener is missing', () => {
    const listeners = new Set<() => void>();
    let matches = false;
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return matches;
      },
      addListener: (listener: () => void) => void listeners.add(listener),
      removeListener: (listener: () => void) => void listeners.delete(listener),
    }));
    const { container, unmount } = render(<Probe />);
    matches = true;
    act(() => {
      for (const listener of [...listeners]) listener();
    });
    expect(shown(container)).toBe('true');
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('reads another query when the query changes', () => {
    const media = stubMatchMedia(true);
    const { container, rerender } = render(<Probe query="(min-width: 1px)" />);
    rerender(<Probe query="(min-width: 2px)" />);
    expect(shown(container)).toBe('true');
    expect(media.asked).toContain('(min-width: 2px)');
  });
});
