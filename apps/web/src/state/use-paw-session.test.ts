// Tests for the session runner (design.md sections 5, 6 and 7). Fake ApiClient, fake timers, no network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVER_STUMBLE_MESSAGE } from '../api/api-messages';
import { SAMPLE_WISH_TEXT, sampleVerdict, withCurseStatus } from '../api/api-test-support';
import {
  BIND,
  attachScene,
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
import { LIVE_GAP_MS } from './use-paw-session';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Grant flow
// ---------------------------------------------------------------------------

describe('grant flow', () => {
  it('goes wish, request, grant_received, all curls complete with no scene, ready', async () => {
    const r = rig();
    r.session.submitWish({ text: SAMPLE_WISH_TEXT });
    expect(r.session.getSnapshot().ctx.phase).toBe('granting');
    expect(r.api.postGrant).toHaveBeenCalledTimes(1);
    expect(r.api.postGrant.mock.calls[0][0]).toEqual({ text: SAMPLE_WISH_TEXT });

    await flush();
    const snap = r.session.getSnapshot();
    expect(snap.ctx.phase).toBe('ready');
    expect(snap.ctx.curled).toEqual([0, 1, 2]);
    expect(snap.ctx.anim.active).toBeNull();
    expect(snap.view.circles.map((c) => c.status)).toEqual(['open', 'open', 'open', 'empty', 'empty']);
  });

  it('sends the context only when it is not blank', () => {
    const r = rig();
    r.session.submitWish({ text: 'A wish', context: '  ' });
    expect(r.api.postGrant.mock.calls[0][0]).toEqual({ text: 'A wish' });

    const other = rig();
    other.session.submitWish({ text: 'A wish', context: 'a shop' });
    expect(other.api.postGrant.mock.calls[0][0]).toEqual({ text: 'A wish', context: 'a shop' });
  });

  it('ignores a blank wish and a second wish while one is running', () => {
    const r = rig();
    r.session.submitWish({ text: '   ' });
    expect(r.api.postGrant).not.toHaveBeenCalled();
    r.session.submitWish({ text: 'one' });
    r.session.submitWish({ text: 'two' });
    expect(r.api.postGrant).toHaveBeenCalledTimes(1);
  });

  it('counts accepted Grants for the stamp', async () => {
    const r = rig();
    expect(r.session.getSnapshot().grantedSeq).toBe(0);
    await grantRound(r);
    expect(r.session.getSnapshot().grantedSeq).toBe(1);
    r.session.dispatch({ type: 'rewrite' });
    await grantRound(r);
    expect(r.session.getSnapshot().grantedSeq).toBe(2);
  });

  it('shows the in-character message and re-enables the form when the grant fails', async () => {
    const api = fakeApi();
    api.postGrant.mockResolvedValue(failure('bad-request', 'The paw trembles and refuses.', 400));
    const r = rig(api);
    r.session.submitWish({ text: 'harm' });
    await flush();
    const snap = r.session.getSnapshot();
    expect(snap.ctx.phase).toBe('idle');
    expect(snap.notice).toEqual({ kind: 'error', text: 'The paw trembles and refuses.' });
    expect(snap.examplesOnly).toBe(false);
    expect(snap.liveText).toBe('The paw trembles and refuses.');
  });

  it('clears the notice when the next wish is made', async () => {
    const api = fakeApi();
    api.postGrant.mockResolvedValueOnce(failure('network', 'The line to the paw is cut.'));
    const r = rig(api);
    r.session.submitWish({ text: 'a' });
    await flush();
    expect(r.session.getSnapshot().notice).not.toBeNull();
    r.session.submitWish({ text: 'a' });
    expect(r.session.getSnapshot().notice).toBeNull();
  });

  it('queues live-region messages with a gap and drops none', async () => {
    const r = rig();
    const seen: string[] = [r.session.getSnapshot().liveText];
    r.session.subscribe(() => {
      const text = r.session.getSnapshot().liveText;
      if (seen[seen.length - 1] !== text) seen.push(text);
    });
    r.session.submitWish({ text: SAMPLE_WISH_TEXT });
    await flush();
    // Granted plus three curl lines were produced in one tick; only the first is shown now.
    expect(seen).toEqual(['', 'Granted. 3 curses arrive.']);
    await vi.advanceTimersByTimeAsync(LIVE_GAP_MS);
    expect(seen).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(LIVE_GAP_MS * 5);
    expect(seen).toHaveLength(5);
    expect(seen[2]).toMatch(/^Curse 1, Permissions:/);
    expect(seen[3]).toMatch(/^Curse 2, Abuse:/);
    expect(seen[4]).toMatch(/^Curse 3, Data loss:/);
  });
});

// ---------------------------------------------------------------------------
// Bind flow
// ---------------------------------------------------------------------------

describe('bind flow', () => {
  async function readyRig(k = 3): Promise<Rig> {
    const r = rig(fakeApi(grantWith(k)));
    await grantRound(r);
    return r;
  }

  it('a closed verdict pops the top digit, opens it and closes the card', async () => {
    const r = await readyRig();
    const scene = attachScene(r.bridge);
    const grant = grantWith(3);
    r.api.postBind.mockResolvedValue(ok({ grant: withCurseStatus(grant, 'c1', 'closed'), verdict: sampleVerdict('c1', true) }));

    r.session.dispatch({ type: 'circle_activated', index: 0 });
    expect(r.session.getSnapshot().ctx.phase).toBe('binding');
    r.session.dispatch(BIND);
    expect(r.session.getSnapshot().ctx.phase).toBe('judging');
    expect(r.api.postBind).toHaveBeenCalledTimes(1);
    expect(r.api.postBind.mock.calls[0][0]).toMatchObject({ curseId: 'c1', kind: 'ears-clause' });
    await flush();

    const snap = r.session.getSnapshot();
    expect(snap.ctx.closedIds).toEqual(['c1']);
    expect(snap.ctx.curled).toEqual([0, 1]); // the top digit (2) popped, not digit 0
    expect(snap.view.circles[0].status).toBe('closed');
    expect(snap.view.card).toBeNull();
    const open = plays(scene).at(-1);
    expect(open?.command).toMatchObject({ kind: 'open', digit: 2 });

    r.bridge.done(open!.command);
    expect(r.session.getSnapshot().ctx.phase).toBe('ready');
    expect(r.session.getSnapshot().ctx.anim.active).toBeNull();
  });

  it('closing the last curse ends the round with a rest', async () => {
    const r = await readyRig();
    let current = grantWith(3);
    for (const id of ['c1', 'c2', 'c3']) {
      current = withCurseStatus(current, id, 'closed');
      r.api.postBind.mockResolvedValueOnce(ok({ grant: current, verdict: sampleVerdict(id, true) }));
      r.session.dispatch({ type: 'circle_activated', index: Number(id.slice(1)) - 1 });
      r.session.dispatch(BIND);
      await settle();
    }
    const snap = r.session.getSnapshot();
    expect(snap.ctx.phase).toBe('ended');
    expect(snap.ctx.endReason).toBe('all-closed');
    expect(snap.view.medal).toMatchObject({ closed: 3, open: 0 });
  });

  it('a not-closed verdict keeps the card open and says "The paw remembers."', async () => {
    const r = await readyRig();
    r.api.postBind.mockResolvedValue(ok({ grant: grantWith(3), verdict: sampleVerdict('c2', false) }));
    r.session.dispatch({ type: 'circle_activated', index: 1 });
    r.session.dispatch(BIND);
    await flush();

    const snap = r.session.getSnapshot();
    expect(snap.ctx.phase).toBe('binding');
    expect(snap.ctx.curled).toEqual([0, 1, 2]);
    expect(snap.ctx.closedIds).toEqual([]);
    expect(snap.view.card?.remembers).toBe(true);
    expect(snap.liveText).toContain('The paw remembers.');
  });

  it('a bind failure keeps the card open and shows the message', async () => {
    const r = await readyRig();
    r.api.postBind.mockResolvedValue(failure('server', SERVER_STUMBLE_MESSAGE, 500));
    r.session.dispatch({ type: 'circle_activated', index: 1 });
    r.session.dispatch(BIND);
    await flush();

    const snap = r.session.getSnapshot();
    expect(snap.ctx.phase).toBe('binding');
    expect(snap.view.card?.curse.id).toBe('c2');
    expect(snap.notice).toEqual({ kind: 'error', text: SERVER_STUMBLE_MESSAGE });
    expect(snap.liveText).toBe(SERVER_STUMBLE_MESSAGE);
    expect(snap.examplesOnly).toBe(false);
  });

  it('a blank clause sends nothing', async () => {
    const r = await readyRig();
    r.session.dispatch({ type: 'circle_activated', index: 1 });
    r.session.dispatch({ type: 'bind_submitted', kind: 'ears-clause', clause: '   ' });
    expect(r.api.postBind).not.toHaveBeenCalled();
    expect(r.session.getSnapshot().ctx.phase).toBe('binding');
  });
});
