// Property tests for the paw state machine (design.md P1-P11), written before the reducer.
// They fail with "not implemented" until task 6 implements `reduce`.

import * as fc from 'fast-check';
import type { Grant } from 'paw-core';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_MODEL,
  arbAnySession,
  arbBadGrant,
  arbGrant,
  arbIntent,
  arbReachable,
  digitsUpTo,
  doneEventFor,
  drain,
  grantReceivedEvent,
  lastContext,
  numRuns,
  runFrom,
  runModel,
  runSession,
  withClosed,
  wishFor,
} from './arbitraries';
import type { Step } from './arbitraries';
import { initialState, reduce } from './paw-machine';
import type {
  AnimCommand,
  Digit,
  PawContext,
  PawEffect,
  PawEvent,
  Phase,
  Transition,
} from './paw-machine-types';

const RUNS = { numRuns: numRuns() };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SnapEffect = Extract<PawEffect, { type: 'snap' }>;
type PlayEffect = Extract<PawEffect, { type: 'play' }>;

const REQUEST: PawEvent = { type: 'grant_requested', text: 'a wish' };
const REWRITE: PawEvent = { type: 'rewrite' };
const STOP: PawEvent = { type: 'stop' };

const snapsOf = (effects: readonly PawEffect[]): SnapEffect[] =>
  effects.filter((e): e is SnapEffect => e.type === 'snap');
const playsOf = (effects: readonly PawEffect[]): PlayEffect[] =>
  effects.filter((e): e is PlayEffect => e.type === 'play');
const hasEffect = (effects: readonly PawEffect[], type: PawEffect['type']): boolean =>
  effects.some((e) => e.type === type);

const isQuiescent = (ctx: PawContext): boolean =>
  ctx.anim.active === null && ctx.anim.queue.length === 0;

/** Snap amounts for a logical pose: 1 for each curled digit, 0 for the rest. */
function amountsFor(curled: readonly Digit[]): SnapEffect['amounts'] {
  const amount = (d: Digit): number => (curled.includes(d) ? 1 : 0);
  return [amount(0), amount(1), amount(2), amount(3), amount(4)];
}

function need<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

function step(before: PawContext, event: PawEvent): Step {
  const t: Transition = reduce(before, event);
  return { before, event, after: t.ctx, effects: t.effects };
}

/** Commands this step created, found in the effects or in the resulting animation state, in id order. */
function newCommands(s: Step): AnimCommand[] {
  const floor = s.before.anim.nextId;
  const found = new Map<number, AnimCommand>();
  for (const e of s.effects) {
    if (e.type === 'play' && e.command.id >= floor) found.set(e.command.id, e.command);
  }
  for (const c of [s.after.anim.active, ...s.after.anim.queue]) {
    if (c !== null && c.id >= floor) found.set(c.id, c);
  }
  return [...found.values()].sort((a, b) => a.id - b.id);
}

/** Digits a verdict step opens: from `open` commands, or from the snap under reduced motion. */
function openedDigits(s: Step): Digit[] {
  const snap = snapsOf(s.effects)[0];
  if (snap !== undefined) return s.before.curled.filter((d) => snap.amounts[d] === 0);
  return newCommands(s)
    .filter((c) => c.kind === 'open')
    .map((c) => need(c.digit));
}

/** Liveness (Gap 1): quiescent with a Grant, outside binding, judging and ended, the phase must be ready. */
function expectLiveness(ctx: PawContext): void {
  const exempt: readonly Phase[] = ['binding', 'judging', 'ended'];
  if (isQuiescent(ctx) && ctx.grant !== null && !exempt.includes(ctx.phase)) {
    expect(ctx.phase).toBe('ready');
  }
}

/** Request, receive, then (optionally) settle every curl. */
function grantRound(grant: Grant, reducedMotion: boolean, settle: boolean): { steps: Step[]; ctx: PawContext } {
  const steps: Step[] = [];
  let ctx = initialState(reducedMotion);
  for (const event of [REQUEST, grantReceivedEvent(grant)]) {
    const s = step(ctx, event);
    steps.push(s);
    ctx = s.after;
  }
  if (settle) {
    const d = drain(ctx);
    steps.push(...d.steps);
    ctx = d.ctx;
  }
  return { steps, ctx };
}

interface Route {
  readonly viaCard: boolean;
  readonly drainAfter: boolean;
}

