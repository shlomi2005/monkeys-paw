// Which cue plays on which session event (design.md "Sound (Req 7)"). The session derives cues from the same
// transitions that drive the scene. Fake API, fake timers, no audio.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleVerdict, withCurseStatus } from '../api/api-test-support';
import { initialState } from '../state/paw-machine';
import { createSceneBridge } from '../state/scene-bridge';
import { BIND, attachScene, fakeApi, flush, grantWith, grantRound, ok, plays, settle } from '../state/paw-session-test-support';
import type { FakeApi } from '../state/paw-session-test-support';
import { createPawSession } from '../state/use-paw-session';
import { cuesFor } from './cue-triggers';
import type { SoundCue } from './sound-types';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function rigWithCues(options: { reducedMotion?: boolean; curses?: number } = {}) {
  const api: FakeApi = fakeApi(grantWith(options.curses ?? 3));
  api.postBind.mockImplementation((request) =>
    Promise.resolve(
      ok({
        grant: withCurseStatus(request.grant, request.curseId, 'closed'),
        verdict: sampleVerdict(request.curseId, true),
      }),
    ),
  );
  const bridge = createSceneBridge();
  const cues: SoundCue[] = [];
  const session = createPawSession({
    initial: initialState(options.reducedMotion ?? false),
    api,
    bridge,
    onCue: (cue) => cues.push(cue),
  });
  const rig = { session, bridge, api };
  return { rig, cues, clear: () => cues.splice(0) };
}

async function closeCurse(r: ReturnType<typeof rigWithCues>['rig'], index: number): Promise<void> {
  r.session.dispatch({ type: 'circle_activated', index });
  r.session.dispatch(BIND);
  await settle();
}

describe('cues from the session', () => {
  it('creak when a curl starts, and the stamp when "Granted." appears', async () => {
    const { rig, cues } = rigWithCues();
    const received = attachScene(rig.bridge); // a ready scene: curls start one at a time, on `done`
    await grantRound(rig);
    expect(cues).toEqual(['creak', 'stamp']); // the first curl starts with the Grant; the stamp wins the overlap
    const first = plays(received)[0];
    rig.session.dispatch({ type: 'curl_done', id: first?.command.id as number });
    expect(cues).toEqual(['creak', 'stamp', 'creak']);
  });

  it('a creak for every curl, three curls for three curses', async () => {
    const { rig, cues } = rigWithCues();
    await grantRound(rig); // no scene: each curl finishes at once
    expect(cues).toEqual(['creak', 'stamp', 'creak', 'creak']);
  });

  it('sigh when an open starts', async () => {
    const { rig, cues, clear } = rigWithCues();
    await grantRound(rig);
    clear();
    await closeCurse(rig, 1);
    expect(cues).toEqual(['sigh']);
  });

  it('crack once when Stop ends the round with an open curse', async () => {
    const { rig, cues, clear } = rigWithCues();
    await grantRound(rig);
    clear();
    rig.session.dispatch({ type: 'stop' });
    expect(cues).toEqual(['crack']);
    rig.session.dispatch({ type: 'stop' }); // already ended: nothing
    expect(cues).toEqual(['crack']);
  });

  it('no crack when Stop comes with no open curse', async () => {
    const { rig, cues, clear } = rigWithCues();
    await grantRound(rig);
    for (const index of [0, 1, 2]) await closeCurse(rig, index);
    expect(rig.session.getSnapshot().ctx.endReason).toBe('all-closed');
    clear();
    rig.session.dispatch({ type: 'stop' });
    await flush();
    expect(cues).toEqual([]);
  });

  it('Stop before any Grant is silent', () => {
    const { rig, cues } = rigWithCues();
    rig.session.dispatch({ type: 'stop' });
    expect(cues).toEqual([]);
  });

  it('under reduced motion: one creak for the snap that adds the curls, then the stamp', async () => {
    const { rig, cues, clear } = rigWithCues({ reducedMotion: true });
    await grantRound(rig);
    expect(cues).toEqual(['creak', 'stamp']);
    clear();
    await closeCurse(rig, 0); // a snap that removes a curl adds none
    expect(cues).toEqual([]);
  });

  it('a snap that adds no curls is silent (motion preference turned on mid-round)', async () => {
    const { rig, cues, clear } = rigWithCues();
    await grantRound(rig);
    clear();
    rig.session.dispatch({ type: 'motion_preference_changed', reduced: true });
    expect(cues).toEqual([]);
  });

  it('a blank wish makes no sound', async () => {
    const { rig, cues } = rigWithCues();
    rig.session.submitWish({ text: '   ' });
    await flush();
    expect(cues).toEqual([]);
  });
});

describe('cuesFor', () => {
  it('Stop with no curse open is not a crack', async () => {
    const { rig } = rigWithCues();
    await grantRound(rig);
    const ready = rig.session.getSnapshot().ctx;
    const allClosed = { ...ready, closedIds: ready.grant?.curses.map((c) => c.id) ?? [] };
    const stopped = { ...allClosed, phase: 'ended' as const, endReason: 'stopped' as const };
    expect(cuesFor(allClosed, stopped, { type: 'stop' }, [], false)).toEqual([]);
    const withOpen = { ...ready, phase: 'ended' as const, endReason: 'stopped' as const };
    expect(cuesFor(ready, withOpen, { type: 'stop' }, [], false)).toEqual(['crack']);
  });
});
