// Example-based tests for the view selectors: every label and text string of design.md
// sections 2 and 7, each circle status, `showStop` in every phase, and `card`.

import { CurseTypeSchema } from 'paw-core';
import type { Binding, CurseType, Grant, Verdict } from 'paw-core';
import { describe, expect, it } from 'vitest';
import { doneEventFor, grantReceivedEvent, withClosed } from './arbitraries';
import { initialState, reduce } from './paw-machine';
import type { PawContext, PawEvent, Phase } from './paw-machine-types';
import {
  circleViews,
  curseTypeLabel,
  fingerText,
  isQuiescent,
  medalFor,
  projectGrant,
  selectView,
  showStop,
} from './paw-selectors';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TYPES: readonly CurseType[] = ['permissions', 'money', 'time', 'data-loss', 'edge-input'];

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

function send(ctx: PawContext, ...events: PawEvent[]): PawContext {
  return events.reduce((current, event) => reduce(current, event).ctx, ctx);
}

/** Completes the active command until the machine is quiescent. */
function settle(start: PawContext): PawContext {
  let ctx = start;
  for (let i = 0; i < 50 && ctx.anim.active !== null; i += 1) {
    ctx = send(ctx, doneEventFor(ctx.anim.active));
  }
  expect(isQuiescent(ctx)).toBe(true);
  return ctx;
}

/** A Grant with k curses has just arrived: curling, first curl active, the rest queued. */
function curling(k: number, reduced = false): PawContext {
  return send(initialState(reduced), REQUEST, grantReceivedEvent(makeGrant(k)));
}

function ready(k: number): PawContext {
  return settle(curling(k));
}

function binding(k: number, index: number): PawContext {
  return send(ready(k), { type: 'circle_activated', index });
}

function judging(k: number, index: number): PawContext {
  return send(binding(k, index), { type: 'bind_submitted', kind: 'ears-clause', clause: 'It shall hold.' });
}

/** Binds curse `index` and has the Judge close it, then lets the paw settle. */
function closeCurse(ctx: PawContext, index: number): PawContext {
  const grant = need(ctx.grant);
  const id = grant.curses[index].id;
  const asked = send(
    ctx,
    { type: 'circle_activated', index },
    { type: 'bind_submitted', kind: 'ears-clause', clause: 'It shall hold.' },
  );
  const verdict: PawEvent = {
    type: 'verdict_received',
    curseId: id,
    closed: true,
    reason: 'sealed',
    grant: withClosed(grant, id),
  };
  return settle(send(asked, verdict));
}

function stopped(k: number, closeFirst: number): PawContext {
  let ctx = ready(k);
  for (let i = 0; i < closeFirst; i += 1) ctx = closeCurse(ctx, i);
  return send(ctx, { type: 'stop' });
}

function allClosed(k: number): PawContext {
  let ctx = ready(k);
  for (let i = 0; i < k; i += 1) ctx = closeCurse(ctx, i);
  return ctx;
}

const labels = (ctx: PawContext): string[] => circleViews(ctx).map((c) => c.ariaLabel);
const statuses = (ctx: PawContext): string[] => circleViews(ctx).map((c) => c.status);

// ---------------------------------------------------------------------------
// curseTypeLabel
// ---------------------------------------------------------------------------