const arbRoutes: fc.Arbitrary<Route[]> = fc.array(
  fc.record({ viaCard: fc.boolean(), drainAfter: fc.boolean() }),
  { minLength: 1, maxLength: 5 },
);

/** A Grant and a distinct set of its curse indexes in a random order. */
function arbGrantAndOrder(all: boolean): fc.Arbitrary<{ grant: Grant; order: number[] }> {
  return arbGrant.chain((grant) => {
    const k = grant.curses.length;
    return fc
      .shuffledSubarray(digitsUpTo(k), { minLength: all ? k : 1, maxLength: k })
      .map((order) => ({ grant, order }));
  });
}

/**
 * Grants, settles the curls, then closes the curses at `order` (each through the card or straight
 * from `ready`, with or without settling the animation in between). Returns the verdict steps.
 */
function closeInOrder(
  grant: Grant,
  reducedMotion: boolean,
  order: readonly number[],
  routes: readonly Route[],
): { steps: Step[]; verdicts: Step[]; ctx: PawContext } {
  const round = grantRound(grant, reducedMotion, true);
  const steps = [...round.steps];
  const verdicts: Step[] = [];
  let ctx = round.ctx;
  const push = (event: PawEvent): Step => {
    const s = step(ctx, event);
    steps.push(s);
    ctx = s.after;
    return s;
  };
  const settle = (): void => {
    const d = drain(ctx);
    steps.push(...d.steps);
    ctx = d.ctx;
  };
  order.forEach((index, n) => {
    const route = routes[n % routes.length];
    const curse = grant.curses[index];
    if (route.viaCard) {
      push({ type: 'circle_activated', index });
      push({ type: 'bind_submitted', kind: 'ears-clause', clause: 'The system shall close it.' });
    }
    verdicts.push(
      push({
        type: 'verdict_received',
        curseId: curse.id,
        closed: true,
        reason: 'closed',
        grant: withClosed(ctx.grant ?? grant, curse.id),
      }),
    );
    if (route.drainAfter) settle();
  });
  return { steps, verdicts, ctx };
}

/** The end of an all-closed round: one `open` then one `rest`, or one `rested` snap under reduced motion. */
function expectAllClosedEnding(s: Step, reducedMotion: boolean): void {
  expect(s.after.phase).toBe('ended');
  expect(s.after.endReason).toBe('all-closed');
  expect(s.after.curled).toEqual([]);
  if (reducedMotion) {
    const snaps = snapsOf(s.effects);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].amounts).toEqual([0, 0, 0, 0, 0]);
    expect(snaps[0].pose).toBe('rested');
    expect(playsOf(s.effects)).toEqual([]);
  } else {
    const commands = newCommands(s);
    expect(commands.map((c) => c.kind)).toEqual(['open', 'rest']);
    expect(commands[1].digit).toBeUndefined();
  }
}

// ---------------------------------------------------------------------------
// 5.1  P1 curl order, P2 LIFO, P3 finger-count invariant
// ---------------------------------------------------------------------------

