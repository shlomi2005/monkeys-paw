// Tests for the live-region announcer (design.md section 7, "Live region"): one test per row of the
// table and per rule added by the reviewer, plus one property over generated sessions.

import * as fc from 'fast-check';
import type { CurseType, Grant } from 'paw-core';
import { describe as suite, expect, it } from 'vitest';
import {
  arbAnySession,
  doneEventFor,
  grantReceivedEvent,
  numRuns,
  runSession,
  withClosed,
} from './arbitraries';
import { describe } from './paw-announcer';
import { initialState, reduce } from './paw-machine';
import type { PawContext, PawEvent } from './paw-machine-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TYPES: readonly CurseType[] = ['permissions', 'data-loss', 'edge-input', 'money', 'time'];

function makeGrant(k: number): Grant {
  return {
    wishId: 'wish-1',
    narration: 'Granted.',
    curses: Array.from({ length: k }, (_, i) => ({
      id: `curse-${i}`,
      type: TYPES[i],
      story: `Story ${i}.`,
      loophole: `Loophole ${i}.`,
      status: 'open' as const,
    })),
  };
}

const REQUEST: PawEvent = { type: 'grant_requested', text: 'a wish' };

function need<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

/** Applies `event` and returns what `describe` says about the step, along with the new context. */
function step(ctx: PawContext, event: PawEvent): { next: PawContext; text: string | null } {
  const next = reduce(ctx, event).ctx;
  return { next, text: describe(ctx, next, event) };
}

function settle(start: PawContext): PawContext {
  let ctx = start;
  for (let i = 0; i < 50 && ctx.anim.active !== null; i += 1) {
    ctx = reduce(ctx, doneEventFor(ctx.anim.active)).ctx;
  }
  expect(ctx.anim.active).toBeNull();
  return ctx;
}

function granting(reduced: boolean): PawContext {
  return reduce(initialState(reduced), REQUEST).ctx;
}

/** Grant with k curses arrived: `curling` with the first curl playing, or `ready` under reduced motion. */
function granted(k: number, reduced = false): PawContext {
  return reduce(granting(reduced), grantReceivedEvent(makeGrant(k))).ctx;
}

function ready(k: number, reduced = false): PawContext {
  return settle(granted(k, reduced));
}

function judging(ctx: PawContext, index: number): PawContext {
  const bound = reduce(ctx, { type: 'circle_activated', index }).ctx;
  return reduce(bound, { type: 'bind_submitted', kind: 'ears-clause', clause: 'The system shall.' }).ctx;
}

function verdict(ctx: PawContext, index: number, closed: boolean, reason: string): PawEvent {
  const grant = need(ctx.grant);
  const id = grant.curses[index].id;
  return {
    type: 'verdict_received',
    curseId: id,
    closed,
    reason,
    grant: closed ? withClosed(grant, id) : grant,
  };
}

/** A round with k curses where the curse at `index` is being judged. */
function judgingRound(k: number, index = 0, reduced = false): PawContext {
  return judging(ready(k, reduced), index);
}

/** Closes curse `index` with a verdict and returns the announcement. */
function closeText(k: number, reason: string, reduced = false): string | null {
  const ctx = judgingRound(k, 0, reduced);
  return step(ctx, verdict(ctx, 0, true, reason)).text;
}

// ---------------------------------------------------------------------------
// Rows of the table
// ---------------------------------------------------------------------------

suite('describe: grant arrives', () => {
  it('announces the count when the Grant is accepted', () => {
    const { text } = step(granting(false), grantReceivedEvent(makeGrant(3)));
    expect(text).toBe('Granted. 3 curses arrive.');
  });

  it('uses the Grant size for 4 and 5 curses', () => {
    expect(step(granting(false), grantReceivedEvent(makeGrant(4))).text).toBe('Granted. 4 curses arrive.');
    expect(step(granting(false), grantReceivedEvent(makeGrant(5))).text).toBe('Granted. 5 curses arrive.');
  });

  it('sends one single message under reduced motion, with every curse numbered from 1', () => {
    const { text } = step(granting(true), grantReceivedEvent(makeGrant(3)));
    expect(text).toBe(
      'Granted. 3 curses. ' +
        'Curse 1, Permissions: Story 0. ' +
        'Curse 2, Data loss: Story 1. ' +
        'Curse 3, Edge input: Story 2.',
    );
  });

  it('returns null for a Grant the reducer rejected because of its size', () => {
    expect(step(granting(false), grantReceivedEvent(makeGrant(2))).text).toBeNull();
    expect(step(granting(true), grantReceivedEvent(makeGrant(6))).text).toBeNull();
  });
});

