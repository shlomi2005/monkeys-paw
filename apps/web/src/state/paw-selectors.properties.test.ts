// Property tests for the view selectors (design.md P15 and the circle half of P16),
// written before the selectors. The joint half of P16 belongs to task 11.

import * as fc from 'fast-check';
import { computeIntegrity } from 'paw-core';
import type { Grant } from 'paw-core';
import { describe, expect, it } from 'vitest';
import {
  arbGrant,
  arbReachable,
  digitsUpTo,
  drain,
  grantReceivedEvent,
  numRuns,
  withClosed,
} from './arbitraries';
import { initialState, reduce } from './paw-machine';
import type { PawContext, PawEvent } from './paw-machine-types';
import {
  circleViews,
  curseTypeLabel,
  isQuiescent,
  medalFor,
  projectGrant,
  selectView,
} from './paw-selectors';

const RUNS = { numRuns: numRuns() };

function need<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

/** Reachable states as generated, and the same states after the machine settles. */
const arbReachableOrDrained: fc.Arbitrary<PawContext> = fc.oneof(
  arbReachable,
  arbReachable.map((ctx) => drain(ctx).ctx),
);

/** A round that closes a random non-empty subset of curses (all of them half the time), drained after each step. */
const arbClosedRound: fc.Arbitrary<PawContext> = fc
  .tuple(arbGrant, fc.boolean(), fc.boolean())
  .chain(([grant, reducedMotion, all]) => {
    const k = grant.curses.length;
    return fc
      .shuffledSubarray(digitsUpTo(k), { minLength: all ? k : 1, maxLength: k })
      .map((order) => closeInOrder(grant, reducedMotion, order));
  });

function apply(ctx: PawContext, event: PawEvent): PawContext {
  return reduce(ctx, event).ctx;
}

function closeInOrder(
  grant: Grant,
  reducedMotion: boolean,
  order: readonly number[],
): PawContext {
  let ctx = apply(initialState(reducedMotion), { type: 'grant_requested', text: 'a wish' });
  ctx = drain(apply(ctx, grantReceivedEvent(grant))).ctx;
  let current = ctx.grant ?? grant;
  for (const index of order) {
    const id = need(current.curses[index]).id;
    ctx = apply(ctx, { type: 'circle_activated', index });
    ctx = apply(ctx, { type: 'bind_submitted', kind: 'ears-clause', clause: 'the system shall do it' });
    current = withClosed(current, id);
    ctx = apply(ctx, {
      type: 'verdict_received',
      curseId: id,
      closed: true,
      reason: 'sealed',
      grant: current,
    });
    ctx = drain(ctx).ctx;
  }
  return ctx;
}

describe('P15: integrity matches paw-core (Req 6.8)', () => {
  const arbStates = fc.oneof(arbReachableOrDrained, arbClosedRound);

  it('medalFor equals computeIntegrity(projectGrant(ctx)) and follows the text format', () => {
    fc.assert(
      fc.property(arbStates, (ctx) => {
        const medal = medalFor(ctx);
        if (ctx.grant === null) {
          expect(medal).toBeNull();
          return;
        }
        const expected = computeIntegrity(need(projectGrant(ctx)));
        const m = need(medal);
        expect(m.score).toBe(expected.score);
        expect(m.closed).toBe(expected.closed);
        expect(m.open).toBe(expected.open);
        expect(m.closed + m.open).toBe(ctx.grant.curses.length);
        expect(m.score).toBe(Math.floor((m.closed / ctx.grant.curses.length) * 5));
        expect(m.text).toBe(`Integrity ${m.score}/5: ${m.closed} closed, ${m.open} open`);
      }),
      RUNS,
    );
  });

  it('projectGrant sets status from closedIds and leaves everything else alone', () => {
    fc.assert(
      fc.property(arbStates, (ctx) => {
        const projected = projectGrant(ctx);
        if (ctx.grant === null) {
          expect(projected).toBeNull();
          return;
        }
        const grant = need(projected);
        expect(grant.wishId).toBe(ctx.grant.wishId);
        expect(grant.narration).toBe(ctx.grant.narration);
        expect(grant.curses).toHaveLength(ctx.grant.curses.length);
        grant.curses.forEach((curse, i) => {
          const original = need(ctx.grant).curses[i];
          expect(curse.status).toBe(ctx.closedIds.includes(original.id) ? 'closed' : 'open');
          expect({ ...curse, status: original.status }).toEqual(original);
        });
      }),
      RUNS,
    );
  });

  it('score 5 with no open curse holds exactly when the round ended all-closed', () => {
    fc.assert(
      fc.property(arbStates, (ctx) => {
        const medal = medalFor(ctx);
        if (medal === null) return;
        expect(medal.score === 5 && medal.open === 0).toBe(ctx.endReason === 'all-closed');
      }),
      RUNS,
    );
  });

  it('the medal shows exactly when the round has ended and the machine is quiescent', () => {
    fc.assert(
      fc.property(arbStates, (ctx) => {
        const view = selectView(ctx);
        const visible = ctx.phase === 'ended' && isQuiescent(ctx);
        expect(view.medal !== null).toBe(visible);
        expect(view.showExport).toBe(view.medal !== null);
        if (view.medal !== null) expect(view.medal).toEqual(medalFor(ctx));
      }),
      RUNS,
    );
  });
});

describe('P16, circle half: circle i shows curse i (Req 5.2, 5.8)', () => {
  const arbStates = fc.oneof(arbReachableOrDrained, arbClosedRound);

  it('circles follow the Grant, closedIds and the curl queue', () => {
    fc.assert(
      fc.property(arbStates, (ctx) => {
        const circles = circleViews(ctx);
        expect(circles).toHaveLength(5);
        circles.forEach((circle, i) => expect(circle.index).toBe(i));
        const curses = ctx.grant?.curses ?? [];
        circles.forEach((circle, i) => {
          const curse = curses[i];
          if (curse === undefined) {
            expect(circle.status).toBe('empty');
            expect(circle.ariaLabel).toBe('');
            return;
          }
          expect(circle.status === 'closed').toBe(ctx.closedIds.includes(curse.id));
          if (circle.status === 'empty') {
            // Only a curse whose curl is still queued is blank, and only while curling.
            expect(ctx.phase).toBe('curling');
            expect(ctx.anim.queue.some((c) => c.kind === 'curl' && c.digit === i)).toBe(true);
            expect(circle.ariaLabel).toBe('');
          } else {
            expect(circle.ariaLabel.startsWith(curseTypeLabel(curse.type))).toBe(true);
          }
        });
      }),
      RUNS,
    );
  });

  it('circles at index >= k are empty, whatever the phase', () => {
    fc.assert(
      fc.property(arbStates, (ctx) => {
        const k = ctx.grant?.curses.length ?? 0;
        circleViews(ctx).forEach((circle, i) => {
          if (i >= k) expect(circle.status).toBe('empty');
        });
        expect(selectView(ctx).circles).toEqual(circleViews(ctx));
      }),
      RUNS,
    );
  });
});
