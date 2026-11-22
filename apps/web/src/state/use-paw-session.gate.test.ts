// The live gate and the ready rounds in the session (paw-web Req 13, design "Live gate and ready rounds").

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADULT_REQUIRED_MESSAGE,
  CLAUSE_AS_WRITTEN_MESSAGE,
  JUDGE_LIVE_ONLY_MESSAGE,
  NO_LIVE_WISH_MESSAGE,
  OUTSIDE_NOTE_MESSAGE,
  RESTING_MESSAGE,
  EXAMPLE_NOTE_MESSAGE,
} from '../api/api-messages';
import type { ExampleEntry } from '../api/api-schemas';
import { sampleWish, withCurseStatus } from '../api/api-test-support';
import { READY_ROUNDS } from './ready-rounds';
import { RESTING, deferred, failure, fakeApi, flush, grantWith, ok, rig, settle } from './paw-session-test-support';
import type { FakeApi, Rig } from './paw-session-test-support';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const READY = READY_ROUNDS[0] as ExampleEntry;
const plain = (text = 'Example one'): ExampleEntry => ({ wish: sampleWish(text), grant: withCurseStatus(grantWith(3), 'c1', 'closed') });
const snap = (r: Rig) => r.session.getSnapshot();
const wishOf = (entry: ExampleEntry) => ({ text: entry.wish.text, context: entry.wish.context ?? '', example: entry });

/** A session whose probe has answered `live`. */
async function started(live: boolean | 'fail', options: { adult?: boolean; api?: FakeApi } = {}): Promise<Rig> {
  const api = options.api ?? fakeApi();
  api.getLive.mockResolvedValue(live === 'fail' ? failure('network', 'The line to the paw is cut.') : ok({ live }));
  const r = rig(api, { adult: options.adult ?? false });
  r.session.start();
  await settle();
  return r;
}

describe('the probe', () => {
  it('runs once on start; true is open, false is outside, a failure is unknown', async () => {
    expect(snap(await started(true)).live).toBe('open');
    expect(snap(await started(false)).live).toBe('outside');
    expect(snap(await started('fail')).live).toBe('unknown');
  });

  it('starts in unknown, probes once even when start runs twice, and aborts on dispose', async () => {
    const api = fakeApi();
    api.getLive.mockReturnValue(deferred<never>().promise);
    const r = rig(api);
    expect(snap(r).live).toBe('unknown');
    r.session.start();
    r.session.start();
    expect(api.getLive).toHaveBeenCalledTimes(1);
    r.session.dispose();
    expect((api.getLive.mock.calls[0]?.[0] as AbortSignal).aborted).toBe(true);
    r.session.start(); // strict mode mounts twice
    expect(api.getLive).toHaveBeenCalledTimes(2);
  });

  it('announces the outside line once, when it becomes known', async () => {
    const r = await started(false);
    expect(snap(r).liveText).toBe(OUTSIDE_NOTE_MESSAGE);
    expect(snap(r).liveSeq).toBe(1);
  });

  it('serves the ready rounds while outside, whatever /api/examples said, and keeps what was stored', async () => {
    const api = fakeApi();
    const stored = [plain()];
    api.getExamples.mockResolvedValue(ok(stored));
    const r = await started(false, { api });
    expect(snap(r).examples).toEqual({ kind: 'ready', entries: READY_ROUNDS });
    expect(stored).toEqual([plain()]);
  });

  it('shows the ready rounds even while /api/examples is loading or failed', async () => {
    const api = fakeApi();
    api.getExamples.mockReturnValue(deferred<never>().promise);
    expect(snap(await started(false, { api })).examples.kind).toBe('ready');
    const failed = fakeApi();
    failed.getExamples.mockResolvedValue(RESTING);
    expect(snap(await started(false, { api: failed })).examples).toEqual({ kind: 'ready', entries: READY_ROUNDS });
  });

  it('is sticky: a late true after a refusal changes nothing (race with the probe)', async () => {
    const api = fakeApi();
    const probe = deferred<ReturnType<typeof ok<{ live: boolean }>>>();
    api.getLive.mockReturnValue(probe.promise);
    const r = rig(api);
    r.session.setAdultConfirmed(true);
    r.session.start();
    api.postGrant.mockResolvedValue(failure('outside', 'Not from here.', 403));
    r.session.submitWish({ text: 'a wish' });
    await settle();
    expect(snap(r).live).toBe('outside');
    probe.resolve(ok({ live: true }));
    await settle();
    expect(snap(r).live).toBe('outside');
  });

  it('announces the outside line once even when a refusal and the probe both say so', async () => {
    const api = fakeApi();
    const probe = deferred<ReturnType<typeof ok<{ live: boolean }>>>();
    api.getLive.mockReturnValue(probe.promise);
    api.postGrant.mockResolvedValue(failure('outside', 'Not from here.', 403));
    const r = rig(api);
    r.session.setAdultConfirmed(true);
    r.session.start();
    r.session.submitWish({ text: 'a wish' });
    await settle();
    const seq = snap(r).liveSeq;
    probe.resolve(ok({ live: false }));
    await settle();
    expect(snap(r).liveSeq).toBe(seq);
  });
});