suite('describe: curl_done', () => {
  it('announces one curse per accepted curl, numbered d + 1', () => {
    let ctx = granted(3);
    const texts: (string | null)[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = step(ctx, doneEventFor(need(ctx.anim.active)));
      texts.push(result.text);
      ctx = result.next;
    }
    expect(texts).toEqual([
      'Curse 1, Permissions: Story 0.',
      'Curse 2, Data loss: Story 1.',
      'Curse 3, Edge input: Story 2.',
    ]);
  });

  it('returns null for a stale curl_done the reducer ignored', () => {
    const ctx = granted(3);
    const event: PawEvent = { type: 'curl_done', id: need(ctx.anim.active).id + 100 };
    expect(step(ctx, event).text).toBeNull();
  });
});

suite('describe: verdict closed', () => {
  it('announces a close that pops a digit', () => {
    expect(closeText(3, 'The clause names a successor')).toBe(
      'Closed. The seal holds. The clause names a successor. Finger opens.',
    );
  });

  it('trims the reason', () => {
    expect(closeText(3, '   Padded reason \n')).toBe('Closed. The seal holds. Padded reason. Finger opens.');
  });

  it.each(['.', '!', '?'])('does not double a trailing %s', (mark) => {
    expect(closeText(3, `Done${mark}`)).toBe(`Closed. The seal holds. Done${mark} Finger opens.`);
  });

  it('does not double the stop after a trimmed trailing mark', () => {
    expect(closeText(3, '  Done.  ')).toBe('Closed. The seal holds. Done. Finger opens.');
  });

  it('leaves the reason out of the sentence when it is blank', () => {
    expect(closeText(3, '   ')).toBe('Closed. The seal holds. Finger opens.');
  });

  it('does not announce the ending when motion is on: rest_done does', () => {
    const ctx = closeLast(3, false);
    expect(ctx.text).toBe('Closed. The seal holds. Last one. Finger opens.');
  });

  it('adds "The paw rests." when the close ends the round under reduced motion', () => {
    const ctx = closeLast(3, true);
    expect(ctx.text).toBe('Closed. The seal holds. Last one. Finger opens. The paw rests.');
  });

  it('does not add the ending to a reduced-motion close that leaves curses open', () => {
    expect(closeText(3, 'First one', true)).toBe('Closed. The seal holds. First one. Finger opens.');
  });

  it('announces a pending close of an already closed curse without the finger', () => {
    // The reducer's rule 2: a close for a curse that is already closed, while its card is judging.
    const first = judgingRound(3);
    const closedOnce = reduce(first, verdict(first, 0, true, 'First')).ctx;
    const pendingAgain: PawContext = {
      ...closedOnce,
      phase: 'judging',
      pendingCurseId: need(closedOnce.grant).curses[0].id,
    };
    const event = verdict(pendingAgain, 0, true, 'Again');
    const next = reduce(pendingAgain, event).ctx;
    expect(next).not.toBe(pendingAgain);
    expect(describe(pendingAgain, next, event)).toBe('Closed. The seal holds. Again.');
  });

  it('returns null for a close of an already closed curse that is not pending', () => {
    const ctx = judgingRound(3);
    const closedOnce = reduce(ctx, verdict(ctx, 0, true, 'First')).ctx;
    expect(step(closedOnce, verdict(closedOnce, 0, true, 'Again')).text).toBeNull();
  });
});

/** Closes every curse of a k-curse round and returns the announcement for the last close. */
function closeLast(k: number, reduced: boolean): { text: string | null } {
  let ctx = ready(k, reduced);
  let text: string | null = null;
  for (let i = 0; i < k; i += 1) {
    ctx = judging(ctx, i);
    const result = step(ctx, verdict(ctx, i, true, i === k - 1 ? 'Last one' : 'Another'));
    ctx = settle(result.next);
    text = result.text;
  }
  expect(ctx.phase).toBe('ended');
  return { text };
}

suite('describe: verdict not closed', () => {
  it('announces a not-closed verdict for the pending curse', () => {
    const ctx = judgingRound(3);
    const { text, next } = step(ctx, verdict(ctx, 0, false, 'The clause is vague'));
    expect(next).not.toBe(ctx);
    expect(text).toBe('Not closed. The paw remembers. The clause is vague');
  });

  it('trims the reason and adds no full stop', () => {
    const ctx = judgingRound(3);
    expect(step(ctx, verdict(ctx, 0, false, '  Still open!  ')).text).toBe(
      'Not closed. The paw remembers. Still open!',
    );
  });

  it('returns null when the reducer ignored the verdict (another curse, not pending)', () => {
    const ctx = judgingRound(3, 0);
    expect(step(ctx, verdict(ctx, 1, false, 'Nope')).text).toBeNull();
  });
});

