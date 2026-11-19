// Example-based tests for the paw state machine: one `it` per row of the transition table in
// design.md section 5 (including the two rows added for reduced motion and an invalid Grant),
// the verdict rules, and the three worked scenarios of task 7.

import type { BindingKind, Grant } from 'paw-core';
import { describe, expect, it } from 'vitest';
import { digitsUpTo, doneEventFor, grantReceivedEvent, withClosed } from './arbitraries';
import { initialState, reduce } from './paw-machine';
import type { AnimCommand, Digit, PawContext, PawEffect, PawEvent, Transition } from './paw-machine-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type SnapEffect = Extract<PawEffect, { type: 'snap' }>;

function makeGrant(k: number): Grant {
  return {
    wishId: 'wish-1',
    narration: 'Granted.',
    curses: Array.from({ length: k }, (_, i) => ({
      id: `curse-${i}`,
      type: 'permissions' as const,
      story: `Story ${i}.`,
      loophole: `Loophole ${i}.`,
      status: 'open' as const,
    })),
  };
}

const KIND: BindingKind = 'ears-clause';
const CLAUSE = 'The system shall close it.';
const REQUEST: PawEvent = { type: 'grant_requested', text: 'a wish' };
const STOP: PawEvent = { type: 'stop' };
const REWRITE: PawEvent = { type: 'rewrite' };
const NO_EFFECTS: readonly PawEffect[] = [];

function snapOf(curled: readonly Digit[], pose: SnapEffect['pose']): SnapEffect {
  const amount = (d: Digit): number => (curled.includes(d) ? 1 : 0);
  return { type: 'snap', amounts: [amount(0), amount(1), amount(2), amount(3), amount(4)], pose };
}

const ZEROS_UPRIGHT = snapOf([], 'upright');

function need<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

function grantOf(ctx: PawContext): Grant {
  return need(ctx.grant);
}

function curseId(ctx: PawContext, index: number): string {
  return grantOf(ctx).curses[index].id;
}

/** Completes the active command until nothing is active. Does not touch `judging`. */
function settle(start: PawContext): PawContext {
  let ctx = start;
  for (let i = 0; i < 50 && ctx.anim.active !== null; i += 1) {
    ctx = reduce(ctx, doneEventFor(ctx.anim.active)).ctx;
  }
  expect(ctx.anim.active).toBeNull();
  return ctx;
}

/** A Grant with k curses has just arrived: phase `curling`, k curls queued, the first one playing. */
function curling(k: number): PawContext {
  const granting = reduce(initialState(false), REQUEST).ctx;
  return reduce(granting, grantReceivedEvent(makeGrant(k))).ctx;
}

/** All curls have landed, no card open. With `reduced`, the Grant lands with one snap. */
function ready(k: number, reduced = false): PawContext {
  if (reduced) {
    const granting = reduce(initialState(true), REQUEST).ctx;
    return reduce(granting, grantReceivedEvent(makeGrant(k))).ctx;
  }
  return settle(curling(k));
}

function binding(k: number, index: number, reduced = false): PawContext {
  return reduce(ready(k, reduced), { type: 'circle_activated', index }).ctx;
}

function judging(k: number, index: number, reduced = false): PawContext {
  return reduce(binding(k, index, reduced), { type: 'bind_submitted', kind: KIND, clause: CLAUSE }).ctx;
}

function verdict(ctx: PawContext, index: number, closed: boolean): PawEvent {
  const id = curseId(ctx, index);
  return {
    type: 'verdict_received',
    curseId: id,
    closed,
    reason: 'a reason',
    grant: closed ? withClosed(grantOf(ctx), id) : grantOf(ctx),
  };
}

/** Closes every curse in `order` straight from `ready`, completing each animation. Returns the ending context. */
function closeAll(k: number, order: readonly number[], reduced = false): PawContext {
  let ctx = ready(k, reduced);
  for (const index of order) ctx = settle(reduce(ctx, verdict(ctx, index, true)).ctx);
  return ctx;
}

function ended(k: number, reason: 'stopped' | 'all-closed'): PawContext {
  return reason === 'stopped' ? reduce(ready(k), STOP).ctx : closeAll(k, digitsUpTo(k));
}

function expectIgnored(ctx: PawContext, event: PawEvent): void {
  const t = reduce(ctx, event);
  expect(t.ctx).toBe(ctx);
  expect(t.effects).toEqual(NO_EFFECTS);
}

function expectAllIgnored(ctx: PawContext, events: readonly PawEvent[]): void {
  for (const event of events) expectIgnored(ctx, event);
}

function playedCommand(t: Transition): AnimCommand {
  const plays = t.effects.filter((e) => e.type === 'play');
  expect(plays).toHaveLength(1);
  return (plays[0] as Extract<PawEffect, { type: 'play' }>).command;
}