describe('the six steps of "Make the wish"', () => {
  it('1: not idle or blank does nothing', async () => {
    const r = await started(true, { adult: true });
    expect(r.session.submitWish({ text: '   ' })).toBe('ignored');
    expect(r.session.submitWish({ text: 'one' })).toBe('sent');
    expect(r.session.submitWish({ text: 'two' })).toBe('ignored');
    expect(r.api.postGrant).toHaveBeenCalledTimes(1);
  });

  it('2: a ready round replays with no tick, in every live state, with no request', async () => {
    for (const live of [true, false, 'fail'] as const) {
      const r = await started(live);
      expect(r.session.submitWish(wishOf(READY))).toBe('replayed');
      await settle();
      expect(snap(r).ctx.phase).toBe('ready');
      expect(snap(r).notice).toBeNull();
      expect(r.api.postGrant).not.toHaveBeenCalled();
    }
  });

  it('2: a ready round replays even when examplesOnly is set', async () => {
    const r = await started(true, { adult: true });
    r.api.postGrant.mockResolvedValueOnce(RESTING);
    r.session.submitWish({ text: 'a wish of my own' });
    await settle();
    expect(snap(r).examplesOnly).toBe(true);
    expect(r.session.submitWish(wishOf(READY))).toBe('replayed');
    await settle();
    expect(snap(r).ctx.phase).toBe('ready');
  });

  it('2: another example without the tick replays its cached Grant, with no alert', async () => {
    const r = await started(true);
    expect(r.session.submitWish(wishOf(plain()))).toBe('replayed');
    await settle();
    expect(snap(r).ctx.phase).toBe('ready');
    expect(r.api.postGrant).not.toHaveBeenCalled();
    expect(snap(r).notice).toBeNull();
  });

  it('2: another example with the tick goes live while the paw is awake', async () => {
    const r = await started(true, { adult: true });
    expect(r.session.submitWish(wishOf(plain()))).toBe('sent');
    expect(r.api.postGrant).toHaveBeenCalledTimes(1);
  });

  it('3: outside, a typed wish sends nothing and says so', async () => {
    const r = await started(false, { adult: true });
    expect(r.session.submitWish({ text: 'my own wish' })).toBe('outside');
    expect(r.api.postGrant).not.toHaveBeenCalled();
    expect(snap(r).notice).toEqual({ kind: 'info', text: NO_LIVE_WISH_MESSAGE });
    expect(snap(r).ctx.phase).toBe('idle');
  });

  it('3: outside, an edited example is a typed wish', async () => {
    const r = await started(false);
    expect(r.session.submitWish({ text: `${READY.wish.text} today`, context: READY.wish.context ?? '', example: READY })).toBe('outside');
    expect(r.api.postGrant).not.toHaveBeenCalled();
  });

  it('4: resting sends nothing and says so', async () => {
    const r = await started(true, { adult: true });
    r.api.postGrant.mockResolvedValueOnce(RESTING);
    r.session.submitWish({ text: 'first' });
    await settle();
    expect(r.session.submitWish({ text: 'second' })).toBe('resting');
    expect(snap(r).notice).toEqual({ kind: 'info', text: RESTING_MESSAGE });
    expect(r.api.postGrant).toHaveBeenCalledTimes(1);
  });

  it('5: no tick sends nothing; the UI shows the alert from the outcome', async () => {
    const r = await started(true);
    expect(r.session.submitWish({ text: 'my own wish' })).toBe('adult-required');
    expect(r.api.postGrant).not.toHaveBeenCalled();
    expect(snap(r).ctx.phase).toBe('idle');
  });

  it('5 beats nothing: outside comes before the tick, resting before the tick', async () => {
    const outside = await started(false);
    expect(outside.session.submitWish({ text: 'my own wish' })).toBe('outside');
  });

  it('6: a ticked live wish sends the real state of the box as the last argument', async () => {
    const r = await started(true);
    r.session.setAdultConfirmed(true);
    expect(r.session.submitWish({ text: 'my own wish' })).toBe('sent');
    expect(r.api.postGrant).toHaveBeenCalledTimes(1);
    expect(r.api.postGrant.mock.calls[0]?.[2]).toBe(true);
  });

  it('an unknown probe still lets a ticked wish through (the server decides)', async () => {
    const r = await started('fail', { adult: true });
    expect(r.session.submitWish({ text: 'my own wish' })).toBe('sent');
  });
});

