// @vitest-environment jsdom
// Decoration components: aria-hidden on every decorative element, the reduced-motion class, and the RayDisc pulse restart.

import { act, cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Brazier } from './Brazier';
import { Curtain } from './Curtain';
import { PlateFrame } from './PlateFrame';
import { RayDisc } from './RayDisc';

const QUERY = '(prefers-reduced-motion: reduce)';

/** A matchMedia stand-in for the reduced-motion query, with a way to flip the preference. */
function mockReducedMotion(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === QUERY && matches;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    addListener: (listener: () => void) => listeners.add(listener),
    removeListener: (listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      matches = next;
      act(() => listeners.forEach((listener) => listener()));
    },
    restore() {
      window.matchMedia = original;
    },
  };
}

let motion: ReturnType<typeof mockReducedMotion>;
beforeEach(() => {
  motion = mockReducedMotion(false);
});
afterEach(() => {
  cleanup();
  motion.restore();
});

const FOCUSABLE = 'a, button, input, select, textarea, [tabindex]';

/** Every element that carries a decoration marker, and the marker's own subtree. */
function decorations(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-decoration]')];
}

const CASES: ReadonlyArray<readonly [string, () => ReactElement]> = [
  ['PlateFrame', () => <PlateFrame />],
  ['Brazier (left)', () => <Brazier side="left" />],
  ['Brazier (right)', () => <Brazier side="right" />],
  ['Curtain (left)', () => <Curtain side="left" />],
  ['Curtain (right)', () => <Curtain side="right" />],
  ['RayDisc', () => <RayDisc pulseKey={0} />],
];

describe.each(CASES)('%s as decoration', (_name, element) => {
  it('is aria-hidden, and so is every svg inside it', () => {
    const { container } = render(element());
    const marked = decorations(container);
    expect(marked.length).toBeGreaterThan(0);
    for (const node of marked) expect(node.getAttribute('aria-hidden')).toBe('true');
    for (const svg of container.querySelectorAll('svg')) expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('adds nothing to the tab order and exposes no text', () => {
    const { container } = render(element());
    for (const node of decorations(container)) {
      expect(node.matches(FOCUSABLE)).toBe(false);
      expect(node.querySelector(FOCUSABLE)).toBeNull();
      expect(node.textContent).toBe('');
    }
  });
});

describe('PlateFrame', () => {
  it('renders children outside the aria-hidden decoration', () => {
    const { getByRole, container } = render(
      <PlateFrame>
        <button type="button">Make the wish</button>
      </PlateFrame>,
    );
    const button = getByRole('button', { name: 'Make the wish' });
    expect(button.closest('[aria-hidden="true"]')).toBeNull();
    expect(container.querySelector('[data-decoration="plate-frame"]')?.contains(button)).toBe(false);
  });

  it('draws the border as svg, including four corners', () => {
    const { container } = render(<PlateFrame />);
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(7);
  });
});

describe.each([
  ['Brazier', (): ReactElement => <Brazier side="left" />],
  ['Curtain', (): ReactElement => <Curtain side="right" />],
  ['RayDisc', (): ReactElement => <RayDisc />],
])('%s under reduced motion', (_name, element) => {
  const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-decoration]') as HTMLElement;

  it('has no reduced-motion class when the preference is off', () => {
    const { container } = render(element());
    expect(root(container).className).not.toMatch(/reduced/);
    expect(root(container).dataset['reducedMotion']).toBe('false');
  });

  it('gets the reduced-motion class when (prefers-reduced-motion: reduce) matches', () => {
    motion.restore();
    motion = mockReducedMotion(true);
    const { container } = render(element());
    expect(root(container).className).toMatch(/reduced/);
    expect(root(container).dataset['reducedMotion']).toBe('true');
  });

  it('follows the preference when it changes while mounted', () => {
    const { container } = render(element());
    motion.set(true);
    expect(root(container).className).toMatch(/reduced/);
    motion.set(false);
    expect(root(container).className).not.toMatch(/reduced/);
  });
});

describe('RayDisc pulse', () => {
  const disc = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-pulse]') as HTMLElement;

  it('does not pulse on mount', () => {
    const { container } = render(<RayDisc pulseKey="a" />);
    expect(disc(container).dataset['pulse']).toBe('false');
    expect(disc(container).className).not.toMatch(/pulse/);
  });

  it('keeps the same element while pulseKey is unchanged', () => {
    const { container, rerender } = render(<RayDisc pulseKey="a" />);
    const before = disc(container);
    rerender(<RayDisc pulseKey="a" />);
    expect(disc(container)).toBe(before);
  });

  it('restarts the pulse with a fresh element each time pulseKey changes', () => {
    const { container, rerender } = render(<RayDisc pulseKey={1} />);
    const first = disc(container);

    rerender(<RayDisc pulseKey={2} />);
    const second = disc(container);
    expect(second).not.toBe(first);
    expect(second.dataset['pulse']).toBe('true');
    expect(second.className).toMatch(/pulse/);

    rerender(<RayDisc pulseKey={3} />);
    const third = disc(container);
    expect(third).not.toBe(second);
    expect(third.className).toMatch(/pulse/);
    expect(third.dataset['pulseCount']).toBe('2');
  });

  it('pulses again when the key returns to an earlier value', () => {
    const { container, rerender } = render(<RayDisc pulseKey="a" />);
    rerender(<RayDisc pulseKey="b" />);
    const afterB = disc(container);
    rerender(<RayDisc pulseKey="a" />);
    expect(disc(container)).not.toBe(afterB);
    expect(disc(container).className).toMatch(/pulse/);
  });

  it('never pulses under reduced motion', () => {
    motion.restore();
    motion = mockReducedMotion(true);
    const { container, rerender } = render(<RayDisc pulseKey={1} />);
    rerender(<RayDisc pulseKey={2} />);
    expect(disc(container).dataset['pulse']).toBe('false');
    expect(disc(container).className).not.toMatch(/pulse/);
  });

  it('stops pulsing when reduced motion turns on', () => {
    const { container, rerender } = render(<RayDisc pulseKey={1} />);
    rerender(<RayDisc pulseKey={2} />);
    expect(disc(container).className).toMatch(/pulse/);
    motion.set(true);
    expect(disc(container).className).not.toMatch(/pulse/);
  });
});
