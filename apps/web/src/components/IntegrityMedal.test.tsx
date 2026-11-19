// @vitest-environment jsdom
// IntegrityMedal: visibility goes through real PawContext fixtures and selectView, so the selector and the component
// are tested together. Plus the stylesheet rules.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { initialState } from '../state/paw-machine';
import type { PawContext } from '../state/paw-machine-types';
import { selectView } from '../state/paw-selectors';
import { declarationsFor, parseCss, readText } from '../styles/css-test-support';
import { IntegrityMedal } from './IntegrityMedal';
import { closeCurse, curling, drain, ready, send } from './round-end-test-support';

afterEach(cleanup);

function renderFor(ctx: PawContext) {
  return render(<IntegrityMedal medal={selectView(ctx).medal} />);
}

const filled = (container: HTMLElement): number => container.querySelectorAll('[data-laurel="filled"]').length;
const outlined = (container: HTMLElement): number => container.querySelectorAll('[data-laurel="outlined"]').length;

/** Three curses, the first two closed, then the round is stopped: Integrity 3/5. */
function threeOfFive(): PawContext {
  let ctx = ready(3);
  ctx = drain(closeCurse(ctx, 0));
  ctx = drain(closeCurse(ctx, 1));
  return send(ctx, { type: 'stop' });
}

/** Before the end: one polite status element that exists and is empty, and no medal visuals at all. */
function expectEmptyRegion(container: HTMLElement): void {
  const status = screen.getByRole('status');
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(status.getAttribute('aria-live')).toBe('polite');
  expect(status.textContent).toBe('');
  expect(container.querySelectorAll('svg')).toHaveLength(0);
  expect(container.querySelectorAll('[data-laurel]')).toHaveLength(0);
  expect(container.querySelector('[data-decoration="laurels"]')).toBeNull();
  expect(container.querySelector('[data-medal]')).toBeNull();
}