describe('the checkbox state', () => {
  it('is ignored unless the machine is idle, survives Rewrite, and is memory only', async () => {
    const r = await started(true, { adult: true });
    r.session.submitWish({ text: 'a wish' });
    await settle();
    expect(snap(r).ctx.phase).toBe('ready');
    r.session.setAdultConfirmed(false);
    expect(snap(r).adultConfirmed).toBe(true);
    r.session.dispatch({ type: 'rewrite' });
    expect(snap(r).adultConfirmed).toBe(true);
    r.session.setAdultConfirmed(false);
    expect(snap(r).adultConfirmed).toBe(false);
  });

  it('is cleared by the server saying the tick is missing (403 adult)', async () => {
    const r = await started(true, { adult: true });
    r.api.postGrant.mockResolvedValueOnce(failure('adult', ADULT_REQUIRED_MESSAGE, 403));
    r.session.submitWish({ text: 'a wish' });
    await settle();
    expect(snap(r).adultConfirmed).toBe(false);
    expect(snap(r).notice).toEqual({ kind: 'error', text: ADULT_REQUIRED_MESSAGE });
    expect(snap(r).ctx.phase).toBe('idle');
  });

  it('a region refusal on grant turns the page outside and shows the ready rounds', async () => {
    const r = await started(true, { adult: true });
    r.api.postGrant.mockResolvedValueOnce(failure('outside', 'Not from here.', 403));
    r.session.submitWish({ text: 'a wish' });
    await settle();
    expect(snap(r).live).toBe('outside');
    expect(snap(r).ctx.phase).toBe('idle');
    expect(snap(r).examples).toEqual({ kind: 'ready', entries: READY_ROUNDS });
  });

  it('a region refusal on bind turns the page outside too', async () => {
    const r = await started(true, { adult: true });
    r.session.submitWish({ text: 'a wish' });
    await settle();
    r.api.postBind.mockResolvedValueOnce(failure('outside', 'Not from here.', 403));
    r.session.dispatch({ type: 'circle_activated', index: 0 });
    r.session.dispatch({ type: 'bind_submitted', kind: 'ears-clause', clause: 'WHEN a THE SYSTEM SHALL b' });
    await settle();
    expect(snap(r).live).toBe('outside');
    expect(snap(r).ctx.phase).toBe('binding');
    expect(r.api.postBind.mock.calls[0]?.[2]).toBe(true);
  });
});