describe('curseTypeLabel', () => {
  it('maps the ten taxonomy tags to their display names', () => {
    expect(curseTypeLabel('permissions')).toBe('Permissions');
    expect(curseTypeLabel('time')).toBe('Time');
    expect(curseTypeLabel('money')).toBe('Money');
    expect(curseTypeLabel('scale')).toBe('Scale');
    expect(curseTypeLabel('abuse')).toBe('Abuse');
    expect(curseTypeLabel('privacy')).toBe('Privacy');
    expect(curseTypeLabel('accessibility')).toBe('Accessibility');
    expect(curseTypeLabel('data-loss')).toBe('Data loss');
    expect(curseTypeLabel('concurrency')).toBe('Concurrency');
    expect(curseTypeLabel('edge-input')).toBe('Edge input');
  });

  it('covers every tag the schema allows, with no duplicates', () => {
    const names = CurseTypeSchema.options.map(curseTypeLabel);
    expect(names).toHaveLength(10);
    expect(new Set(names).size).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// projectGrant and isQuiescent
// ---------------------------------------------------------------------------

describe('projectGrant', () => {
  it('is null without a Grant', () => {
    expect(projectGrant(initialState(false))).toBeNull();
  });

  it('sets status from closedIds and ignores the status the Grant carried', () => {
    const base = ready(4);
    const grant = need(base.grant);
    // The Grant claims curse 1 is closed, but closedIds says nothing is closed.
    const lying: PawContext = { ...base, grant: withClosed(grant, 'curse-1') };
    expect(need(projectGrant(lying)).curses.map((c) => c.status)).toEqual(['open', 'open', 'open', 'open']);

    const closedTwo = closeCurse(ready(4), 2);
    expect(need(projectGrant(closedTwo)).curses.map((c) => c.status)).toEqual([
      'open',
      'open',
      'closed',
      'open',
    ]);
  });

  it('leaves binding and verdict untouched', () => {
    const base = ready(3);
    const grant = need(base.grant);
    const binding: Binding = { curseId: 'curse-0', kind: 'ears-clause', clause: 'It shall hold.', proposedAt: 1 };
    const verdict: Verdict = { curseId: 'curse-0', closed: true, reason: 'sealed', judgedAt: 2 };
    const decorated: Grant = {
      ...grant,
      curses: grant.curses.map((c, i) => (i === 0 ? { ...c, binding, verdict } : c)),
    };
    const projected = need(projectGrant({ ...base, grant: decorated, closedIds: ['curse-0'] }));
    expect(projected.curses[0]).toEqual({ ...decorated.curses[0], status: 'closed' });
    expect(projected.curses[0].binding).toBe(binding);
    expect(projected.curses[0].verdict).toBe(verdict);
  });

  it('does not mutate the context', () => {
    const base = closeCurse(ready(3), 0);
    const before = JSON.stringify(base);
    projectGrant(base);
    selectView(base);
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe('isQuiescent', () => {
  it('is false while a command is active or queued and true once the queue drains', () => {
    expect(isQuiescent(initialState(false))).toBe(true);
    const c = curling(3);
    expect(isQuiescent(c)).toBe(false);
    expect(isQuiescent(settle(c))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Circles
// ---------------------------------------------------------------------------

describe('circleViews', () => {
  it('has no Grant: five empty circles with empty labels', () => {
    const circles = circleViews(initialState(false));
    expect(circles.map((c) => c.index)).toEqual([0, 1, 2, 3, 4]);
    expect(circles.map((c) => c.status)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
    expect(circles.map((c) => c.ariaLabel)).toEqual(['', '', '', '', '']);
  });

  it('shows an empty circle with an empty label beyond the last curse', () => {
    const ctx = ready(3);
    expect(statuses(ctx)).toEqual(['open', 'open', 'open', 'empty', 'empty']);
    expect(labels(ctx).slice(3)).toEqual(['', '']);
  });

  it('curling: a curse whose curl is still queued is empty, the active one is arriving', () => {
    const ctx = curling(4);
    expect(ctx.anim.active?.digit).toBe(0);
    expect(statuses(ctx)).toEqual(['arriving', 'empty', 'empty', 'empty', 'empty']);
    expect(labels(ctx)).toEqual(['Permissions curse, arriving', '', '', '', '']);
  });

  it('curling: curses whose curl is done stay arriving while later ones wait', () => {
    const first = curling(4);
    const second = send(first, doneEventFor(need(first.anim.active)));
    expect(second.phase).toBe('curling');
    expect(statuses(second)).toEqual(['arriving', 'arriving', 'empty', 'empty', 'empty']);
    expect(labels(second)).toEqual([
      'Permissions curse, arriving',
      'Money curse, arriving',
      '',
      '',
      '',
    ]);
  });

  it('curling: the last curl is active, so every curse is arriving', () => {
    let ctx = curling(3);
    while (ctx.anim.queue.length > 0) ctx = send(ctx, doneEventFor(need(ctx.anim.active)));
    expect(ctx.phase).toBe('curling');
    expect(statuses(ctx)).toEqual(['arriving', 'arriving', 'arriving', 'empty', 'empty']);
  });

  it('ready: open circles say click to bind', () => {
    const ctx = ready(5);
    expect(statuses(ctx)).toEqual(['open', 'open', 'open', 'open', 'open']);
    expect(labels(ctx)).toEqual([
      'Permissions curse, open, click to bind',
      'Money curse, open, click to bind',
      'Time curse, open, click to bind',
      'Data loss curse, open, click to bind',
      'Edge input curse, open, click to bind',
    ]);
  });

  it('reduced motion: there is no curling phase, so circles are open at once', () => {
    const ctx = curling(3, true);
    expect(ctx.phase).toBe('ready');
    expect(statuses(ctx)).toEqual(['open', 'open', 'open', 'empty', 'empty']);
  });

  it('a closed curse is closed and sealed, whichever circle was bound', () => {
    const ctx = closeCurse(ready(4), 2);
    expect(statuses(ctx)).toEqual(['open', 'open', 'closed', 'open', 'empty']);
    expect(labels(ctx)[2]).toBe('Time curse, closed, sealed');
    expect(labels(ctx)[0]).toBe('Permissions curse, open, click to bind');
  });

  it('a closed curse stays closed while its finger is still opening', () => {
    const grant = makeGrant(3);
    const asked = send(
      ready(3),
      { type: 'circle_activated', index: 1 },
      { type: 'bind_submitted', kind: 'ears-clause', clause: 'It shall hold.' },
      {
        type: 'verdict_received',
        curseId: 'curse-1',
        closed: true,
        reason: 'sealed',
        grant: withClosed(grant, 'curse-1'),
      },
    );
    expect(isQuiescent(asked)).toBe(false);
    expect(statuses(asked)).toEqual(['open', 'closed', 'open', 'empty', 'empty']);
  });

  it('after a stop, open curses are open-final and closed ones stay closed', () => {
    const ctx = stopped(4, 1);
    expect(ctx.phase).toBe('ended');
    expect(statuses(ctx)).toEqual(['closed', 'open-final', 'open-final', 'open-final', 'empty']);
    expect(labels(ctx)).toEqual([
      'Permissions curse, closed, sealed',
      'Money curse, open, the paw remembers',
      'Time curse, open, the paw remembers',
      'Data loss curse, open, the paw remembers',
      '',
    ]);
  });

  it('after every curse is closed, all circles are closed', () => {
    const ctx = allClosed(3);
    expect(ctx.endReason).toBe('all-closed');
    expect(statuses(ctx)).toEqual(['closed', 'closed', 'closed', 'empty', 'empty']);
  });

  it('a stop during curling shows open-final circles, with none left empty or arriving', () => {
    const ctx = send(curling(5), { type: 'stop' });
    expect(ctx.phase).toBe('ended');
    expect(statuses(ctx)).toEqual(Array(5).fill('open-final'));
  });

  it('rewrite returns to five empty circles', () => {
    const ctx = send(closeCurse(ready(3), 0), { type: 'rewrite' });
    expect(statuses(ctx)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
  });
});

// ---------------------------------------------------------------------------
// fingerText
// ---------------------------------------------------------------------------

describe('fingerText', () => {
  it('no Grant: the paw rests with all fingers open', () => {
    expect(fingerText(initialState(false))).toBe('The paw rests, all fingers open.');
    expect(fingerText(send(initialState(false), REQUEST))).toBe('The paw rests, all fingers open.');
  });

  it('counts curled fingers while a round runs', () => {
    expect(fingerText(curling(3))).toBe('3 fingers curled.');
    expect(fingerText(ready(5))).toBe('5 fingers curled.');
    expect(fingerText(binding(4, 1))).toBe('4 fingers curled.');
    expect(fingerText(judging(4, 1))).toBe('4 fingers curled.');
  });

  it('uses the logical count right after a close, before the finger finishes opening', () => {
    const grant = makeGrant(4);
    const ctx = send(
      ready(4),
      { type: 'circle_activated', index: 0 },
      { type: 'bind_submitted', kind: 'ears-clause', clause: 'It shall hold.' },
      {
        type: 'verdict_received',
        curseId: 'curse-0',
        closed: true,
        reason: 'sealed',
        grant: withClosed(grant, 'curse-0'),
      },
    );
    expect(isQuiescent(ctx)).toBe(false);
    expect(fingerText(ctx)).toBe('3 fingers curled.');
  });

  it('singular: 1 finger curled', () => {
    let ctx = ready(3);
    ctx = closeCurse(ctx, 0);
    ctx = closeCurse(ctx, 1);
    expect(ctx.phase).toBe('ready');
    expect(fingerText(ctx)).toBe('1 finger curled.');
  });

  it('ended all-closed: the paw rests', () => {
    expect(fingerText(allClosed(3))).toBe('The paw rests.');
  });

  it('ended stopped: N fingers stay curled', () => {
    expect(fingerText(stopped(5, 0))).toBe('5 fingers stay curled.');
    expect(fingerText(stopped(4, 2))).toBe('2 fingers stay curled.');
  });

  it('ended stopped: singular 1 finger stays curled', () => {
    expect(fingerText(stopped(3, 2))).toBe('1 finger stays curled.');
  });
});

// ---------------------------------------------------------------------------
// medal and export
// ---------------------------------------------------------------------------

describe('medalFor and the medal in the view', () => {
  it('is null without a Grant', () => {
    expect(medalFor(initialState(false))).toBeNull();
  });

  it('is computed during play, but not visible until the round has ended', () => {
    const ctx = closeCurse(ready(4), 0);
    expect(medalFor(ctx)).toEqual({ score: 1, closed: 1, open: 3, text: 'Integrity 1/5: 1 closed, 3 open' });
    const view = selectView(ctx);
    expect(view.medal).toBeNull();
    expect(view.showExport).toBe(false);
  });

  it('after a stop the medal is visible at once, with the open count', () => {
    const view = selectView(stopped(4, 2));
    expect(view.medal).toEqual({ score: 2, closed: 2, open: 2, text: 'Integrity 2/5: 2 closed, 2 open' });
    expect(view.showExport).toBe(true);
  });

  it('after all-closed the medal waits for the rest animation', () => {
    const grant = makeGrant(3);
    let ctx = ready(3);
    ctx = closeCurse(ctx, 0);
    ctx = closeCurse(ctx, 1);
    ctx = send(
      ctx,
      { type: 'circle_activated', index: 2 },
      { type: 'bind_submitted', kind: 'ears-clause', clause: 'It shall hold.' },
      {
        type: 'verdict_received',
        curseId: 'curse-2',
        closed: true,
        reason: 'sealed',
        grant: withClosed(grant, 'curse-2'),
      },
    );
    expect(ctx.phase).toBe('ended');
    expect(isQuiescent(ctx)).toBe(false);
    expect(selectView(ctx).medal).toBeNull();
    expect(selectView(ctx).showExport).toBe(false);
    expect(need(medalFor(ctx)).text).toBe('Integrity 5/5: 3 closed, 0 open');

    const done = settle(ctx);
    const view = selectView(done);
    expect(view.medal).toEqual({ score: 5, closed: 3, open: 0, text: 'Integrity 5/5: 3 closed, 0 open' });
    expect(view.showExport).toBe(true);
  });

  it('with reduced motion the medal shows at once after the last close', () => {
    let ctx = curling(3, true);
    for (let i = 0; i < 3; i += 1) {
      const id = need(ctx.grant).curses[i].id;
      ctx = send(
        ctx,
        { type: 'circle_activated', index: i },
        { type: 'bind_submitted', kind: 'ears-clause', clause: 'It shall hold.' },
        {
          type: 'verdict_received',
          curseId: id,
          closed: true,
          reason: 'sealed',
          grant: withClosed(need(ctx.grant), id),
        },
      );
    }
    expect(ctx.endReason).toBe('all-closed');
    expect(selectView(ctx).medal?.text).toBe('Integrity 5/5: 3 closed, 0 open');
  });

  it('floors the score: 1 of 3 closed is 1/5, 2 of 3 is 3/5', () => {
    expect(need(medalFor(closeCurse(ready(3), 0))).score).toBe(1);
    expect(need(medalFor(closeCurse(closeCurse(ready(3), 0), 1))).score).toBe(3);
  });

  it('is hidden in every phase before the end', () => {
    for (const ctx of [initialState(false), send(initialState(false), REQUEST), curling(3), ready(3), binding(3, 0), judging(3, 0)]) {
      expect(selectView(ctx).medal).toBeNull();
      expect(selectView(ctx).showExport).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// showStop
// ---------------------------------------------------------------------------

describe('showStop', () => {
  it('is false in idle and granting', () => {
    expect(showStop(initialState(false))).toBe(false);
    expect(showStop(send(initialState(false), REQUEST))).toBe(false);
  });

  it('is true in curling, ready, binding and judging with an open curse', () => {
    expect(showStop(curling(3))).toBe(true);
    expect(showStop(ready(3))).toBe(true);
    expect(showStop(binding(3, 0))).toBe(true);
    expect(showStop(judging(3, 0))).toBe(true);
  });

  it('is false in ended, for both end reasons', () => {
    expect(showStop(stopped(3, 1))).toBe(false);
    expect(showStop(allClosed(3))).toBe(false);
  });

  it('is true while some curses are closed and one is still open', () => {
    expect(showStop(closeCurse(ready(3), 0))).toBe(true);
  });

  it('is false in a running phase when no curse is open', () => {
    const ctx = ready(3);
    const everyCurseClosed: PawContext = { ...ctx, closedIds: need(ctx.grant).curses.map((c) => c.id) };
    expect(showStop(everyCurseClosed)).toBe(false);
  });

  it('is false in every phase when there is no Grant', () => {
    const phases: Phase[] = ['idle', 'granting', 'curling', 'ready', 'binding', 'judging', 'ended'];
    for (const phase of phases) {
      expect(showStop({ ...initialState(false), phase })).toBe(false);
    }
  });

  it('selectView carries the same value', () => {
    expect(selectView(ready(3)).showStop).toBe(true);
    expect(selectView(stopped(3, 0)).showStop).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// card
// ---------------------------------------------------------------------------

describe('card', () => {
  it('is null outside binding and judging', () => {
    for (const ctx of [initialState(false), curling(3), ready(3), stopped(3, 0), allClosed(3)]) {
      expect(selectView(ctx).card).toBeNull();
    }
  });

  it('binding: the pending curse, not remembering, not judging', () => {
    const ctx = binding(4, 2);
    const card = need(selectView(ctx).card);
    expect(card.curse).toBe(need(ctx.grant).curses[2]);
    expect(card.remembers).toBe(false);
    expect(card.judging).toBe(false);
  });

  it('judging: the same curse, judging', () => {
    const card = need(selectView(judging(4, 3)).card);
    expect(card.curse.id).toBe('curse-3');
    expect(card.remembers).toBe(false);
    expect(card.judging).toBe(true);
  });

  it('after a "not closed" verdict the card is open again and remembers', () => {
    const grant = makeGrant(3);
    const ctx = send(judging(3, 1), {
      type: 'verdict_received',
      curseId: 'curse-1',
      closed: false,
      reason: 'still open',
      grant,
    });
    expect(ctx.phase).toBe('binding');
    const card = need(selectView(ctx).card);
    expect(card.curse.id).toBe('curse-1');
    expect(card.remembers).toBe(true);
    expect(card.judging).toBe(false);
  });

  it('remembers stays while the retry is judged', () => {
    const grant = makeGrant(3);
    const ctx = send(
      judging(3, 0),
      { type: 'verdict_received', curseId: 'curse-0', closed: false, reason: 'still open', grant },
      { type: 'bind_submitted', kind: 'rewrite', clause: 'Try again.' },
    );
    const card = need(selectView(ctx).card);
    expect(card.remembers).toBe(true);
    expect(card.judging).toBe(true);
  });

  it('a new card for another curse does not remember', () => {
    const grant = makeGrant(3);
    const afterNo = send(judging(3, 0), {
      type: 'verdict_received',
      curseId: 'curse-0',
      closed: false,
      reason: 'still open',
      grant,
    });
    const reopened = send(afterNo, { type: 'card_closed' }, { type: 'circle_activated', index: 1 });
    const card = need(selectView(reopened).card);
    expect(card.curse.id).toBe('curse-1');
    expect(card.remembers).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectView
// ---------------------------------------------------------------------------

describe('selectView', () => {
  it('returns the idle view for the initial state', () => {
    const view = selectView(initialState(false));
    expect(view.circles).toHaveLength(5);
    expect(view.fingerText).toBe('The paw rests, all fingers open.');
    expect(view.medal).toBeNull();
    expect(view.showStop).toBe(false);
    expect(view.showExport).toBe(false);
    expect(view.card).toBeNull();
  });

  it('puts the pieces together mid-round', () => {
    const view = selectView(binding(3, 1));
    expect(view.fingerText).toBe('3 fingers curled.');
    expect(view.showStop).toBe(true);
    expect(view.card?.curse.id).toBe('curse-1');
    expect(view.circles[1].ariaLabel).toBe('Money curse, open, click to bind');
  });
});