describe('IntegrityMedal visibility', () => {
  it('renders an empty status region and no laurels for a null medal', () => {
    const { container } = render(<IntegrityMedal medal={null} />);
    expectEmptyRegion(container);
  });

  it.each([
    ['before any wish', () => initialState(false)],
    ['while the curls run', () => curling(3)],
    ['while the round is running', () => ready(3)],
    ['with some curses closed and the round running', () => drain(closeCurse(ready(3), 0))],
  ])('shows an empty status region and no laurels %s', (_name, make) => {
    const ctx = make();
    expect(selectView(ctx).medal).toBeNull();
    const { container } = renderFor(ctx);
    expectEmptyRegion(container);
  });

  it('shows only the empty region while the paw is still lying down after the last curse closed', () => {
    let ctx = ready(3);
    for (const index of [0, 1, 2]) ctx = closeCurse(ctx, index);
    expect(ctx.phase).toBe('ended');
    expect(ctx.anim.active).not.toBeNull(); // the open or the rest is still running
    const { container } = renderFor(ctx);
    expectEmptyRegion(container);
  });

  it('keeps the same status element when the medal appears, so the text is inserted into a live region', () => {
    const { container, rerender } = renderFor(ready(3));
    const before = screen.getByRole('status');
    expect(before.textContent).toBe('');
    rerender(<IntegrityMedal medal={selectView(threeOfFive()).medal} />);
    const after = screen.getByRole('status');
    expect(after).toBe(before);
    expect(after.textContent).toBe('Integrity 3/5: 2 closed, 1 open');
    expect(filled(container)).toBe(3);
    expect(outlined(container)).toBe(2);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it('empties the same status element again when the medal goes away', () => {
    const { container, rerender } = renderFor(threeOfFive());
    const before = screen.getByRole('status');
    rerender(<IntegrityMedal medal={null} />);
    expect(screen.getByRole('status')).toBe(before);
    expectEmptyRegion(container);
  });

  it('appears once the animation queue is empty after all curses closed', () => {
    let ctx = ready(3);
    for (const index of [0, 1, 2]) ctx = closeCurse(ctx, index);
    const { container } = renderFor(drain(ctx));
    expect(screen.getByRole('status').textContent).toBe('Integrity 5/5: 3 closed, 0 open');
    expect(filled(container)).toBe(5);
    expect(outlined(container)).toBe(0);
  });

  it('appears at once under reduced motion, which has nothing to wait for', () => {
    let ctx = ready(3, true);
    for (const index of [0, 1, 2]) ctx = closeCurse(ctx, index);
    expect(ctx.phase).toBe('ended');
    renderFor(ctx);
    expect(screen.getByRole('status').textContent).toBe('Integrity 5/5: 3 closed, 0 open');
  });

  it('appears at once after a stop', () => {
    renderFor(threeOfFive());
    expect(screen.getByRole('status').textContent).toBe('Integrity 3/5: 2 closed, 1 open');
  });

  it('goes away again after a rewrite', () => {
    const { container } = renderFor(send(threeOfFive(), { type: 'rewrite' }));
    expectEmptyRegion(container);
  });
});

describe('IntegrityMedal content', () => {
  it('fills 3 of 5 laurels for Integrity 3/5', () => {
    const { container } = renderFor(threeOfFive());
    expect(filled(container)).toBe(3);
    expect(outlined(container)).toBe(2);
    expect(container.querySelectorAll('svg')).toHaveLength(5);
  });

  it('fills no laurel for Integrity 0/5', () => {
    const { container } = renderFor(send(ready(4), { type: 'stop' }));
    expect(screen.getByRole('status').textContent).toBe('Integrity 0/5: 0 closed, 4 open');
    expect(filled(container)).toBe(0);
    expect(outlined(container)).toBe(5);
  });

  it('fills the laurels from the left, one per point', () => {
    const { container } = renderFor(threeOfFive());
    const states = [...container.querySelectorAll('[data-laurel]')].map((n) => n.getAttribute('data-laurel'));
    expect(states).toEqual(['filled', 'filled', 'filled', 'outlined', 'outlined']);
  });

  it('shows exactly the selector text, in one polite status element', () => {
    const ctx = threeOfFive();
    const text = selectView(ctx).medal?.text;
    const { container } = renderFor(ctx);
    const statuses = container.querySelectorAll('[role="status"]');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toBe(text);
    expect(statuses[0]?.getAttribute('aria-live')).toBe('polite');
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);
  });

  it('hides every laurel from assistive technology and keeps them out of the tab order', () => {
    const { container } = renderFor(threeOfFive());
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.closest('[role="status"]')).toBeNull();
    }
    expect(container.querySelector('a, button, input, select, textarea, [tabindex]')).toBeNull();
    const status = screen.getByRole('status');
    expect(status.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('shows the text of a medal handed over directly, as text only', () => {
    render(<IntegrityMedal medal={{ score: 1, closed: 1, open: 2, text: 'Integrity 1/5: 1 closed, 2 open' }} />);
    expect(screen.getByRole('status').textContent).toBe('Integrity 1/5: 1 closed, 2 open');
    expect(document.querySelectorAll('[data-laurel="filled"]')).toHaveLength(1);
  });
});

describe('IntegrityMedal stylesheet', () => {
  const raw = readText('./IntegrityMedal.module.css', import.meta.url);

  it('never sets text below 1rem', () => {
    const sizes = raw.match(/font-size:\s*[^;]+/g) ?? [];
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size).toMatch(/rem\s*$/);
      expect(Number.parseFloat(size.replace(/font-size:\s*/, ''))).toBeGreaterThanOrEqual(1);
    }
  });

  it('takes the empty region out of the flow with no size, so it adds no space and no layout shift', () => {
    const empty = declarationsFor(parseCss(raw), '.empty', null);
    expect(empty['position']).toBe('absolute');
    expect(empty['width']).toBe('0');
    expect(empty['height']).toBe('0');
    expect(empty['display']).toBeUndefined();
    expect(empty['visibility']).toBeUndefined();
  });

  it('has no control, so no :hover rule and no motion', () => {
    expect(raw).not.toContain(':hover');
    expect(raw).not.toMatch(/animation|transition/);
    expect(parseCss(raw).length).toBeGreaterThan(0);
  });
});