describe('a replayed round', () => {
  async function ready(): Promise<Rig> {
    const r = await started(false);
    r.session.submitWish(wishOf(READY));
    await settle();
    return r;
  }
  const clauseOf = (index: number): string => READY.grant.curses[index]?.binding?.clause ?? '';

  it('plays a full ready round to rest with no grant and no bind, and exports the properties', async () => {
    const r = await ready();
    for (let index = 0; index < 3; index += 1) {
      r.session.dispatch({ type: 'circle_activated', index });
      r.session.dispatch({ type: 'bind_submitted', kind: 'ears-clause', clause: `  ${clauseOf(index)}  ` });
      await settle();
    }
    const { ctx } = snap(r);
    expect(ctx.phase).toBe('ended');
    expect(ctx.endReason).toBe('all-closed');
    expect(r.api.postGrant).not.toHaveBeenCalled();
    expect(r.api.postBind).not.toHaveBeenCalled();
    expect(ctx.grant?.curses.every((c) => c.status === 'closed' && c.binding !== undefined && c.verdict?.property !== undefined)).toBe(true);
    expect(snap(r).view.medal?.score).toBe(5);
  });

  it('closes a whole ready round while examplesOnly is set, with no bind call (Req 13.8, 13.9)', async () => {
    const r = await started(true, { adult: true });
    r.api.postGrant.mockResolvedValueOnce(RESTING);
    r.session.submitWish({ text: 'a wish of my own' });
    await settle();
    expect(snap(r).examplesOnly).toBe(true);
    r.session.submitWish(wishOf(READY));
    await settle();
    for (let index = 0; index < 3; index += 1) {
      r.session.dispatch({ type: 'circle_activated', index });
      r.session.dispatch({ type: 'bind_submitted', kind: 'ears-clause', clause: clauseOf(index) });
      await settle();
    }
    expect(snap(r).examplesOnly).toBe(true);
    expect(snap(r).ctx.phase).toBe('ended');
    expect(snap(r).ctx.closedIds).toEqual(READY.grant.curses.map((c) => c.id));
    expect(r.api.postBind).not.toHaveBeenCalled();
  });

  it('keeps the card open with a line for an edited clause, and sends nothing', async () => {
    const r = await ready();
    r.session.dispatch({ type: 'circle_activated', index: 0 });
    r.session.dispatch({ type: 'bind_submitted', kind: 'ears-clause', clause: `${clauseOf(0)} Also, always.` });
    await settle();
    expect(snap(r).ctx.phase).toBe('binding');
    expect(snap(r).notice).toEqual({ kind: 'info', text: CLAUSE_AS_WRITTEN_MESSAGE });
    expect(r.api.postBind).not.toHaveBeenCalled();
    // The clause as written still works afterwards.
    r.session.dispatch({ type: 'bind_submitted', kind: 'ears-clause', clause: clauseOf(0) });
    await settle();
    expect(snap(r).ctx.closedIds).toEqual([READY.grant.curses[0]?.id]);
  });

  it('never calls postBind for a plain example, with a line that the Judge weighs only live wishes', async () => {
    const r = await started(true);
    r.session.submitWish(wishOf(plain()));
    await settle();
    r.session.dispatch({ type: 'circle_activated', index: 1 });
    r.session.dispatch({ type: 'bind_submitted', kind: 'ears-clause', clause: 'WHEN a THE SYSTEM SHALL b' });
    await settle();
    expect(r.api.postBind).not.toHaveBeenCalled();
    expect(snap(r).ctx.phase).toBe('binding');
    expect(snap(r).notice?.text).toBe(JUDGE_LIVE_ONLY_MESSAGE);
  });

  it('never calls postBind in a replay, even when the machine itself asks for a bind (a race)', async () => {
    const r = await started(true);
    r.session.submitWish(wishOf(plain()));
    await settle();
    r.session.dispatch({ type: 'circle_activated', index: 1 });
    // Straight to the effect: the guard in `request-bind` must hold on its own.
    r.session.dispatch({ type: 'bind_submitted', kind: 'rewrite', clause: 'WHEN a THE SYSTEM SHALL b' });
    await settle();
    expect(r.api.postBind).not.toHaveBeenCalled();
  });

  it('a live wish after Rewrite binds through the API again', async () => {
    const r = await started(true, { adult: true });
    r.session.submitWish(wishOf(READY));
    await settle();
    r.session.dispatch({ type: 'rewrite' });
    expect(snap(r).replayed).toBeNull();
    r.session.submitWish({ text: 'a live wish' });
    await settle();
    r.api.postBind.mockResolvedValueOnce(failure('server', 'The paw stumbles. Try again in a moment.', 500));
    r.session.dispatch({ type: 'circle_activated', index: 0 });
    r.session.dispatch({ type: 'bind_submitted', kind: 'ears-clause', clause: 'WHEN a THE SYSTEM SHALL b' });
    await flush();
    expect(r.api.postBind).toHaveBeenCalledTimes(1);
  });

  it('never mutates the ready rounds', async () => {
    const before = JSON.stringify(READY_ROUNDS);
    const r = await ready();
    r.session.dispatch({ type: 'circle_activated', index: 0 });
    r.session.dispatch({ type: 'bind_submitted', kind: 'ears-clause', clause: clauseOf(0) });
    await settle();
    expect(JSON.stringify(READY_ROUNDS)).toBe(before);
    expect(READY_ROUNDS[0]?.grant.curses[0]?.status).toBe('closed');
  });
});

