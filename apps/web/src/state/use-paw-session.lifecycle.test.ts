// Session runner: aborts, scene hand-off, examples and examples-only play (A9).
// Fake ApiClient, fake timers, no network.

import { READY_ROUNDS } from './ready-rounds';
import type { Grant } from 'paw-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '../api/api-errors';
import { JUDGE_RESTING_MESSAGE, RESTING_MESSAGE } from '../api/api-messages';
import type { ExampleEntry } from '../api/api-schemas';
import { SAMPLE_WISH_TEXT, sampleVerdict, sampleWish, withCurseStatus } from '../api/api-test-support';
import {
  BIND,
  RESTING,
  attachScene,
  deferred,
  failure,
  fakeApi,
  flush,
  grantRound,
  grantWith,
  ok,
  plays,
  rig,
  settle,
} from './paw-session-test-support';
import type { Rig } from './paw-session-test-support';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

type BindResult = ApiResult<{ grant: Grant; verdict: ReturnType<typeof sampleVerdict> }>;

/** Grant resolved, one curse card open and the bind request left hanging. Returns the pending result. */
async function judging(): Promise<{ r: Rig; pending: ReturnType<typeof deferred<BindResult>>; signal: () => AbortSignal }> {
  const r = rig(fakeApi(grantWith(3)));
  await grantRound(r);
  const pending = deferred<BindResult>();
  r.api.postBind.mockReturnValue(pending.promise);
  r.session.dispatch({ type: 'circle_activated', index: 1 });
  r.session.dispatch(BIND);
  expect(r.session.getSnapshot().ctx.phase).toBe('judging');
  return { r, pending, signal: () => r.api.postBind.mock.calls[0][1] as AbortSignal };
}