describe('5.1 curl order, LIFO and finger count (P1-P3)', () => {
  it('P1 curl order: a Grant with k curses curls digits 0..k-1 in order, or one snap under reduced motion (Req 5.1, 5.2)', () => {
    fc.assert(
      fc.property(arbGrant, fc.boolean(), (grant, reducedMotion) => {
        const requested = step(initialState(reducedMotion), REQUEST);
        const received = step(requested.after, grantReceivedEvent(grant));
        const after = received.after;
        const k = grant.curses.length;

        expect(after.curled).toEqual(digitsUpTo(k));
        expect(after.closedIds).toEqual([]);
        expect(after.wish).toEqual(wishFor(grant));
        expect(after.grant?.curses.map((c) => c.id)).toEqual(grant.curses.map((c) => c.id));

        if (reducedMotion) {
          expect(after.phase).toBe('ready');
          expect(playsOf(received.effects)).toEqual([]);
          const snaps = snapsOf(received.effects);
          expect(snaps).toHaveLength(1);
          expect(snaps[0].amounts).toEqual(amountsFor(digitsUpTo(k)));
          expect(snaps[0].pose).toBe('upright');
          expect(isQuiescent(after)).toBe(true);
        } else {
          expect(after.phase).toBe('curling');
          expect(snapsOf(received.effects)).toEqual([]);
          const commands = newCommands(received);
          expect(commands).toEqual(
            digitsUpTo(k).map((digit, id) => ({ id, kind: 'curl', digit })),
          );
          expect(playsOf(received.effects)).toEqual([{ type: 'play', command: commands[0] }]);
          expect(after.anim.active).toEqual(commands[0]);
          expect(after.anim.queue).toEqual(commands.slice(1));
          expect(after.anim.nextId).toBe(k);
        }
      }),
      RUNS,
    );
  });

  it('Gap 2: a Grant without 3-5 curses received while granting acts like grant_failed (idle, no effects)', () => {
    fc.assert(
      fc.property(arbBadGrant, fc.boolean(), (grant, reducedMotion) => {
        const requested = step(initialState(reducedMotion), REQUEST);
        expect(requested.after.phase).toBe('granting');
        const received = step(requested.after, grantReceivedEvent(grant));
        expect(received.after.phase).toBe('idle');
        expect(received.effects).toEqual([]);
        expect(received.after.grant).toBeNull();
        expect(received.after.wish).toBeNull();
        expect(received.after.curled).toEqual([]);
        expect(received.after.closedIds).toEqual([]);
        expect(isQuiescent(received.after)).toBe(true);
        expect(received.after.anim.nextId).toBe(0);
      }),
      RUNS,
    );
  });

  it('P2 LIFO (reference model): every accepted close opens the previous top of the stack, over any session (Req 5.3, 6.1)', () => {
    fc.assert(
      fc.property(arbAnySession, (session) => {
        const steps = runSession(session);
        const models = runModel(steps);
        steps.forEach((s, i) => {
          if (s.event.type !== 'verdict_received') return;
          const prev = i === 0 ? EMPTY_MODEL : models[i - 1];
          const m = models[i];
          if (!m.closeAccepted) {
            // Not accepted: nothing opens, nothing animates, the stack stays put.
            expect(openedDigits(s)).toEqual([]);
            expect(playsOf(s.effects)).toEqual([]);
            expect(snapsOf(s.effects)).toEqual([]);
            expect(s.after.curled).toEqual(s.before.curled);
            return;
          }
          expect(s.before.curled).toEqual(prev.stack);
          expect(need(m.popped)).toBe(prev.stack[prev.stack.length - 1]);
          expect(s.after.curled).toEqual(m.stack);
          expect(openedDigits(s)).toEqual([m.popped]);
          if (m.ended === 'all-closed') {
            expectAllClosedEnding(s, s.after.reducedMotion);
          } else if (s.after.reducedMotion) {
            const snaps = snapsOf(s.effects);
            expect(snaps).toHaveLength(1);
            expect(snaps[0].amounts).toEqual(amountsFor(m.stack));
            expect(snaps[0].pose).toBe('upright');
          } else {
            expect(newCommands(s).map((c) => c.kind)).toEqual(['open']);
          }
        });
      }),
      RUNS,
    );
  });

  it('P2 LIFO (directed): closing in any order, through the card or not, opens digits k-1, k-2, ... (Req 5.3, 6.1)', () => {
    fc.assert(
      fc.property(arbGrantAndOrder(false), fc.boolean(), arbRoutes, ({ grant, order }, reducedMotion, routes) => {
        const k = grant.curses.length;
        const { verdicts } = closeInOrder(grant, reducedMotion, order, routes);
        expect(verdicts).toHaveLength(order.length);
        verdicts.forEach((s, n) => {
          expect(openedDigits(s)).toEqual([k - 1 - n]);
          expect(s.after.curled).toEqual(digitsUpTo(k - 1 - n));
          if (n === k - 1) expectAllClosedEnding(s, reducedMotion);
        });
      }),
      RUNS,
    );
  });

  it('P2 LIFO (thumb opens last): closing every curse in any order opens digit 0 last (Req 5.3, Glossary)', () => {
    fc.assert(
      fc.property(arbGrantAndOrder(true), fc.boolean(), arbRoutes, ({ grant, order }, reducedMotion, routes) => {
        const k = grant.curses.length;
        const { verdicts, ctx } = closeInOrder(grant, reducedMotion, order, routes);
        const opened = verdicts.flatMap((s) => openedDigits(s));
        expect(opened).toEqual(digitsUpTo(k).reverse());
        expect(opened[opened.length - 1]).toBe(0);
        expect(ctx.phase).toBe('ended');
        expect(ctx.endReason).toBe('all-closed');
      }),
      RUNS,
    );
  });

  it('P3 finger-count invariant: curled matches the model, and after drain curled.length equals the open curses (Req 5.6)', () => {
    fc.assert(
      fc.property(arbAnySession, (session) => {
        const steps = runSession(session);
        const models = runModel(steps);
        steps.forEach((s, i) => {
          expect(s.after.curled).toEqual(models[i].stack);
          if (s.after.grant !== null) {
            expect(s.after.curled.length).toBe(s.after.grant.curses.length - s.after.closedIds.length);
          }
          expectLiveness(s.after);
        });
        const drained = drain(lastContext(steps, initialState(session.reducedMotion)));
        const end = drained.ctx;
        expect(isQuiescent(end)).toBe(true);
        expect(end.curled).toEqual((models.length === 0 ? EMPTY_MODEL : models[models.length - 1]).stack);
        if (end.grant !== null) {
          expect(end.curled.length).toBe(end.grant.curses.length - end.closedIds.length);
        }
        expectLiveness(end);
      }),
      RUNS,
    );
  });

  it('P3 liveness (Gap 1): turning reduced motion on while curling clears the queue, emits the snap and moves to ready (Req 5.6, 2.9)', () => {
    fc.assert(
      fc.property(arbGrant, fc.nat(4), (grant, n) => {
        const k = grant.curses.length;
        let ctx = grantRound(grant, false, false).ctx;
        for (let i = 0; i < n % k; i += 1) ctx = step(ctx, doneEventFor(need(ctx.anim.active))).after;
        expect(ctx.phase).toBe('curling');
        expect(isQuiescent(ctx)).toBe(false);

        const s = step(ctx, { type: 'motion_preference_changed', reduced: true });
        expect(s.after.reducedMotion).toBe(true);
        expect(s.after.phase).toBe('ready');
        expect(isQuiescent(s.after)).toBe(true);
        expect(s.after.curled).toEqual(digitsUpTo(k));
        expect(playsOf(s.effects)).toEqual([]);
        const snaps = snapsOf(s.effects);
        expect(snaps).toHaveLength(1);
        expect(snaps[0].amounts).toEqual(amountsFor(digitsUpTo(k)));
        expect(snaps[0].pose).toBe('upright');
        expectLiveness(s.after);
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// 5.2  P4 idempotent close, P5 failed verdict, P7 circles equal the closed set
// ---------------------------------------------------------------------------

describe('5.2 closing rules and circles (P4, P5, P7)', () => {
  it('P4 idempotent close: a second close of a closed curse changes nothing and animates nothing (Req 5.7)', () => {
    fc.assert(
      fc.property(
        arbGrantAndOrder(false),
        fc.boolean(),
        arbRoutes,
        fc.nat(9),
        ({ grant, order }, reducedMotion, routes, pick) => {
          const { ctx } = closeInOrder(grant, reducedMotion, order, routes);
          expect(ctx.closedIds.length).toBeGreaterThan(0);
          const target = ctx.closedIds[pick % ctx.closedIds.length];
          const s = step(ctx, {
            type: 'verdict_received',
            curseId: target,
            closed: true,
            reason: 'closed again',
            grant: withClosed(need(ctx.grant), target),
          });
          expect(s.after.curled).toEqual(ctx.curled);
          expect(s.after.closedIds).toEqual(ctx.closedIds);
          expect(s.after.grant).toEqual(ctx.grant);
          expect(s.after.anim).toEqual(ctx.anim);
          for (const type of ['play', 'snap', 'request-bind'] as const) {
            expect(hasEffect(s.effects, type)).toBe(false);
          }
        },
      ),
      RUNS,
    );

    // Same rule on arbitrary sessions: a repeated close in the trace never pops or animates.
    fc.assert(
      fc.property(arbAnySession, (session) => {
        for (const s of runSession(session)) {
          if (s.event.type !== 'verdict_received' || !s.event.closed) continue;
          if (!s.before.closedIds.includes(s.event.curseId)) continue;
          expect(s.after.curled).toEqual(s.before.curled);
          expect(s.after.closedIds).toEqual(s.before.closedIds);
          expect(s.after.grant).toEqual(s.before.grant);
          expect(s.after.anim).toEqual(s.before.anim);
          for (const type of ['play', 'snap', 'request-bind'] as const) {
            expect(hasEffect(s.effects, type)).toBe(false);
          }
        }
      }),
      RUNS,
    );
  });

  it('P5 failed verdict: closed false leaves curled, closedIds, grant, anim and endReason alone (Req 5.5, 4.3)', () => {
    fc.assert(
      fc.property(arbReachable, arbGrant, fc.nat(9), (ctx, fallback, pick) => {
        const grant = ctx.grant ?? fallback;
        const ids = [
          ...grant.curses.map((c) => c.id),
          'unknown-curse',
          ...(ctx.pendingCurseId === null ? [] : [ctx.pendingCurseId]),
        ];
        const s = step(ctx, {
          type: 'verdict_received',
          curseId: ids[pick % ids.length],
          closed: false,
          reason: 'still open',
          grant,
        });
        expect(s.after.curled).toEqual(ctx.curled);
        expect(s.after.closedIds).toEqual(ctx.closedIds);
        expect(s.after.grant).toEqual(ctx.grant);
        expect(s.after.anim).toEqual(ctx.anim);
        expect(s.after.endReason).toEqual(ctx.endReason);
        expect(playsOf(s.effects)).toEqual([]);
        expect(snapsOf(s.effects)).toEqual([]);
      }),
      RUNS,
    );
  });

  it('P7 circles equal the closed set (reference model): circle i is closed exactly when curse i was accepted closed (Req 5.8, 4.3)', () => {
    fc.assert(
      fc.property(arbAnySession, (session) => {
        const steps = runSession(session);
        const models = runModel(steps);
        steps.forEach((s, i) => {
          const closedIds = s.after.closedIds;
          expect(new Set(closedIds).size).toBe(closedIds.length);
          expect(new Set(closedIds)).toEqual(models[i].closed);
          const curses = s.after.grant?.curses ?? [];
          for (let circle = 0; circle < 5; circle += 1) {
            const curse = curses[circle];
            const shownClosed = curse !== undefined && closedIds.includes(curse.id);
            const expected = curse !== undefined && models[i].closed.has(curse.id);
            expect(shownClosed).toBe(expected);
          }
        });
      }),
      RUNS,
    );
  });

  it('P7 circles are independent of the stack: any close order gives the same closed set and the same stack (Req 5.8)', () => {
    fc.assert(
      fc.property(arbGrantAndOrder(false), fc.boolean(), arbRoutes, ({ grant, order }, reducedMotion, routes) => {
        const k = grant.curses.length;
        const forward = closeInOrder(grant, reducedMotion, order, routes).ctx;
        const backward = closeInOrder(grant, reducedMotion, [...order].reverse(), routes).ctx;
        const expectedIds = order.map((i) => grant.curses[i].id);
        expect(new Set(forward.closedIds)).toEqual(new Set(expectedIds));
        expect(new Set(backward.closedIds)).toEqual(new Set(expectedIds));
        expect(forward.curled).toEqual(digitsUpTo(k - order.length));
        expect(backward.curled).toEqual(forward.curled);
        grant.curses.forEach((curse, circle) => {
          expect(forward.closedIds.includes(curse.id)).toBe(order.includes(circle));
        });
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// 5.3  P6 one active animation, P11 reduced motion never queues
// ---------------------------------------------------------------------------

describe('5.3 one animation at a time, reduced motion (P6, P11)', () => {
  it('P6 one active animation: at most one command is active, and plays minus accepted dones stay in 0..1 (Req 5.4, 2.7)', () => {
    fc.assert(
      fc.property(arbAnySession, (session) => {
        let playing = 0;
        for (const s of runSession(session)) {
          const { active, queue, nextId } = s.after.anim;

          // State form: one active command, unique increasing ids, one digit per curl or open.
          const commands = active === null ? [...queue] : [active, ...queue];
          const ids = commands.map((c) => c.id);
          expect(new Set(ids).size).toBe(ids.length);
          expect([...ids].sort((a, b) => a - b)).toEqual(ids);
          for (const id of ids) expect(id).toBeLessThan(nextId);
          for (const c of commands) {
            if (c.kind === 'rest') expect(c.digit).toBeUndefined();
            else expect([0, 1, 2, 3, 4]).toContain(c.digit);
          }
          if (active === null) expect(queue).toEqual([]);

          // Effect-stream form.
          const e = s.event;
          const before = s.before.anim.active;
          const acceptedDone =
            before !== null &&
            (e.type === 'curl_done' || e.type === 'open_done' || e.type === 'rest_done') &&
            e.type === doneEventFor(before).type &&
            e.id === before.id;
          if (acceptedDone) playing -= 1;
          if (e.type === 'rewrite') playing = 0;
          for (const effect of s.effects) {
            if (effect.type === 'snap') playing = 0;
            if (effect.type === 'play') playing += 1;
          }
          expect(playing).toBeGreaterThanOrEqual(0);
          expect(playing).toBeLessThanOrEqual(1);
          expect(playsOf(s.effects).length).toBeLessThanOrEqual(1);
          if (playsOf(s.effects).length === 1) {
            expect(s.after.anim.active).toEqual(playsOf(s.effects)[0].command);
          }
        }
      }),
      RUNS,
    );
  });

  it('P11 reduced motion never queues: no play effect, no active command, an empty queue (Req 2.9, 6.1)', () => {
    fc.assert(
      fc.property(arbAnySession, (session) => {
        for (const s of runSession(session)) {
          if (!s.after.reducedMotion) continue;
          expect(playsOf(s.effects)).toEqual([]);
          expect(s.after.anim.active).toBeNull();
          expect(s.after.anim.queue).toEqual([]);
        }
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// 5.4  P8 lock after the end, P9 rewrite equals initialState, P10 stop
// ---------------------------------------------------------------------------

const LOCKED_EVENTS: readonly PawEvent['type'][] = [
  'circle_activated',
  'bind_submitted',
  'verdict_received',
  'stop',
  'grant_requested',
];

/** From the end of a round until `rewrite`, the locked events change nothing and no request-bind is emitted. */
function expectLocked(steps: readonly Step[]): void {
  for (const s of steps) {
    if (s.before.phase !== 'ended') continue;
    expect(hasEffect(s.effects, 'request-bind')).toBe(false);
    if (!LOCKED_EVENTS.includes(s.event.type)) continue;
    expect(s.after.phase).toBe('ended');
    expect(s.after.endReason).toEqual(s.before.endReason);
    expect(s.after.curled).toEqual(s.before.curled);
    expect(s.after.closedIds).toEqual(s.before.closedIds);
    expect(s.after.grant).toEqual(s.before.grant);
  }
}

function expectStopped(before: PawContext, t: Transition): void {
  const after = t.ctx;
  expect(after.phase).toBe('ended');
  expect(after.endReason).toBe('stopped');
  expect(after.anim.active).toBeNull();
  expect(after.anim.queue).toEqual([]);
  expect(after.curled).toEqual(before.curled);
  expect(after.closedIds).toEqual(before.closedIds);
  expect(after.pendingCurseId).toBeNull();
  expect(playsOf(t.effects)).toEqual([]);
  const snaps = snapsOf(t.effects);
  expect(snaps).toHaveLength(1);
  expect(snaps[0].amounts).toEqual(amountsFor(before.curled));
  expect(snaps[0].pose).toBe('upright');
  expect(t.effects.filter((e) => e.type === 'abort-requests')).toHaveLength(before.phase === 'judging' ? 1 : 0);
  expect(hasEffect(t.effects, 'request-bind')).toBe(false);
}

describe('5.4 lock after the end, rewrite, stop (P8-P10)', () => {
  it('P8 lock after the end (random sessions): no request-bind, and locked events change nothing (Req 6.9)', () => {
    fc.assert(
      fc.property(arbAnySession, (session) => {
        const steps = runSession(session);
        expectLocked(steps);
        runModel(steps).forEach((m, i) => {
          expect(steps[i].after.phase === 'ended').toBe(m.ended !== null);
        });
      }),
      RUNS,
    );
  });

  it('P8 lock after the end (directed): after Stop or after all-closed, any further events change nothing (Req 6.9)', () => {
    const arbLockedIntents = fc.array(
      arbIntent.filter((intent) => intent.kind !== 'rewrite'),
      { minLength: 1, maxLength: 40 },
    );
    fc.assert(
      fc.property(
        arbGrantAndOrder(true),
        fc.boolean(),
        fc.boolean(),
        fc.nat(5),
        arbRoutes,
        arbLockedIntents,
        ({ grant, order }, reducedMotion, viaStop, settled, routes, intents) => {
          let ended: PawContext;
          if (viaStop) {
            let ctx = grantRound(grant, reducedMotion, false).ctx;
            for (let i = 0; i < settled; i += 1) {
              if (ctx.anim.active !== null) ctx = step(ctx, doneEventFor(ctx.anim.active)).after;
            }
            ended = step(ctx, STOP).after;
            expect(ended.endReason).toBe('stopped');
          } else {
            ended = closeInOrder(grant, reducedMotion, order, routes).ctx;
            expect(ended.endReason).toBe('all-closed');
          }
          expect(ended.phase).toBe('ended');
          const steps = runFrom(ended, intents);
          expectLocked(steps);
          for (const s of steps) {
            expect(s.after.phase).toBe('ended');
            expect(s.after.curled).toEqual(ended.curled);
            expect(s.after.closedIds).toEqual(ended.closedIds);
          }
        },
      ),
      RUNS,
    );
  });

  it('P9 rewrite resets: from any reachable state the context equals initialState (Req 4.4, 6.1)', () => {
    fc.assert(
      fc.property(arbReachable, (ctx) => {
        const t = reduce(ctx, REWRITE);
        expect(t.ctx).toStrictEqual(initialState(ctx.reducedMotion));
      }),
      RUNS,
    );
  });

  it('P10 stop: from curling, ready, binding or judging it ends stopped with one snap of the logical pose (Req 6.7, 6.10)', () => {
    const stoppable: readonly Phase[] = ['curling', 'ready', 'binding', 'judging'];
    fc.assert(
      fc.property(
        arbReachable.filter((ctx) => stoppable.includes(ctx.phase)),
        (ctx) => {
          expectStopped(ctx, reduce(ctx, STOP));
        },
      ),
      RUNS,
    );
  });

  it('P10 stop during queued curls: remaining curls complete instantly, one curled digit per open curse (Req 6.10)', () => {
    fc.assert(
      fc.property(arbGrant, fc.nat(4), (grant, n) => {
        const k = grant.curses.length;
        let ctx = grantRound(grant, false, false).ctx;
        for (let i = 0; i < n % k; i += 1) ctx = step(ctx, doneEventFor(need(ctx.anim.active))).after;
        expect(ctx.phase).toBe('curling');
        expect(ctx.anim.active).not.toBeNull();
        const t = reduce(ctx, STOP);
        expectStopped(ctx, t);
        const amounts = snapsOf(t.effects)[0].amounts;
        expect(amounts.reduce((sum, a) => sum + a, 0)).toBe(k - ctx.closedIds.length);
      }),
      RUNS,
    );
  });

  it('P10 stop during an open animation: the open finishes instantly, curled digits stay curled (Req 6.7, 6.10)', () => {
    fc.assert(
      fc.property(arbGrant, fc.nat(10), fc.boolean(), (grant, n, viaCard) => {
        const k = grant.curses.length;
        const closes = 1 + (n % (k - 1));
        const { ctx } = closeInOrder(grant, false, digitsUpTo(closes), [{ viaCard, drainAfter: false }]);
        expect(ctx.anim.active?.kind).toBe('open');
        expect(ctx.phase).toBe('ready');
        const t = reduce(ctx, STOP);
        expectStopped(ctx, t);
        expect(t.ctx.curled).toEqual(digitsUpTo(k - closes));
      }),
      RUNS,
    );
  });

  it('P10 stop is ignored when no Grant is active (idle, granting) (Req 6.6)', () => {
    fc.assert(
      fc.property(fc.boolean(), (reducedMotion) => {
        const idle = initialState(reducedMotion);
        const stoppedIdle = reduce(idle, STOP);
        expect(stoppedIdle.ctx).toStrictEqual(idle);
        expect(stoppedIdle.effects).toEqual([]);

        const granting = step(idle, REQUEST).after;
        expect(granting.phase).toBe('granting');
        const stoppedGranting = reduce(granting, STOP);
        expect(stoppedGranting.ctx).toStrictEqual(granting);
        expect(stoppedGranting.effects).toEqual([]);
      }),
      RUNS,
    );
  });
});