suite('describe: ending, stop and rewrite', () => {
  it('announces "The paw rests." when rest_done is accepted', () => {
    let ctx = ready(3);
    for (let i = 0; i < 3; i += 1) {
      ctx = judging(ctx, i);
      ctx = reduce(ctx, verdict(ctx, i, true, 'Sealed')).ctx;
      // Complete the open (and, for the last close, stop before the rest).
      while (ctx.anim.active !== null && ctx.anim.active.kind !== 'rest') {
        ctx = reduce(ctx, doneEventFor(ctx.anim.active)).ctx;
      }
    }
    const rest = need(ctx.anim.active);
    expect(rest.kind).toBe('rest');
    expect(step(ctx, doneEventFor(rest)).text).toBe('The paw rests.');
  });

  it('returns null for open_done', () => {
    const ctx = judgingRound(3);
    const closed = reduce(ctx, verdict(ctx, 0, true, 'Sealed')).ctx;
    const open = need(closed.anim.active);
    expect(open.kind).toBe('open');
    expect(step(closed, doneEventFor(open)).text).toBeNull();
  });

  it('announces a stop with the plural count', () => {
    expect(step(ready(3), { type: 'stop' }).text).toBe('You stopped. 3 curses are still open.');
  });

  it('announces a stop with the singular count', () => {
    let ctx = ready(3);
    for (let i = 0; i < 2; i += 1) {
      const round = judging(ctx, i);
      ctx = settle(reduce(round, verdict(round, i, true, 'Sealed')).ctx);
    }
    expect(step(ctx, { type: 'stop' }).text).toBe('You stopped. 1 curse is still open.');
  });

  it('counts only open curses when stopping during the curl', () => {
    expect(step(granted(4), { type: 'stop' }).text).toBe('You stopped. 4 curses are still open.');
  });

  it('returns null for a stop the reducer ignored', () => {
    expect(step(initialState(false), { type: 'stop' }).text).toBeNull();
  });

  it('announces a rewrite', () => {
    expect(step(ready(3), { type: 'rewrite' }).text).toBe('The wish is unmade.');
  });

  it('returns null for a rewrite on an idle machine', () => {
    expect(step(initialState(false), { type: 'rewrite' }).text).toBeNull();
  });
});

suite('describe: events that are never announced', () => {
  it('returns null for grant_requested, grant_failed and bind_failed', () => {
    const idle = initialState(false);
    expect(step(idle, REQUEST).text).toBeNull();
    expect(step(granting(false), { type: 'grant_failed' }).text).toBeNull();
    expect(step(judgingRound(3), { type: 'bind_failed' }).text).toBeNull();
  });

  it('returns null for circle and card events', () => {
    const open = ready(3);
    const card = step(open, { type: 'circle_activated', index: 1 });
    expect(card.text).toBeNull();
    expect(step(card.next, { type: 'card_closed' }).text).toBeNull();
    expect(step(card.next, { type: 'bind_submitted', kind: 'ears-clause', clause: 'A clause.' }).text).toBeNull();
  });

  it('returns null for motion_preference_changed', () => {
    const ctx = ready(3);
    const result = step(ctx, { type: 'motion_preference_changed', reduced: true });
    expect(result.next).not.toBe(ctx);
    expect(result.text).toBeNull();
  });

  it('returns null whenever the context is the same object', () => {
    const ctx = ready(3);
    const events: PawEvent[] = [
      { type: 'stop' },
      { type: 'rewrite' },
      { type: 'curl_done', id: 999 },
      { type: 'grant_received', wish: { id: 'w', text: 't', createdAt: 0 }, grant: makeGrant(3) },
    ];
    for (const event of events.filter((e) => reduce(ctx, e).ctx === ctx)) {
      expect(describe(ctx, ctx, event)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

suite('describe: property over generated sessions', () => {
  it('never throws, is null for ignored events, and otherwise gives clean text', () => {
    fc.assert(
      fc.property(arbAnySession, (session) => {
        for (const { before, event, after } of runSession(session)) {
          const text = describe(before, after, event);
          if (after === before) {
            expect(text).toBeNull();
            continue;
          }
          if (text === null) continue;
          expect(text.length).toBeGreaterThan(0);
          expect(text).toBe(text.trim());
          // Generated stories and reasons are random words, so a word may legitimately be "null":
          // only flag the text when the step's own inputs do not contain it.
          const source = JSON.stringify([after.grant, event]);
          for (const bad of ['undefined', 'null']) {
            if (!source.includes(bad)) expect(text).not.toContain(bad);
          }
        }
      }),
      { numRuns: numRuns() },
    );
  });
});
