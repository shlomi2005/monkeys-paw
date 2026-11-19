// @vitest-environment jsdom
// PawStateText: the visible caption under the paw is the selector text, and it is not a live region.

import { cleanup, render } from '@testing-library/react';
import type { Grant } from 'paw-core';
import { afterEach, describe, expect, it } from 'vitest';
import { doneEventFor, grantReceivedEvent } from '../state/arbitraries';
import { initialState, reduce } from '../state/paw-machine';
import type { PawContext, PawEvent } from '../state/paw-machine-types';
import { fingerText } from '../state/paw-selectors';
import { PawStateText } from './PawStateText';

afterEach(cleanup);

function grant(k: number): Grant {
  const types = ['permissions', 'money', 'time', 'data-loss', 'edge-input'] as const;
  return {
    wishId: 'w',
    narration: 'Granted.',
    curses: Array.from({ length: k }, (_, i) => ({
      id: `c${i}`,
      type: types[i] ?? 'time',
      story: `Story ${i}.`,
      loophole: `Loophole ${i}.`,
      status: 'open' as const,
    })),
  };
}

function send(ctx: PawContext, ...events: PawEvent[]): PawContext {
  return events.reduce((current, event) => reduce(current, event).ctx, ctx);
}

/** A Grant of `k` curses with every curl finished. */
function curled(k: number): PawContext {
  let ctx = send(initialState(false), { type: 'grant_requested', text: 'a wish' }, grantReceivedEvent(grant(k)));
  for (let i = 0; i < 50 && ctx.anim.active !== null; i += 1) ctx = send(ctx, doneEventFor(ctx.anim.active));
  return ctx;
}

describe('PawStateText', () => {
  it('says the paw rests with all fingers open before any wish', () => {
    const { container } = render(<PawStateText ctx={initialState(false)} />);
    expect(container.textContent).toBe('The paw rests, all fingers open.');
  });

  it.each([
    [3, '3 fingers curled.'],
    [4, '4 fingers curled.'],
    [5, '5 fingers curled.'],
  ])('shows the selector text with %s curses curled', (k, text) => {
    const ctx = curled(k);
    const { container } = render(<PawStateText ctx={ctx} />);
    expect(container.textContent).toBe(text);
    expect(container.textContent).toBe(fingerText(ctx));
  });

  it('shows how many fingers stay curled after a stop', () => {
    const ctx = send(curled(3), { type: 'stop' });
    const { container } = render(<PawStateText ctx={ctx} />);
    expect(container.textContent).toBe(fingerText(ctx));
    expect(container.textContent).toMatch(/fingers? stays? curled\.|The paw rests\./);
  });

  it('follows the context when it changes', () => {
    const { container, rerender } = render(<PawStateText ctx={initialState(false)} />);
    rerender(<PawStateText ctx={curled(3)} />);
    expect(container.textContent).toBe('3 fingers curled.');
  });

  it('is visible text and not a live region', () => {
    const { container } = render(<PawStateText ctx={initialState(false)} />);
    const node = container.querySelector('[data-paw-state-text]');
    expect(node).not.toBeNull();
    expect(node?.closest('[aria-hidden="true"]')).toBeNull();
    expect(node?.hasAttribute('aria-live')).toBe(false);
    expect(node?.hasAttribute('role')).toBe(false);
    expect(node?.hasAttribute('hidden')).toBe(false);
  });
});
