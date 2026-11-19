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
function curled(k: number, reduced = false): PawContext {
  let ctx = send(initialState(reduced), { type: 'grant_requested', text: 'a wish' }, grantReceivedEvent(grant(k)));
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

// The cue lines (Req 8.2: state labels persist). The preference is `ctx.reducedMotion`; SessionProvider keeps it in
// step with the media query (SessionProvider.motion.test.tsx), and App.reduced-motion.test.tsx runs the whole page.
const cue = (container: HTMLElement): string | null =>
  container.querySelector('[data-paw-finger-cue]')?.textContent ?? null;

/** The Verdict that closes `curseId`: the top finger opens. */
function close(ctx: PawContext, curseId: string): PawContext {
  const grantNow = ctx.grant as Grant;
  const closed: Grant = {
    ...grantNow,
    curses: grantNow.curses.map((c) => (c.id === curseId ? { ...c, status: 'closed' as const } : c)),
  };
  return send(
    ctx,
    { type: 'circle_activated', index: grantNow.curses.findIndex((c) => c.id === curseId) },
    { type: 'bind_submitted', kind: 'ears-clause', clause: 'IF x THEN THE SYSTEM SHALL y.' },
    { type: 'verdict_received', curseId, closed: true, reason: 'Sealed.', grant: closed },
  );
}

describe('PawStateText: the second line under reduced motion', () => {
  it('shows nothing extra without reduced motion, through a curl, a stop and an open', () => {
    const { container, rerender } = render(<PawStateText ctx={initialState(false)} />);
    expect(cue(container)).toBeNull();
    const ctx = curled(3);
    rerender(<PawStateText ctx={ctx} />);
    expect(cue(container)).toBeNull();
    rerender(<PawStateText ctx={close(ctx, 'c1')} />);
    expect(cue(container)).toBeNull();
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it('shows nothing before the first change, with reduced motion on', () => {
    const { container } = render(<PawStateText ctx={initialState(true)} />);
    expect(cue(container)).toBeNull();
    expect(container.textContent).toBe('The paw rests, all fingers open.');
  });

  it('says "Finger curled." after the grant lands, and keeps the existing caption as it is', () => {
    const { container, rerender } = render(<PawStateText ctx={initialState(true)} />);
    rerender(<PawStateText ctx={curled(3, true)} />);
    expect(cue(container)).toBe('Finger curled.');
    expect(container.querySelector('[data-paw-state-text]')?.textContent).toBe('3 fingers curled.');
  });

  it('says "Finger open." after an open, and the line stays until the next change', () => {
    const start = curled(3, true);
    const { container, rerender } = render(<PawStateText ctx={start} />);
    const afterOne = close(start, 'c2');
    rerender(<PawStateText ctx={afterOne} />);
    expect(cue(container)).toBe('Finger open.');
    expect(container.querySelector('[data-paw-state-text]')?.textContent).toBe('2 fingers curled.');

    // Re-rendering with other changes of the context (a card opening) is not a change of the fingers.
    rerender(<PawStateText ctx={send(afterOne, { type: 'circle_activated', index: 0 })} />);
    expect(cue(container)).toBe('Finger open.');

    // The next change replaces it.
    rerender(<PawStateText ctx={close(afterOne, 'c1')} />);
    expect(cue(container)).toBe('Finger open.');
    expect(container.querySelector('[data-paw-state-text]')?.textContent).toBe('1 finger curled.');
  });

  it('keeps the line after a stop, because no finger changed', () => {
    const start = curled(3, true);
    const { container, rerender } = render(<PawStateText ctx={start} />);
    rerender(<PawStateText ctx={close(start, 'c0')} />);
    rerender(<PawStateText ctx={send(close(start, 'c0'), { type: 'stop' })} />);
    expect(cue(container)).toBe('Finger open.');
  });

  it('says "Finger open." when the last finger opens and the paw rests', () => {
    let ctx = curled(3, true);
    const { container, rerender } = render(<PawStateText ctx={ctx} />);
    for (const id of ['c2', 'c1', 'c0']) {
      ctx = close(ctx, id);
      rerender(<PawStateText ctx={ctx} />);
    }
    expect(container.querySelector('[data-paw-state-text]')?.textContent).toBe('The paw rests.');
    expect(cue(container)).toBe('Finger open.');
  });

  it('clears the line on a rewrite', () => {
    const start = curled(3, true);
    const { container, rerender } = render(<PawStateText ctx={initialState(true)} />);
    rerender(<PawStateText ctx={start} />);
    expect(cue(container)).toBe('Finger curled.');
    rerender(<PawStateText ctx={send(start, { type: 'rewrite' })} />);
    expect(cue(container)).toBeNull();
    expect(container.textContent).toBe('The paw rests, all fingers open.');
  });

  it('shows no stale line when the preference turns on later, and none when it turns off', () => {
    const start = curled(3);
    const { container, rerender } = render(<PawStateText ctx={start} />);
    rerender(<PawStateText ctx={close(start, 'c2')} />);
    rerender(<PawStateText ctx={send(close(start, 'c2'), { type: 'motion_preference_changed', reduced: true })} />);
    expect(cue(container)).toBeNull();

    const reducedCtx = send(close(start, 'c2'), { type: 'motion_preference_changed', reduced: true });
    rerender(<PawStateText ctx={close(reducedCtx, 'c1')} />);
    expect(cue(container)).toBe('Finger open.');
    rerender(<PawStateText ctx={send(close(reducedCtx, 'c1'), { type: 'motion_preference_changed', reduced: false })} />);
    expect(cue(container)).toBeNull();
  });

  it('is plain visible text: not a live region, not hidden', () => {
    const { container, rerender } = render(<PawStateText ctx={initialState(true)} />);
    rerender(<PawStateText ctx={curled(3, true)} />);
    const node = container.querySelector('[data-paw-finger-cue]');
    expect(node).not.toBeNull();
    expect(node?.closest('[aria-hidden="true"]')).toBeNull();
    expect(node?.hasAttribute('aria-live')).toBe(false);
    expect(node?.hasAttribute('role')).toBe(false);
  });
});
