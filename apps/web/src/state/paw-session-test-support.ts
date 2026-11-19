// Test support for the session runner tests: fake ApiClient, rig and fake scene. App code must never import it.

import type { Grant } from 'paw-core';
import { vi } from 'vitest';
import type { ApiClient } from '../api/api-client';
import type { ApiError, ApiResult } from '../api/api-errors';
import { RESTING_MESSAGE } from '../api/api-messages';
import { SAMPLE_WISH_TEXT, sampleGrant, sampleWish } from '../api/api-test-support';
import { initialState } from './paw-machine';
import type { PawEvent } from './paw-machine-types';
import { createSceneBridge } from './scene-bridge';
import type { SceneBridgeHost, SceneEffect } from './scene-bridge';
import { LIVE_GAP_MS, createPawSession } from './use-paw-session';
import type { PawSessionRunner } from './use-paw-session';

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export function ok<T>(value: T): ApiResult<T> {
  return { ok: true, value };
}

export function failure(kind: ApiError['kind'], message: string, status?: number): ApiResult<never> {
  return { ok: false, error: status === undefined ? { kind, message } : { kind, message, status } };
}

export const RESTING = failure('resting', RESTING_MESSAGE, 503);

/** A grant with `k` open curses (3 to 5). Ids are c1..ck. */
export function grantWith(k: number): Grant {
  const base = sampleGrant();
  const extra = Array.from({ length: Math.max(0, k - base.curses.length) }, (_, i) => ({
    id: `c${base.curses.length + i + 1}`,
    type: 'money' as const,
    story: `Extra story ${i}.`,
    loophole: `extra ${i}`,
    status: 'open' as const,
  }));
  return { ...base, curses: [...base.curses, ...extra].slice(0, k) };
}

export interface FakeApi extends ApiClient {
  readonly getExamples: ReturnType<typeof vi.fn<ApiClient['getExamples']>>;
  readonly postGrant: ReturnType<typeof vi.fn<ApiClient['postGrant']>>;
  readonly postBind: ReturnType<typeof vi.fn<ApiClient['postBind']>>;
  readonly postExport: ReturnType<typeof vi.fn<ApiClient['postExport']>>;
}

export function fakeApi(grant: Grant = sampleGrant()): FakeApi {
  return {
    getExamples: vi.fn<ApiClient['getExamples']>(() => Promise.resolve(ok([]))),
    postGrant: vi.fn<ApiClient['postGrant']>(() => Promise.resolve(ok({ wish: sampleWish(), grant }))),
    postBind: vi.fn<ApiClient['postBind']>(() => Promise.reject(new Error('unexpected bind'))),
    postExport: vi.fn<ApiClient['postExport']>(() => Promise.reject(new Error('unexpected export'))),
  };
}

export interface Rig {
  readonly session: PawSessionRunner;
  readonly bridge: SceneBridgeHost;
  readonly api: FakeApi;
}

export function rig(api: FakeApi = fakeApi()): Rig {
  const bridge = createSceneBridge();
  const session = createPawSession({ initial: initialState(false), api, bridge });
  return { session, bridge, api };
}

/** Lets pending promises and microtasks run. Timers do not advance. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

/** Runs microtasks, then moves the fake clock far enough to drain the live-region queue. */
export async function settle(): Promise<void> {
  await flush();
  await vi.advanceTimersByTimeAsync(LIVE_GAP_MS * 20);
  await flush();
}

export async function grantRound(r: Rig, text: string = SAMPLE_WISH_TEXT): Promise<void> {
  r.session.submitWish({ text });
  await settle();
}

/** A fake ready scene that records effects. `done` is left to the test. */
export function attachScene(bridge: SceneBridgeHost): SceneEffect[] {
  const received: SceneEffect[] = [];
  bridge.subscribe((effect) => received.push(effect));
  bridge.setReady(true);
  return received;
}

export function plays(received: readonly SceneEffect[]): Extract<SceneEffect, { type: 'play' }>[] {
  return received.filter((e): e is Extract<SceneEffect, { type: 'play' }> => e.type === 'play');
}

export const BIND: PawEvent = { type: 'bind_submitted', kind: 'ears-clause', clause: 'The system shall name a successor.' };