/** An event of every type, valid for `ctx` where that makes sense. Used for "ignored" rows. */
function everyEventExcept(ctx: PawContext, skip: readonly PawEvent['type'][]): PawEvent[] {
  const grant = ctx.grant ?? makeGrant(3);
  const all: PawEvent[] = [
    REQUEST,
    grantReceivedEvent(grant),
    { type: 'grant_failed' },
    { type: 'curl_done', id: 99 },
    { type: 'open_done', id: 99 },
    { type: 'rest_done', id: 99 },
    { type: 'circle_activated', index: 0 },
    { type: 'card_closed' },
    { type: 'bind_submitted', kind: KIND, clause: CLAUSE },
    {
      type: 'verdict_received',
      curseId: grant.curses[0].id,
      closed: true,
      reason: 'r',
      grant: withClosed(grant, grant.curses[0].id),
    },
    { type: 'bind_failed' },
    STOP,
    REWRITE,
  ];
  return all.filter((e) => !skip.includes(e.type));
}

// ---------------------------------------------------------------------------
// Transition table: idle
// ---------------------------------------------------------------------------

describe('table: idle', () => {
  it('idle + grant_requested (non-blank text) -> granting, request-grant', () => {
    const t = reduce(initialState(false), { type: 'grant_requested', text: 'only owners delete', context: 'a CRM' });
    expect(t.ctx.phase).toBe('granting');
    expect(t.effects).toEqual([{ type: 'request-grant', text: 'only owners delete', context: 'a CRM' }]);
    expect(t.ctx.anim).toEqual(initialState(false).anim);
  });

  it('idle + grant_requested without context omits the context field', () => {
    const t = reduce(initialState(false), REQUEST);
    expect(t.effects).toEqual([{ type: 'request-grant', text: 'a wish' }]);
  });

  it('idle + grant_requested (blank text) is ignored', () => {
    for (const text of ['', '   ', '\t\n']) expectIgnored(initialState(false), { type: 'grant_requested', text });
  });

  it('idle + rewrite and every other event is ignored', () => {
    expectAllIgnored(initialState(false), everyEventExcept(initialState(false), ['grant_requested']));
  });
});

// ---------------------------------------------------------------------------
// Transition table: granting
// ---------------------------------------------------------------------------

describe('table: granting', () => {
  const granting = reduce(initialState(false), REQUEST).ctx;

  it('granting + grant_received (3-5 curses) -> curling, k curls enqueued, the first one played', () => {
    for (const k of [3, 4, 5]) {
      const grant = makeGrant(k);
      const t = reduce(granting, grantReceivedEvent(grant));
      expect(t.ctx.phase).toBe('curling');
      expect(t.ctx.grant).toEqual(grant);
      expect(t.ctx.wish).toEqual({ id: 'wish-1', text: 'a test wish', createdAt: 0 });
      expect(t.ctx.closedIds).toEqual([]);
      expect(t.ctx.curled).toEqual(digitsUpTo(k));
      const commands = digitsUpTo(k).map((digit, id): AnimCommand => ({ id, kind: 'curl', digit }));
      expect(t.ctx.anim).toEqual({ active: commands[0], queue: commands.slice(1), nextId: k });
      expect(t.effects).toEqual([{ type: 'play', command: commands[0] }]);
    }
  });

  it('granting + grant_received starts every curse open, whatever status the Grant carries', () => {
    const grant = makeGrant(4);
    const withStatus: Grant = { ...grant, curses: grant.curses.map((c) => ({ ...c, status: 'closed' as const })) };
    const t = reduce(granting, grantReceivedEvent(withStatus));
    expect(t.ctx.closedIds).toEqual([]);
    expect(t.ctx.curled).toEqual(digitsUpTo(4));
  });

  it('granting + grant_received with reduced motion -> ready, one snap, nothing queued', () => {
    const reducedGranting = reduce(initialState(true), REQUEST).ctx;
    const t = reduce(reducedGranting, grantReceivedEvent(makeGrant(4)));
    expect(t.ctx.phase).toBe('ready');
    expect(t.ctx.curled).toEqual(digitsUpTo(4));
    expect(t.ctx.anim).toEqual({ active: null, queue: [], nextId: 0 });
    expect(t.effects).toEqual([snapOf(digitsUpTo(4), 'upright')]);
  });

  it('granting + grant_received (not 3-5 curses) -> idle, handled like grant_failed (added row)', () => {
    for (const k of [0, 1, 2, 6]) {
      const t = reduce(granting, grantReceivedEvent(makeGrant(k)));
      expect(t.ctx).toEqual(initialState(false));
      expect(t.effects).toEqual(NO_EFFECTS);
    }
  });

  it('granting + grant_failed -> idle', () => {
    const t = reduce(granting, { type: 'grant_failed' });
    expect(t.ctx).toEqual(initialState(false));
    expect(t.effects).toEqual(NO_EFFECTS);
  });

  it('granting + rewrite -> idle, reset to initial, abort-requests', () => {
    const t = reduce(granting, REWRITE);
    expect(t.ctx).toEqual(initialState(false));
    expect(t.effects).toEqual([{ type: 'abort-requests' }]);
  });

  it('granting + stop, a second request and every other event is ignored', () => {
    const skip: PawEvent['type'][] = ['grant_received', 'grant_failed', 'rewrite'];
    expectAllIgnored(granting, everyEventExcept(granting, skip));
  });
});