describe('aborting requests', () => {
  it('stop while judging aborts the request and a late resolve is discarded', async () => {
    const { r, pending, signal } = await judging();
    expect(signal().aborted).toBe(false);

    r.session.dispatch({ type: 'stop' });
    expect(signal().aborted).toBe(true);
    const after = r.session.getSnapshot().ctx;
    expect(after.phase).toBe('ended');

    pending.resolve(ok({ grant: withCurseStatus(grantWith(3), 'c2', 'closed'), verdict: sampleVerdict('c2', true) }));
    await flush();
    expect(r.session.getSnapshot().ctx).toBe(after);
    expect(r.session.getSnapshot().ctx.closedIds).toEqual([]);
  });

  it('a late failure after stop shows nothing', async () => {
    const { r, pending } = await judging();
    r.session.dispatch({ type: 'stop' });
    pending.resolve(failure('server', 'The paw stumbles. Try again in a moment.', 500));
    await flush();
    expect(r.session.getSnapshot().notice).toBeNull();
  });

  it('rewrite while granting aborts the request and drops the late grant', async () => {
    const r = rig();
    const pending = deferred<ApiResult<{ wish: ReturnType<typeof sampleWish>; grant: Grant }>>();
    r.api.postGrant.mockReturnValue(pending.promise);
    r.session.submitWish({ text: SAMPLE_WISH_TEXT });
    const signal = r.api.postGrant.mock.calls[0][1] as AbortSignal;

    r.session.dispatch({ type: 'rewrite' });
    expect(signal.aborted).toBe(true);
    expect(r.session.getSnapshot().ctx.phase).toBe('idle');

    pending.resolve(ok({ wish: sampleWish(), grant: grantWith(3) }));
    await flush();
    expect(r.session.getSnapshot().ctx.phase).toBe('idle');
    expect(r.session.getSnapshot().ctx.grant).toBeNull();
  });

  it('rewrite while judging aborts the bind request', async () => {
    const { r, signal } = await judging();
    r.session.dispatch({ type: 'rewrite' });
    expect(signal().aborted).toBe(true);
    expect(r.session.getSnapshot().ctx.phase).toBe('idle');
  });

  it('an ignored stop while granting does not abort the grant', async () => {
    const r = rig();
    r.api.postGrant.mockReturnValue(deferred<never>().promise);
    r.session.submitWish({ text: 'a wish' });
    r.session.dispatch({ type: 'stop' });
    expect((r.api.postGrant.mock.calls[0][1] as AbortSignal).aborted).toBe(false);
  });

  it('dispose (unmount) aborts a grant in flight and the examples request', async () => {
    const r = rig();
    r.api.postGrant.mockReturnValue(deferred<never>().promise);
    r.api.getExamples.mockReturnValue(deferred<never>().promise);
    r.session.start();
    r.session.submitWish({ text: 'a wish' });
    r.session.dispose();
    expect((r.api.postGrant.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    expect((r.api.getExamples.mock.calls[0][0] as AbortSignal).aborted).toBe(true);
  });

  it('dispose aborts a bind request in flight', async () => {
    const { r, signal } = await judging();
    r.session.dispose();
    expect(signal().aborted).toBe(true);
  });

  it('start after dispose loads the examples again, and a second start does not', async () => {
    const r = rig();
    r.session.start();
    r.session.start();
    expect(r.api.getExamples).toHaveBeenCalledTimes(1);
    r.session.dispose();
    r.session.start();
    expect(r.api.getExamples).toHaveBeenCalledTimes(2);
    await flush();
    expect(r.session.getSnapshot().examples.kind).toBe('ready');
  });
});

describe('the scene bridge', () => {
  it('with no scene, five curls complete and nothing stalls', async () => {
    const r = rig(fakeApi(grantWith(5)));
    r.session.submitWish({ text: SAMPLE_WISH_TEXT });
    await flush();
    const ctx = r.session.getSnapshot().ctx;
    expect(ctx.phase).toBe('ready');
    expect(ctx.curled).toEqual([0, 1, 2, 3, 4]);
    expect(ctx.anim.active).toBeNull();
    expect(ctx.anim.queue).toEqual([]);
  });

  it('with a ready scene, play goes to the bridge and nothing completes until done is called', async () => {
    const r = rig(fakeApi(grantWith(3)));
    const scene = attachScene(r.bridge);
    r.session.submitWish({ text: SAMPLE_WISH_TEXT });
    await flush();

    expect(r.session.getSnapshot().ctx.phase).toBe('curling');
    expect(plays(scene).map((e) => e.command)).toEqual([{ id: 0, kind: 'curl', digit: 0 }]);

    for (let i = 0; i < 3; i += 1) {
      const command = plays(scene)[i].command;
      r.bridge.done(command);
      await flush();
    }
    expect(plays(scene).map((e) => e.command.digit)).toEqual([0, 1, 2]);
    expect(r.session.getSnapshot().ctx.phase).toBe('ready');
  });

  it('a late done after a snap is ignored', async () => {
    const r = rig(fakeApi(grantWith(3)));
    const scene = attachScene(r.bridge);
    r.session.submitWish({ text: SAMPLE_WISH_TEXT });
    await flush();
    const playing = plays(scene)[0].command;

    r.session.dispatch({ type: 'stop' });
    expect(scene.at(-1)).toEqual({ type: 'snap', amounts: [1, 1, 1, 0, 0], pose: 'upright' });
    const after = r.session.getSnapshot().ctx;
    expect(after.anim.active).toBeNull();

    r.bridge.done(playing);
    await flush();
    expect(r.session.getSnapshot().ctx).toBe(after);
  });

  it('a snap with no scene is a no-op and stop still ends the round', async () => {
    const r = rig(fakeApi(grantWith(3)));
    await grantRound(r);
    r.session.dispatch({ type: 'stop' });
    await flush();
    expect(r.session.getSnapshot().ctx.phase).toBe('ended');
    expect(r.session.getSnapshot().view.medal).not.toBeNull();
  });

  it('finishes the active command when the scene goes away mid-command', async () => {
    const r = rig(fakeApi(grantWith(3)));
    attachScene(r.bridge);
    r.session.submitWish({ text: SAMPLE_WISH_TEXT });
    await flush();
    expect(r.session.getSnapshot().ctx.phase).toBe('curling');

    r.bridge.setReady(false);
    await flush();
    expect(r.session.getSnapshot().ctx.phase).toBe('ready');
  });

  it('one scene `done` raised while effects run does not reorder them', async () => {
    const r = rig(fakeApi(grantWith(3)));
    r.bridge.subscribe((effect) => {
      if (effect.type === 'play') r.bridge.done(effect.command); // a scene that finishes at once
    });
    r.bridge.setReady(true);
    r.session.submitWish({ text: SAMPLE_WISH_TEXT });
    await flush();
    expect(r.session.getSnapshot().ctx.phase).toBe('ready');
  });
});

function example(text: string, k = 3): ExampleEntry {
  // The cache may carry closed curses and bindings; a replay starts clean.
  const grant = withCurseStatus(grantWith(k), 'c1', 'closed');
  return { wish: sampleWish(text), grant };
}

describe('examples', () => {
  it('loads once on start and becomes ready', async () => {
    const api = fakeApi();
    const entries = [example('Example one'), example('Example two')];
    api.getExamples.mockResolvedValue(ok(entries));
    const r = rig(api);
    expect(r.session.getSnapshot().examples).toEqual({ kind: 'loading' });
    r.session.start();
    await flush();
    expect(r.session.getSnapshot().examples).toEqual({ kind: 'ready', entries });
    expect(api.getExamples).toHaveBeenCalledTimes(1);
  });

  it('is the ready rounds on a 503, and that is not shown as an error', async () => {
    const api = fakeApi();
    api.getExamples.mockResolvedValue(RESTING);
    const r = rig(api);
    r.session.start();
    await flush();
    const snap = r.session.getSnapshot();
    expect(snap.examples).toEqual({ kind: 'ready', entries: READY_ROUNDS });
    expect(snap.notice).toBeNull();
    expect(snap.examplesOnly).toBe(false);
    expect(snap.liveText).toBe('');
  });

  it('is the ready rounds on any other error', async () => {
    const api = fakeApi();
    api.getExamples.mockResolvedValue(failure('network', 'The line to the paw is cut.'));
    const r = rig(api);
    r.session.start();
    await flush();
    expect(r.session.getSnapshot().examples).toEqual({ kind: 'ready', entries: READY_ROUNDS });
  });

  it('a selected example calls the API as usual while the paw is awake', async () => {
    const r = rig();
    const entry = example('Example one');
    r.session.submitWish({ text: 'Example one', example: entry });
    expect(r.api.postGrant).toHaveBeenCalledTimes(1);
  });
});

describe('examples-only play (A9)', () => {
  /** A grant request answered 503: the session is now in examples-only play. */
  async function resting(): Promise<Rig> {
    const api = fakeApi();
    api.postGrant.mockResolvedValueOnce(RESTING);
    const r = rig(api);
    r.session.submitWish({ text: 'a first wish' });
    await flush();
    return r;
  }

  it('a 503 on grant shows the message, returns to idle and sets examplesOnly', async () => {
    const r = await resting();
    const snap = r.session.getSnapshot();
    expect(snap.examplesOnly).toBe(true);
    expect(snap.ctx.phase).toBe('idle');
    expect(snap.notice).toEqual({ kind: 'error', text: RESTING_MESSAGE });
  });

  it('replays an unmodified example from its cache with no API call, normalized', async () => {
    const r = await resting();
    const entry = example('Example one', 4);
    r.session.submitWish({ text: 'Example one', example: entry });
    await settle();

    expect(r.api.postGrant).toHaveBeenCalledTimes(1); // only the first, failed, wish
    const snap = r.session.getSnapshot();
    expect(snap.ctx.phase).toBe('ready');
    expect(snap.ctx.wish).toBe(entry.wish);
    expect(snap.ctx.curled).toEqual([0, 1, 2, 3]);
    expect(snap.ctx.closedIds).toEqual([]);
    expect(snap.ctx.grant?.curses.every((c) => c.status === 'open')).toBe(true);
    expect(snap.notice).toBeNull();
    expect(snap.grantedSeq).toBe(1);
  });

  it('a typed wish shows the resting message and makes no request', async () => {
    const r = await resting();
    r.session.submitWish({ text: 'something I typed', example: null });
    const snap = r.session.getSnapshot();
    expect(snap.ctx.phase).toBe('idle');
    expect(snap.notice).toEqual({ kind: 'info', text: RESTING_MESSAGE });
    expect(r.api.postGrant).toHaveBeenCalledTimes(1);
  });

  it('an edited example counts as typed', async () => {
    const r = await resting();
    r.session.submitWish({ text: 'Example one, but louder', example: example('Example one') });
    expect(r.session.getSnapshot().ctx.phase).toBe('idle');
    expect(r.session.getSnapshot().notice?.text).toBe(RESTING_MESSAGE);
    expect(r.api.postGrant).toHaveBeenCalledTimes(1);
  });

  it('bind never reaches the API while resting, and the card stays open', async () => {
    const r = await resting();
    r.session.submitWish({ text: 'Example one', example: example('Example one') });
    await settle();
    r.session.dispatch({ type: 'circle_activated', index: 1 });
    expect(r.session.getSnapshot().ctx.phase).toBe('binding');

    r.session.dispatch(BIND);
    await flush();
    const snap = r.session.getSnapshot();
    expect(r.api.postBind).not.toHaveBeenCalled();
    expect(snap.ctx.phase).toBe('binding');
    expect(snap.view.card?.curse.id).toBe('c2');
    expect(snap.notice).toEqual({ kind: 'info', text: JUDGE_RESTING_MESSAGE });
    expect(snap.examplesOnly).toBe(true);

    // Cancel still works.
    r.session.dispatch({ type: 'card_closed' });
    expect(r.session.getSnapshot().ctx.phase).toBe('ready');
  });

  it('a 503 on bind sets examplesOnly, keeps the card open and blocks the next bind', async () => {
    const r = rig(fakeApi(grantWith(3)));
    await grantRound(r);
    r.api.postBind.mockResolvedValueOnce(RESTING);
    r.session.dispatch({ type: 'circle_activated', index: 0 });
    r.session.dispatch(BIND);
    await flush();
    expect(r.session.getSnapshot().ctx.phase).toBe('binding');
    expect(r.session.getSnapshot().examplesOnly).toBe(true);
    expect(r.session.getSnapshot().notice).toEqual({ kind: 'error', text: RESTING_MESSAGE });

    r.session.dispatch(BIND);
    await flush();
    expect(r.api.postBind).toHaveBeenCalledTimes(1);
    expect(r.session.getSnapshot().ctx.phase).toBe('binding');
  });

  it('rewrite still works while resting', async () => {
    const r = await resting();
    r.session.submitWish({ text: 'Example one', example: example('Example one') });
    await settle();
    r.session.dispatch({ type: 'rewrite' });
    expect(r.session.getSnapshot().ctx.phase).toBe('idle');
    expect(r.session.getSnapshot().examplesOnly).toBe(true);
  });
});
