import { describe, expect, it, vi } from 'vitest';
import type { AnimCommand, PawEvent } from './paw-machine-types';
import { createSceneBridge, doneEventOf } from './scene-bridge';
import type { SceneEffect } from './scene-bridge';

const PLAY: SceneEffect = { type: 'play', command: { id: 4, kind: 'curl', digit: 2 } };

describe('doneEventOf', () => {
  it('maps each command kind to its done event with the command id', () => {
    const curl: AnimCommand = { id: 1, kind: 'curl', digit: 0 };
    const open: AnimCommand = { id: 2, kind: 'open', digit: 1 };
    const rest: AnimCommand = { id: 3, kind: 'rest' };
    expect(doneEventOf(curl)).toEqual({ type: 'curl_done', id: 1 });
    expect(doneEventOf(open)).toEqual({ type: 'open_done', id: 2 });
    expect(doneEventOf(rest)).toEqual({ type: 'rest_done', id: 3 });
  });
});

describe('createSceneBridge', () => {
  it('delivers nothing until a scene has subscribed and is ready', () => {
    const bridge = createSceneBridge();
    expect(bridge.send(PLAY)).toBe(false);
    const listener = vi.fn();
    bridge.subscribe(listener);
    expect(bridge.send(PLAY)).toBe(false);
    bridge.setReady(true);
    expect(bridge.isReady()).toBe(true);
    expect(bridge.send(PLAY)).toBe(true);
    expect(listener).toHaveBeenCalledWith(PLAY);
  });

  it('stops delivering after setReady(false) or unsubscribe', () => {
    const bridge = createSceneBridge();
    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);
    bridge.setReady(true);
    bridge.setReady(false);
    expect(bridge.send(PLAY)).toBe(false);
    bridge.setReady(true);
    unsubscribe();
    expect(bridge.send(PLAY)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('forwards done as the matching event', () => {
    const bridge = createSceneBridge();
    const seen: PawEvent[] = [];
    bridge.onDone((event) => seen.push(event));
    bridge.done({ id: 7, kind: 'open', digit: 3 });
    expect(seen).toEqual([{ type: 'open_done', id: 7 }]);
  });

  it('tells the session when a ready scene goes away, and only then', () => {
    const bridge = createSceneBridge();
    const detached = vi.fn();
    bridge.onDetach(detached);
    bridge.setReady(false);
    expect(detached).not.toHaveBeenCalled();
    bridge.subscribe(() => undefined);
    bridge.setReady(true);
    bridge.setReady(false);
    expect(detached).toHaveBeenCalledTimes(1);
  });

  describe('readiness belongs to the subscription', () => {
    it('a stale unsubscribe or setReady(false) leaves another ready subscriber ready', () => {
      const bridge = createSceneBridge();
      const first = vi.fn();
      const second = vi.fn();
      const stale = bridge.subscribe(first);
      stale.setReady(true);
      stale(); // the first driver is disposed
      const live = bridge.subscribe(second);
      live.setReady(true);

      stale(); // a second unsubscribe and a late report from the disposed one
      stale.setReady(false);
      stale.setReady(true);
      expect(bridge.isReady()).toBe(true);
      expect(bridge.send(PLAY)).toBe(true);
      expect(second).toHaveBeenCalledWith(PLAY);
      expect(first).not.toHaveBeenCalled();
    });

    it('a stale setReady(true) does not make the bridge ready again', () => {
      const bridge = createSceneBridge();
      const stale = bridge.subscribe(() => undefined);
      stale();
      stale.setReady(true);
      expect(bridge.isReady()).toBe(false);
    });

    it('is not ready once no ready subscriber is left, and a subscriber is not ready until it says so', () => {
      const bridge = createSceneBridge();
      const a = bridge.subscribe(() => undefined);
      const b = bridge.subscribe(() => undefined);
      expect(bridge.isReady()).toBe(false);
      a.setReady(true);
      expect(bridge.isReady()).toBe(true);
      a.setReady(false);
      expect(bridge.isReady()).toBe(false);
      b.setReady(true);
      b();
      expect(bridge.isReady()).toBe(false);
    });

    it('delivers only to ready subscribers', () => {
      const bridge = createSceneBridge();
      const ready = vi.fn();
      const waiting = vi.fn();
      bridge.subscribe(waiting);
      bridge.subscribe(ready).setReady(true);
      expect(bridge.send(PLAY)).toBe(true);
      expect(ready).toHaveBeenCalledTimes(1);
      expect(waiting).not.toHaveBeenCalled();
    });

    it('fires onDetach when the last ready subscriber goes, not before', () => {
      const bridge = createSceneBridge();
      const detached = vi.fn();
      bridge.onDetach(detached);
      const a = bridge.subscribe(() => undefined);
      const b = bridge.subscribe(() => undefined);
      a.setReady(true);
      b.setReady(true);
      a();
      expect(detached).not.toHaveBeenCalled();
      b.setReady(false);
      expect(detached).toHaveBeenCalledTimes(1);
      b(); // already unready: no second notice
      expect(detached).toHaveBeenCalledTimes(1);
    });

    it('the bridge-wide setReady(false) still clears every subscriber (a failure ends the scene)', () => {
      const bridge = createSceneBridge();
      const detached = vi.fn();
      bridge.onDetach(detached);
      bridge.subscribe(() => undefined).setReady(true);
      bridge.setReady(false);
      expect(bridge.isReady()).toBe(false);
      expect(detached).toHaveBeenCalledTimes(1);
    });
  });
});