// ---------------------------------------------------------------------------
// Transition table: curling
// ---------------------------------------------------------------------------

describe('table: curling', () => {
  it('curling + curl_done (matches active) -> curling, the queue advances, next play', () => {
    const start = curling(3);
    const t = reduce(start, doneEventFor(need(start.anim.active)));
    expect(t.ctx.phase).toBe('curling');
    expect(t.ctx.anim.active).toEqual({ id: 1, kind: 'curl', digit: 1 });
    expect(t.ctx.anim.queue).toEqual([{ id: 2, kind: 'curl', digit: 2 }]);
    expect(t.effects).toEqual([{ type: 'play', command: { id: 1, kind: 'curl', digit: 1 } }]);
  });

  it('curling + curl_done of the last curl -> ready once quiescent', () => {
    let ctx = curling(3);
    for (let i = 0; i < 3; i += 1) {
      expect(ctx.phase).toBe('curling');
      ctx = reduce(ctx, doneEventFor(need(ctx.anim.active))).ctx;
    }
    expect(ctx.phase).toBe('ready');
    expect(ctx.anim).toEqual({ active: null, queue: [], nextId: 3 });
  });

  it('curling + curl_done that does not match the active command (wrong id or wrong kind) is ignored', () => {
    const start = curling(3);
    expectIgnored(start, { type: 'curl_done', id: 2 });
    expectIgnored(start, { type: 'curl_done', id: 7 });
    expectIgnored(start, { type: 'open_done', id: 0 });
    expectIgnored(start, { type: 'rest_done', id: 0 });
  });

  it('curling + stop -> ended (stopped), queue and active cleared, snap of the curled digits', () => {
    const start = curling(4);
    const t = reduce(start, STOP);
    expect(t.ctx.phase).toBe('ended');
    expect(t.ctx.endReason).toBe('stopped');
    expect(t.ctx.anim).toEqual({ active: null, queue: [], nextId: 4 });
    expect(t.ctx.curled).toEqual(digitsUpTo(4));
    expect(t.effects).toEqual([snapOf(digitsUpTo(4), 'upright')]);
  });

  it('curling + circle_activated is ignored (the circles are arriving)', () => {
    const start = curling(3);
    for (const index of [0, 1, 2, 3, -1]) expectIgnored(start, { type: 'circle_activated', index });
  });

  it('curling + motion_preference_changed (reduced true) -> ready, anim cleared, snap(curled, upright) (added row)', () => {
    const start = reduce(curling(4), doneEventFor({ id: 0, kind: 'curl', digit: 0 })).ctx;
    expect(start.anim.queue.length).toBeGreaterThan(0);
    const t = reduce(start, { type: 'motion_preference_changed', reduced: true });
    expect(t.ctx.phase).toBe('ready');
    expect(t.ctx.reducedMotion).toBe(true);
    expect(t.ctx.anim).toEqual({ active: null, queue: [], nextId: 4 });
    expect(t.ctx.curled).toEqual(digitsUpTo(4));
    expect(t.effects).toEqual([snapOf(digitsUpTo(4), 'upright')]);
  });

  it('curling + rewrite -> idle, reset to initial, snap(zeros, upright)', () => {
    const t = reduce(curling(4), REWRITE);
    expect(t.ctx).toEqual(initialState(false));
    expect(t.ctx.anim.nextId).toBe(0);
    expect(t.effects).toEqual([ZEROS_UPRIGHT]);
  });

  it('curling ignores the other events (bind, verdict, card, a second grant)', () => {
    const start = curling(3);
    const skip: PawEvent['type'][] = ['circle_activated', 'stop', 'rewrite', 'curl_done', 'open_done', 'rest_done'];
    expectAllIgnored(start, everyEventExcept(start, skip));
  });
});

// ---------------------------------------------------------------------------
// Transition table: ready
// ---------------------------------------------------------------------------