describe('storage', () => {
  it('a session writes nothing to localStorage, sessionStorage or the cookie', async () => {
    const calls: string[] = [];
    const spy = (name: string) => vi.fn(() => void calls.push(name));
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: spy('local'), removeItem: spy('local'), clear: spy('local') });
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: spy('session'), removeItem: spy('session'), clear: spy('session') });
    try {
      const r = await started(true);
      r.session.setAdultConfirmed(true);
      r.session.submitWish({ text: 'a wish' });
      await settle();
      expect(calls).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the ready rounds stand in for the examples', () => {
  it.each([
    ['examples 503', (api: FakeApi) => api.getExamples.mockResolvedValue(RESTING)],
    ['examples empty', (api: FakeApi) => api.getExamples.mockResolvedValue(ok([]))],
    [
      'live and resting with a valid list',
      (api: FakeApi) => {
        api.getExamples.mockResolvedValue(ok([plain()]));
        api.getLive.mockResolvedValue(ok({ live: true, resting: true }));
      },
    ],
  ])('%s: the list is the ready rounds, and a ready round replays with the note and no request', async (_title, arrange) => {
    const api = fakeApi();
    arrange(api);
    const r = rig(api, { adult: false });
    r.session.start();
    await settle();
    expect(snap(r).examples).toEqual({ kind: 'ready', entries: READY_ROUNDS });
    const texts: string[] = [];
    r.session.subscribe(() => {
      const text = snap(r).liveText;
      if (text && texts[texts.length - 1] !== text) texts.push(text);
    });
    r.session.submitWish(wishOf(READY));
    expect(snap(r).replayed).toBe(READY);
    expect(api.postGrant).toHaveBeenCalledTimes(0);
    expect(api.postBind).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(texts.filter((text) => text === EXAMPLE_NOTE_MESSAGE)).toEqual([EXAMPLE_NOTE_MESSAGE]);
  });

  it('a live grant with the tick never announces the example note', async () => {
    const api = fakeApi();
    api.getExamples.mockResolvedValue(ok([plain()]));
    api.getLive.mockResolvedValue(ok({ live: true }));
    api.postGrant.mockResolvedValue(failure('outside', 'Not from here.', 403));
    const r = rig(api, { adult: true });
    r.session.start();
    await settle();
    const texts: string[] = [];
    r.session.subscribe(() => {
      const text = snap(r).liveText;
      if (text) texts.push(text);
    });
    r.session.submitWish({ text: 'A wish of my own', context: '' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.postGrant).toHaveBeenCalledTimes(1);
    expect(texts).not.toContain(EXAMPLE_NOTE_MESSAGE);
  });
});
