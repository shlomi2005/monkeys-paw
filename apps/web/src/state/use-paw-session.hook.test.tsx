// @vitest-environment jsdom
// The hook is a thin wrapper: this one test renders it and drives a round through the public surface.

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/api-client';
import { SAMPLE_WISH_TEXT, sampleGrant, sampleWish } from '../api/api-test-support';
import { usePawSession } from './use-paw-session';

function fakeApi(): ApiClient {
  const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
  return {
    getExamples: vi.fn(() => ok([])),
    getLive: vi.fn(() => ok({ live: true })),
    postGrant: vi.fn(() => ok({ wish: sampleWish(), grant: sampleGrant() })),
    postBind: vi.fn(() => Promise.reject(new Error('unexpected bind'))),
    postExport: vi.fn(() => Promise.reject(new Error('unexpected export'))),
  };
}

describe('usePawSession', () => {
  it('loads examples on mount, runs a grant to ready and aborts on unmount', async () => {
    const api = fakeApi();
    const { result, unmount } = renderHook(() => usePawSession({ api }));

    expect(result.current.ctx.phase).toBe('idle');
    await waitFor(() => expect(result.current.examples.kind).toBe('ready'));
    expect(api.getExamples).toHaveBeenCalledTimes(1);

    act(() => result.current.setAdultConfirmed(true));
    act(() => {
      result.current.submitWish({ text: SAMPLE_WISH_TEXT });
    });
    expect(result.current.ctx.phase).toBe('granting');
    await waitFor(() => expect(result.current.ctx.phase).toBe('ready'));
    expect(result.current.view.circles[0].status).toBe('open');
    expect(result.current.grantedSeq).toBe(1);
    expect(result.current.liveText).toBe('Granted. 3 curses arrive.');
    expect(result.current.examplesOnly).toBe(false);
    expect(result.current.notice).toBeNull();

    act(() => result.current.dispatch({ type: 'circle_activated', index: 0 }));
    expect(result.current.ctx.phase).toBe('binding');
    expect(result.current.view.card?.curse.id).toBe('c1');

    // The scene attaches through the bridge the session owns.
    expect(result.current.bridge.isReady()).toBe(false);
    unmount();
  });

  it('aborts a request in flight on unmount', () => {
    const api = fakeApi();
    api.postGrant = vi.fn(() => new Promise<never>(() => undefined));
    const { result, unmount } = renderHook(() => usePawSession({ api }));
    act(() => result.current.setAdultConfirmed(true));
    act(() => {
      result.current.submitWish({ text: SAMPLE_WISH_TEXT });
    });
    const signal = vi.mocked(api.postGrant).mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