describe('table: ready', () => {
  it('ready + circle_activated (index < k, curse open) -> binding, pendingCurseId set, lastVerdict null', () => {
    const start: PawContext = { ...ready(4), lastVerdict: 'not-closed' };
    const t = reduce(start, { type: 'circle_activated', index: 2 });
    expect(t.ctx.phase).toBe('binding');
    expect(t.ctx.pendingCurseId).toBe(curseId(start, 2));
    expect(t.ctx.lastVerdict).toBeNull();
    expect(t.effects).toEqual(NO_EFFECTS);
  });

  it('ready + circle_activated (curse closed, or index invalid) is ignored', () => {
    const start = settle(reduce(ready(4), verdict(ready(4), 1, true)).ctx);
    expectIgnored(start, { type: 'circle_activated', index: 1 });
    for (const index of [-1, 4, 5, 1.5, Number.NaN]) {
      expectIgnored(ready(4), { type: 'circle_activated', index });
    }
  });

  it('ready + curl_done / open_done (matches active) -> ready, the queue advances, next play', () => {
    const afterClose = reduce(ready(4), verdict(ready(4), 0, true));
    const open = need(afterClose.ctx.anim.active);
    expect(open).toEqual({ id: 4, kind: 'open', digit: 3 });
    // Queue a second open behind the first, then complete the first.
    const second = reduce(afterClose.ctx, verdict(afterClose.ctx, 1, true));
    expect(second.effects).toEqual(NO_EFFECTS);
    expect(second.ctx.anim.queue).toEqual([{ id: 5, kind: 'open', digit: 2 }]);
    const t = reduce(second.ctx, { type: 'open_done', id: 4 });
    expect(t.ctx.phase).toBe('ready');
    expect(t.ctx.anim.active).toEqual({ id: 5, kind: 'open', digit: 2 });
    expect(t.ctx.anim.queue).toEqual([]);
    expect(t.effects).toEqual([{ type: 'play', command: { id: 5, kind: 'open', digit: 2 } }]);

    // The kind must match too: the active command is an open, so curl_done is ignored.
    expectIgnored(afterClose.ctx, { type: 'curl_done', id: 4 });
  });

  it('ready + verdict_received -> see the verdict rules below', () => {
    const t = reduce(ready(3), verdict(ready(3), 0, true));
    expect(t.ctx.phase).toBe('ready');
    expect(t.ctx.curled).toEqual([0, 1]);
  });

  it('ready + stop -> ended (stopped), anim and pending cleared, snap(curled, upright)', () => {
    const start = reduce(ready(5), verdict(ready(5), 4, true)).ctx; // an open animation is in progress
    expect(start.anim.active?.kind).toBe('open');
    const t = reduce(start, STOP);
    expect(t.ctx.phase).toBe('ended');
    expect(t.ctx.endReason).toBe('stopped');
    expect(t.ctx.anim).toEqual({ active: null, queue: [], nextId: 6 });
    expect(t.ctx.pendingCurseId).toBeNull();
    expect(t.ctx.curled).toEqual(digitsUpTo(4));
    expect(t.effects).toEqual([snapOf(digitsUpTo(4), 'upright')]);
  });

  it('ready + rewrite -> idle, reset, snap(zeros, upright)', () => {
    const t = reduce(ready(4), REWRITE);
    expect(t.ctx).toEqual(initialState(false));
    expect(t.effects).toEqual([ZEROS_UPRIGHT]);
  });

  it('ready ignores card and bind events and a second grant', () => {
    const start = ready(3);
    const skip: PawEvent['type'][] = ['circle_activated', 'verdict_received', 'stop', 'rewrite'];
    expectAllIgnored(start, everyEventExcept(start, skip).filter((e) => e.type !== 'curl_done'));
  });
});

// ---------------------------------------------------------------------------
// Transition table: binding
// ---------------------------------------------------------------------------

describe('table: binding', () => {
  it('binding + bind_submitted (clause non-blank after trim) -> judging, request-bind', () => {
    const start = binding(4, 1);
    const t = reduce(start, { type: 'bind_submitted', kind: 'rewrite', clause: '  The owner may transfer it.  ' });
    expect(t.ctx.phase).toBe('judging');
    expect(t.ctx.pendingCurseId).toBe(curseId(start, 1));
    expect(t.effects).toEqual([
      {
        type: 'request-bind',
        curseId: curseId(start, 1),
        kind: 'rewrite',
        clause: '  The owner may transfer it.  ',
        grant: grantOf(start),
      },
    ]);
  });

  it('binding + bind_submitted (blank clause) is ignored', () => {
    for (const clause of ['', '  ', '\t\n']) {
      expectIgnored(binding(3, 0), { type: 'bind_submitted', kind: KIND, clause });
    }
  });

  it('binding + card_closed -> ready, pendingCurseId null', () => {
    const t = reduce(binding(3, 2), { type: 'card_closed' });
    expect(t.ctx.phase).toBe('ready');
    expect(t.ctx.pendingCurseId).toBeNull();
    expect(t.effects).toEqual(NO_EFFECTS);
  });

  it('binding + curl_done / open_done (matches active) -> binding, the queue advances', () => {
    const opening = reduce(ready(4), verdict(ready(4), 0, true)).ctx;
    const start = reduce(opening, { type: 'circle_activated', index: 1 }).ctx;
    expect(start.phase).toBe('binding');
    const open = need(start.anim.active);
    const t = reduce(start, doneEventFor(open));
    expect(t.ctx.phase).toBe('binding');
    expect(t.ctx.anim.active).toBeNull();
    expect(t.effects).toEqual(NO_EFFECTS);
    expectIgnored(start, { type: 'open_done', id: open.id + 1 });
  });

  it('binding + stop -> ended (stopped), pending cleared, snap(curled, upright), no abort', () => {
    const t = reduce(binding(4, 2), STOP);
    expect(t.ctx.phase).toBe('ended');
    expect(t.ctx.endReason).toBe('stopped');
    expect(t.ctx.pendingCurseId).toBeNull();
    expect(t.effects).toEqual([snapOf(digitsUpTo(4), 'upright')]);
  });

  it('binding + rewrite -> idle, reset, snap(zeros, upright) (Req 4.4)', () => {
    const t = reduce(binding(4, 2), REWRITE);
    expect(t.ctx).toEqual(initialState(false));
    expect(t.effects).toEqual([ZEROS_UPRIGHT]);
  });

  it('binding ignores a second circle, a second grant and bind_failed', () => {
    const start = binding(3, 0);
    const skip: PawEvent['type'][] = [
      'bind_submitted',
      'card_closed',
      'verdict_received',
      'stop',
      'rewrite',
      'curl_done',
      'open_done',
      'rest_done',
    ];
    expectAllIgnored(start, everyEventExcept(start, skip));
  });
});

