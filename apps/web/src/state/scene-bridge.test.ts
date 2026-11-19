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
});