// ---------------------------------------------------------------------------
// Transition table: judging
// ---------------------------------------------------------------------------

describe('table: judging', () => {
  it('judging + verdict_received -> see the verdict rules below', () => {
    const start = judging(3, 1);
    const t = reduce(start, verdict(start, 1, true));
    expect(t.ctx.phase).toBe('ready');
    expect(t.ctx.pendingCurseId).toBeNull();
  });

  it('judging + bind_failed -> binding, the card stays open', () => {
    const start = judging(3, 1);
    const t = reduce(start, { type: 'bind_failed' });
    expect(t.ctx.phase).toBe('binding');
    expect(t.ctx.pendingCurseId).toBe(curseId(start, 1));
    expect(t.effects).toEqual(NO_EFFECTS);
  });

  it('judging + circle_activated, bind_submitted, card_closed is ignored', () => {
    const start = judging(3, 1);
    expectIgnored(start, { type: 'circle_activated', index: 0 });
    expectIgnored(start, { type: 'bind_submitted', kind: KIND, clause: CLAUSE });
    expectIgnored(start, { type: 'card_closed' });
  });

  it('judging + stop -> ended (stopped), abort-requests then snap(curled, upright)', () => {
    const t = reduce(judging(4, 1), STOP);
    expect(t.ctx.phase).toBe('ended');
    expect(t.ctx.endReason).toBe('stopped');
    expect(t.ctx.pendingCurseId).toBeNull();
    expect(t.effects).toEqual([{ type: 'abort-requests' }, snapOf(digitsUpTo(4), 'upright')]);
  });

  it('judging + rewrite -> idle, reset, abort-requests then snap(zeros, upright)', () => {
    const t = reduce(judging(4, 1), REWRITE);
    expect(t.ctx).toEqual(initialState(false));
    expect(t.effects).toEqual([{ type: 'abort-requests' }, ZEROS_UPRIGHT]);
  });

  it('judging keeps playing a running animation: a matching done advances the queue', () => {
    const opening = reduce(ready(4), verdict(ready(4), 0, true)).ctx;
    const card = reduce(opening, { type: 'circle_activated', index: 1 }).ctx;
    const start = reduce(card, { type: 'bind_submitted', kind: KIND, clause: CLAUSE }).ctx;
    expect(start.phase).toBe('judging');
    const t = reduce(start, doneEventFor(need(start.anim.active)));
    expect(t.ctx.phase).toBe('judging');
    expect(t.ctx.anim.active).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Transition table: ended
// ---------------------------------------------------------------------------

describe('table: ended', () => {
  it('ended + curl_done / open_done / rest_done (matches active) -> ended, the queue advances, next play', () => {
    const closing = reduce(ready(3), verdict(ready(3), 0, true)).ctx;
    const last = reduce(settle(reduce(settle(closing), verdict(closing, 1, true)).ctx), verdict(closing, 2, true));
    expect(last.ctx.phase).toBe('ended');
    expect(last.ctx.anim.active).toEqual({ id: 5, kind: 'open', digit: 0 });
    expect(last.ctx.anim.queue).toEqual([{ id: 6, kind: 'rest' }]);

    const open = reduce(last.ctx, { type: 'open_done', id: 5 });
    expect(open.ctx.phase).toBe('ended');
    expect(playedCommand(open)).toEqual({ id: 6, kind: 'rest' });

    const rest = reduce(open.ctx, { type: 'rest_done', id: 6 });
    expect(rest.ctx.phase).toBe('ended');
    expect(rest.ctx.endReason).toBe('all-closed');
    expect(rest.ctx.anim.active).toBeNull();
    expect(rest.effects).toEqual(NO_EFFECTS);
  });

  it('ended + rewrite -> idle, reset to initial, snap(zeros, upright), for both endings', () => {
    for (const reason of ['stopped', 'all-closed'] as const) {
      const t = reduce(ended(4, reason), REWRITE);
      expect(t.ctx).toEqual(initialState(false));
      expect(t.effects).toEqual([ZEROS_UPRIGHT]);
    }
  });

  it('ended + circle_activated, bind_submitted, verdict_received, stop, grant_requested and others are ignored', () => {
    for (const reason of ['stopped', 'all-closed'] as const) {
      const start = ended(4, reason);
      const events = everyEventExcept(start, ['rewrite', 'curl_done', 'open_done', 'rest_done']);
      expectAllIgnored(start, events);
      expectIgnored(start, { type: 'grant_requested', text: 'another wish' });
      expectIgnored(start, { type: 'circle_activated', index: 0 });
      expectIgnored(start, verdict(ready(4), 0, true));
    }
  });
});

// ---------------------------------------------------------------------------
// Transition table: any phase
// ---------------------------------------------------------------------------

describe('table: any phase, motion_preference_changed', () => {
  const ON: PawEvent = { type: 'motion_preference_changed', reduced: true };
  const OFF: PawEvent = { type: 'motion_preference_changed', reduced: false };

  it('turning it on clears the queue and emits snap(curled, upright) in a live round', () => {
    const start = reduce(ready(4), verdict(ready(4), 1, true)).ctx; // an open is playing
    const t = reduce(start, ON);
    expect(t.ctx.reducedMotion).toBe(true);
    expect(t.ctx.phase).toBe('ready');
    expect(t.ctx.anim).toEqual({ active: null, queue: [], nextId: 5 });
    expect(t.ctx.curled).toEqual(digitsUpTo(3));
    expect(t.effects).toEqual([snapOf(digitsUpTo(3), 'upright')]);
  });

  it('turning it on keeps the card open in binding and the request in flight in judging', () => {
    expect(reduce(binding(3, 1), ON).ctx.phase).toBe('binding');
    const t = reduce(judging(3, 1), ON);
    expect(t.ctx.phase).toBe('judging');
    expect(t.ctx.pendingCurseId).toBe('curse-1');
    expect(t.effects).toEqual([snapOf(digitsUpTo(3), 'upright')]);
  });

  it('turning it on after all-closed emits snap(zeros, rested), and after stop snap(curled, upright)', () => {
    const closing = reduce(ready(3), verdict(ready(3), 0, true)).ctx;
    const finishing = reduce(settle(reduce(settle(closing), verdict(closing, 1, true)).ctx), verdict(closing, 2, true));
    expect(finishing.ctx.anim.active).not.toBeNull();
    const rested = reduce(finishing.ctx, ON);
    expect(rested.ctx.phase).toBe('ended');
    expect(rested.ctx.endReason).toBe('all-closed');
    expect(rested.ctx.anim).toEqual({ active: null, queue: [], nextId: 7 });
    expect(rested.effects).toEqual([snapOf([], 'rested')]);

    const stopped = reduce(ended(4, 'stopped'), ON);
    expect(stopped.ctx.endReason).toBe('stopped');
    expect(stopped.effects).toEqual([snapOf(digitsUpTo(4), 'upright')]);
  });

  it('turning it on while idle or granting sets the flag and snaps the empty pose', () => {
    const idle = reduce(initialState(false), ON);
    expect(idle.ctx).toEqual(initialState(true));
    expect(idle.effects).toEqual([ZEROS_UPRIGHT]);
    const granting = reduce(reduce(initialState(false), REQUEST).ctx, ON);
    expect(granting.ctx.phase).toBe('granting');
    expect(granting.ctx.reducedMotion).toBe(true);
  });

  it('turning it off only sets the flag: no effect, no change to anim or phase', () => {
    const start = reduce(ready(4, true), { type: 'circle_activated', index: 0 }).ctx;
    const t = reduce(start, OFF);
    expect(t.ctx).toEqual({ ...start, reducedMotion: false });
    expect(t.effects).toEqual(NO_EFFECTS);
  });

  it('an event that does not change the flag emits nothing', () => {
    expectIgnored(ready(4), OFF);
    expectIgnored(ready(4, true), ON);
    expectIgnored(initialState(true), ON);
  });

  it('the preference survives rewrite', () => {
    const t = reduce(reduce(ready(3), ON).ctx, REWRITE);
    expect(t.ctx).toEqual(initialState(true));
  });
});

// ---------------------------------------------------------------------------
// Verdict rules 1-4
// ---------------------------------------------------------------------------

describe('verdict rules', () => {
  it('rule 1: closed false changes nothing; when pending it returns to binding with lastVerdict not-closed', () => {
    const start = judging(4, 2);
    const t = reduce(start, verdict(start, 2, false));
    expect(t.ctx).toEqual({ ...start, phase: 'binding', lastVerdict: 'not-closed' });
    expect(t.effects).toEqual(NO_EFFECTS);

    // Not pending (another curse, or not judging): ignored.
    expectIgnored(start, verdict(start, 0, false));
    expectIgnored(ready(4), verdict(ready(4), 2, false));
    const card = binding(4, 2);
    expectIgnored(card, verdict(card, 2, false));
  });

  it('rule 1: "The paw remembers" is cleared when the card is opened again', () => {
    const remembered = reduce(judging(4, 2), verdict(judging(4, 2), 2, false)).ctx;
    const reopened = reduce(reduce(remembered, { type: 'card_closed' }).ctx, { type: 'circle_activated', index: 2 });
    expect(reopened.ctx.lastVerdict).toBeNull();
  });

  it('rule 2: closing a curse that is already closed does nothing; when pending the card closes', () => {
    const closed = settle(reduce(ready(4), verdict(ready(4), 1, true)).ctx);
    expectIgnored(closed, verdict(closed, 1, true));

    // Pending path: force a judging state whose pending curse is already closed.
    const forced: PawContext = { ...closed, phase: 'judging', pendingCurseId: curseId(closed, 1) };
    const t = reduce(forced, verdict(closed, 1, true));
    expect(t.ctx).toEqual({ ...forced, phase: 'ready', pendingCurseId: null });
    expect(t.effects).toEqual(NO_EFFECTS);
  });

  it('rule 3: closing an open curse adds its id, replaces the grant, pops the top digit and enqueues open(d)', () => {
    const start = ready(4);
    const event = verdict(start, 0, true); // curse 0 is bound, but digit 3 (the top) opens
    const t = reduce(start, event);
    expect(t.ctx.closedIds).toEqual(['curse-0']);
    expect(t.ctx.grant).toEqual((event as Extract<PawEvent, { type: 'verdict_received' }>).grant);
    expect(t.ctx.curled).toEqual([0, 1, 2]);
    expect(t.ctx.anim.active).toEqual({ id: 4, kind: 'open', digit: 3 });
    expect(t.effects).toEqual([{ type: 'play', command: { id: 4, kind: 'open', digit: 3 } }]);
    expect(t.ctx.phase).toBe('ready');
  });

  it('rule 3: a pending close through the card closes the card and goes to ready', () => {
    const start = judging(4, 1);
    const t = reduce(start, verdict(start, 1, true));
    expect(t.ctx.phase).toBe('ready');
    expect(t.ctx.pendingCurseId).toBeNull();
    expect(t.ctx.closedIds).toEqual(['curse-1']);
    expect(playedCommand(t)).toEqual({ id: 4, kind: 'open', digit: 3 });
  });

  it('rule 3: a close while another open is playing queues behind it (one active command)', () => {
    const first = reduce(ready(4), verdict(ready(4), 0, true));
    const second = reduce(first.ctx, verdict(first.ctx, 1, true));
    expect(second.effects).toEqual(NO_EFFECTS);
    expect(second.ctx.anim.active).toEqual({ id: 4, kind: 'open', digit: 3 });
    expect(second.ctx.anim.queue).toEqual([{ id: 5, kind: 'open', digit: 2 }]);
  });

  it('rule 3.3: the last close ends the round: phase ended, all-closed, open then rest', () => {
    const closing = closeAllButLast(3);
    const t = reduce(closing, verdict(closing, 0, true));
    expect(t.ctx.phase).toBe('ended');
    expect(t.ctx.endReason).toBe('all-closed');
    expect(t.ctx.curled).toEqual([]);
    expect(t.ctx.pendingCurseId).toBeNull();
    expect(t.ctx.anim.active).toEqual({ id: 5, kind: 'open', digit: 0 });
    expect(t.ctx.anim.queue).toEqual([{ id: 6, kind: 'rest' }]);
    expect(t.effects).toEqual([{ type: 'play', command: { id: 5, kind: 'open', digit: 0 } }]);
  });

  it('rule 3 with reduced motion: one snap of the new pose, upright; the ending close is snap(zeros, rested)', () => {
    const start = ready(4, true);
    const first = reduce(start, verdict(start, 1, true));
    expect(first.ctx.anim).toEqual({ active: null, queue: [], nextId: 0 });
    expect(first.effects).toEqual([snapOf(digitsUpTo(3), 'upright')]);

    const last = closeAllButLast(3, true);
    const t = reduce(last, verdict(last, 0, true));
    expect(t.ctx.phase).toBe('ended');
    expect(t.ctx.endReason).toBe('all-closed');
    expect(t.ctx.anim).toEqual({ active: null, queue: [], nextId: 0 });
    expect(t.effects).toEqual([snapOf([], 'rested')]);
  });

  it('rule 3 with reduced motion through the card closes the card', () => {
    const start = judging(4, 1, true);
    const t = reduce(start, verdict(start, 1, true));
    expect(t.ctx.phase).toBe('ready');
    expect(t.ctx.pendingCurseId).toBeNull();
  });

  it('rule 4: closing an open curse with an empty stack is the all-closed case and pops nothing', () => {
    const broken: PawContext = { ...ready(3), curled: [] };
    const t = reduce(broken, verdict(broken, 0, true));
    expect(t.ctx.curled).toEqual([]);
    expect(t.ctx.phase).toBe('ended');
    expect(t.ctx.endReason).toBe('all-closed');
    expect(t.ctx.anim.active).toEqual({ id: 3, kind: 'rest' });
  });

  it('a verdict for a curse that is not in the Grant, or in phases curling, granting, idle, is ignored', () => {
    const start = ready(3);
    expectIgnored(start, { ...(verdict(start, 0, true) as object), curseId: 'nope' } as PawEvent);
    const curlingCtx = curling(3);
    expectIgnored(curlingCtx, verdict(start, 0, true));
    expectIgnored(initialState(false), verdict(start, 0, true));
  });

  function closeAllButLast(k: number, reduced = false): PawContext {
    let ctx = ready(k, reduced);
    // Close curses k-1 .. 1 in this order, completing every animation. Curse 0 is left.
    for (let index = k - 1; index >= 1; index -= 1) ctx = settle(reduce(ctx, verdict(ctx, index, true)).ctx);
    expect(ctx.curled).toEqual([0]);
    return ctx;
  }
});

// ---------------------------------------------------------------------------
// Worked scenarios (task 7)
// ---------------------------------------------------------------------------

describe('worked scenarios', () => {
  it('a 4-curse grant closed in the order 2, 0, 3, 1 opens digits 3, 2, 1, 0', () => {
    let ctx = ready(4);
    const opened: Digit[] = [];
    for (const index of [2, 0, 3, 1]) {
      const t = reduce(ctx, verdict(ctx, index, true));
      const open = playedCommand(t);
      expect(open.kind).toBe('open');
      opened.push(need(open.digit));
      expect(t.ctx.closedIds).toContain(curseId(ctx, index));
      ctx = settle(t.ctx);
    }
    expect(opened).toEqual([3, 2, 1, 0]);
    expect(ctx.curled).toEqual([]);
    expect(ctx.closedIds).toEqual(['curse-2', 'curse-0', 'curse-3', 'curse-1']);
    expect(ctx.phase).toBe('ended');
    expect(ctx.endReason).toBe('all-closed');
    expect(ctx.anim).toEqual({ active: null, queue: [], nextId: 4 + 4 + 1 });
  });

  it('a 4-curse grant closed in the order 2, 0, 3, 1 through the card opens the same digits', () => {
    let ctx = ready(4);
    const opened: Digit[] = [];
    for (const index of [2, 0, 3, 1]) {
      ctx = reduce(ctx, { type: 'circle_activated', index }).ctx;
      ctx = reduce(ctx, { type: 'bind_submitted', kind: KIND, clause: CLAUSE }).ctx;
      const t = reduce(ctx, verdict(ctx, index, true));
      opened.push(need(playedCommand(t).digit));
      ctx = settle(t.ctx);
    }
    expect(opened).toEqual([3, 2, 1, 0]);
    expect(ctx.endReason).toBe('all-closed');
  });

  it('a stop during curl 3 of 5 emits one snap with all five digits curled and an empty queue', () => {
    let ctx = curling(5);
    ctx = reduce(ctx, { type: 'curl_done', id: 0 }).ctx;
    ctx = reduce(ctx, { type: 'curl_done', id: 1 }).ctx;
    expect(ctx.anim.active).toEqual({ id: 2, kind: 'curl', digit: 2 }); // curl 3 of 5 is playing
    expect(ctx.anim.queue).toHaveLength(2);

    const t = reduce(ctx, STOP);
    expect(t.effects).toEqual([{ type: 'snap', amounts: [1, 1, 1, 1, 1], pose: 'upright' }]);
    expect(t.ctx.phase).toBe('ended');
    expect(t.ctx.endReason).toBe('stopped');
    expect(t.ctx.anim.active).toBeNull();
    expect(t.ctx.anim.queue).toEqual([]);
    expect(t.ctx.curled).toEqual([0, 1, 2, 3, 4]);
  });

  it('a late *_done after a snap is ignored', () => {
    // After stop.
    const playing = curling(5);
    const cancelled = need(playing.anim.active);
    const stopped = reduce(playing, STOP).ctx;
    expectIgnored(stopped, doneEventFor(cancelled));
    expectIgnored(stopped, { type: 'curl_done', id: 1 });

    // After a reduced-motion snap.
    const snapped = reduce(playing, { type: 'motion_preference_changed', reduced: true }).ctx;
    expectIgnored(snapped, doneEventFor(cancelled));

    // After a rewrite snap.
    const rewritten = reduce(playing, REWRITE).ctx;
    expectIgnored(rewritten, doneEventFor(cancelled));

    // After a stop during an open animation.
    const opening = reduce(ready(4), verdict(ready(4), 0, true)).ctx;
    const openCmd = need(opening.anim.active);
    expectIgnored(reduce(opening, STOP).ctx, doneEventFor(openCmd));
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('purity', () => {
  it('reduce never mutates the context or the event: a full round on frozen inputs does not throw', () => {
    const send = (ctx: PawContext, event: PawEvent): PawContext => {
      const t = reduce(deepFreeze(ctx), deepFreeze(event));
      deepFreeze(t.effects);
      return t.ctx;
    };
    let ctx = initialState(false);
    ctx = send(ctx, REQUEST);
    ctx = send(ctx, grantReceivedEvent(makeGrant(3)));
    while (ctx.anim.active !== null) ctx = send(ctx, doneEventFor(ctx.anim.active));
    ctx = send(ctx, { type: 'circle_activated', index: 1 });
    ctx = send(ctx, { type: 'bind_submitted', kind: KIND, clause: CLAUSE });
    ctx = send(ctx, verdict(ctx, 1, false));
    ctx = send(ctx, { type: 'bind_submitted', kind: KIND, clause: CLAUSE });
    ctx = send(ctx, verdict(ctx, 1, true));
    ctx = send(ctx, { type: 'motion_preference_changed', reduced: true });
    ctx = send(ctx, verdict(ctx, 0, true));
    ctx = send(ctx, REWRITE);
    expect(ctx).toEqual(initialState(true));
  });

  it('the same input gives the same output', () => {
    const start = ready(4);
    const event = verdict(start, 2, true);
    expect(reduce(start, event)).toEqual(reduce(start, event));
  });
});
