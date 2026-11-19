// The session: the effect runner around the pure paw machine, and the React hook that wraps it
// (design.md sections 2, 5 "Effect runner", 6 "Examples-only play" and 7 "Live region").
//
// `createPawSession` is framework-free so most tests run in the node environment. It takes the
// reducer, an `ApiClient`, the scene bridge and a scheduler. `usePawSession` is a thin
// `useRef` / `useSyncExternalStore` wrapper around it.

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { defaultApiClient } from '../api/api-client';
import type { ApiClient } from '../api/api-client';
import type { ApiError, ApiResult } from '../api/api-errors';
import { JUDGE_RESTING_MESSAGE, RESTING_MESSAGE, SERVER_STUMBLE_MESSAGE } from '../api/api-messages';
import { normalizeGrant } from '../api/api-schemas';
import type { ExampleEntry, ExamplesState } from '../api/api-schemas';
import { cuesFor } from '../audio/cue-triggers';
import { createSoundController } from '../audio/sound-controller';
import type { SoundController } from '../audio/sound-controller';
import type { SoundCue } from '../audio/sound-types';
import { describe } from './paw-announcer';
import { initialState, reduce as defaultReduce } from './paw-machine';
import type { PawContext, PawEffect, PawEvent, Transition } from './paw-machine-types';
import { selectView } from './paw-selectors';
import type { PawView } from './paw-selectors';
import { createSceneBridge, doneEventOf } from './scene-bridge';
import type { SceneBridgeHost } from './scene-bridge';

/** An in-character line for the UI. Rendered as text only. */
export interface Notice {
  /** `error` for a failed request, `info` for a line the session itself produced (examples-only play). */
  readonly kind: 'error' | 'info';
  readonly text: string;
}

/** Pause between two live-region messages, so a screen reader does not drop one (design.md section 7). */
export const LIVE_GAP_MS = 300;

/** Timers and microtasks, injectable so tests control them. */
export interface Scheduler {
  /** Runs `fn` after `ms`. Returns a function that cancels it. */
  after(fn: () => void, ms: number): () => void;
  microtask(fn: () => void): void;
}

export const defaultScheduler: Scheduler = {
  after(fn, ms) {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
  microtask(fn) {
    queueMicrotask(fn);
  },
};

/** What the UI hands over when the user makes a wish. */
export interface SubmitWishInput {
  readonly text: string;
  readonly context?: string;
  /**
   * The example card that is selected right now, or null/undefined when none is. It only counts when the
   * wish line still holds its text (and no different context), so a typed or edited wish never replays.
   */
  readonly example?: ExampleEntry | null;
}

/** Everything the UI reads. A new object is made on each change, so it is safe for `useSyncExternalStore`. */
export interface PawSnapshot {
  readonly ctx: PawContext;
  readonly view: PawView;
  readonly examples: ExamplesState;
  readonly notice: Notice | null;
  /**
   * Set after a 503 or 429 on grant or bind (A9). Only unmodified example cards can be wished, and the
   * binding card shows `JUDGE_RESTING_MESSAGE` with Accept disabled: no bind request is ever sent.
   */
  readonly examplesOnly: boolean;
  /** The live-region text. Messages are queued and set one at a time, `LIVE_GAP_MS` apart. */
  readonly liveText: string;
  /** Counts accepted Grants. The "Granted." stamp plays whenever this changes. 0 before the first. */
  readonly grantedSeq: number;
  /**
   * Counts the messages shown in the live region. It changes on every message, even when the text repeats,
   * so the region can make the DOM text differ and a screen reader announces the repeat. 0 before the first.
   */
  readonly liveSeq: number;
}

export interface PawSession {
  readonly ctx: PawContext;
  readonly dispatch: (event: PawEvent) => void;
  readonly view: PawView;
  readonly examples: ExamplesState;
  readonly notice: Notice | null;
  readonly examplesOnly: boolean;
  readonly liveText: string;
  readonly grantedSeq: number;
  readonly liveSeq: number;
  /** "Make the wish". Replays a cached example without any API call while `examplesOnly` is set. */
  readonly submitWish: (input: SubmitWishInput) => void;
  /** The scene attaches to this: `subscribe`, `setReady` and `done`. */
  readonly bridge: SceneBridgeHost;
  /** The sound toggle's state and the lazy player. The session feeds it the cues. */
  readonly sound: SoundController;
}

export interface PawSessionOptions {
  readonly reduce?: (ctx: PawContext, event: PawEvent) => Transition;
  readonly initial: PawContext;
  readonly api: ApiClient;
  readonly bridge: SceneBridgeHost;
  readonly scheduler?: Scheduler;
  /**
   * Called for each sound cue, in order, on the transitions that drive the scene (design.md "Sound (Req 7)"). The
   * session does not know whether sound is on; the receiver decides.
   */
  readonly onCue?: (cue: SoundCue) => void;
}

/** The framework-free session. */
export interface PawSessionRunner {
  readonly getSnapshot: () => PawSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispatch: (event: PawEvent) => void;
  readonly submitWish: (input: SubmitWishInput) => void;
  /** Loads the examples once. Safe to call again after `dispose` (React strict mode mounts twice). */
  readonly start: () => void;
  /** Aborts every in-flight request and stops the live-region timer. */
  readonly dispose: () => void;
}

type NoticeOf = Notice | null;

/** Events that, once the machine accepts them, retire the previous notice. */
const NOTICE_CLEARING: ReadonlySet<PawEvent['type']> = new Set([
  'grant_requested',
  'grant_received',
  'bind_submitted',
  'verdict_received',
  'card_closed',
  'rewrite',
]);

interface QueuedEvent {
  readonly event: PawEvent;
  /** True for a cached replay: the `request-grant` effect is skipped, so no API call is made. */
  readonly offline: boolean;
}

/** The client never throws. This keeps a misbehaving one from stranding the machine in `granting` or `judging`. */
async function settled<T>(call: Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  try {
    return await call;
  } catch {
    return { ok: false, error: { kind: 'server', message: SERVER_STUMBLE_MESSAGE } };
  }
}

function isBlank(text: string | undefined): boolean {
  return text === undefined || text.trim() === '';
}

/** True when the wish line still holds the selected example, as the user was shown it. */
function isUnmodifiedExample(input: SubmitWishInput): input is SubmitWishInput & { example: ExampleEntry } {
  const example = input.example;
  if (example === null || example === undefined) return false;
  if (input.text.trim() !== example.wish.text.trim()) return false;
  return isBlank(input.context) || (input.context ?? '').trim() === (example.wish.context ?? '').trim();
}

export function createPawSession(options: PawSessionOptions): PawSessionRunner {
  const reduceFn = options.reduce ?? defaultReduce;
  const api = options.api;
  const bridge = options.bridge;
  const scheduler = options.scheduler ?? defaultScheduler;
  const onCue = options.onCue;

  let ctx = options.initial;
  let examples: ExamplesState = { kind: 'loading' };
  let notice: NoticeOf = null;
  let examplesOnly = false;
  let liveText = '';
  let grantedSeq = 0;
  let liveSeq = 0;
  /** Set when the transition being handled accepted a Grant, so "Granted." gets its stamp cue. */
  let grantedNow = false;

  let viewCtx = ctx;
  let view = selectView(ctx);
  let snapshot: PawSnapshot = { ctx, view, examples, notice, examplesOnly, liveText, grantedSeq, liveSeq };
  const listeners = new Set<() => void>();

  let grantController: AbortController | null = null;
  let bindController: AbortController | null = null;
  let examplesController: AbortController | null = null;

  const liveQueue: string[] = [];
  let cancelLiveGap: (() => void) | null = null;

  const pending: QueuedEvent[] = [];
  let draining = false;

  function emit(): void {
    if (viewCtx !== ctx) {
      viewCtx = ctx;
      view = selectView(ctx);
    }
    snapshot = { ctx, view, examples, notice, examplesOnly, liveText, grantedSeq, liveSeq };
    for (const listener of [...listeners]) listener();
  }

  // -- live region ----------------------------------------------------------

  function showLive(text: string): void {
    liveText = text;
    liveSeq += 1;
    cancelLiveGap = scheduler.after(() => {
      cancelLiveGap = null;
      const next = liveQueue.shift();
      if (next !== undefined) {
        showLive(next);
        emit();
      }
    }, LIVE_GAP_MS);
  }

  /** The first message is set at once. Later ones wait their turn. The caller emits. */
  function announce(text: string): void {
    if (cancelLiveGap === null) showLive(text);
    else liveQueue.push(text);
  }

  // -- requests -------------------------------------------------------------

  function abortInFlight(): void {
    grantController?.abort();
    bindController?.abort();
    grantController = null;
    bindController = null;
  }

  /** Records a failure for the UI and the live region. */
  function failWith(error: ApiError): void {
    notice = { kind: 'error', text: error.message };
    if (error.kind === 'resting') examplesOnly = true; // A9
    announce(error.message);
    emit();
  }

  async function runGrant(effect: Extract<PawEffect, { type: 'request-grant' }>): Promise<void> {
    grantController?.abort();
    const controller = new AbortController();
    grantController = controller;
    const request = effect.context === undefined ? { text: effect.text } : { text: effect.text, context: effect.context };
    const result = await settled(api.postGrant(request, controller.signal));
    if (controller.signal.aborted) return; // stop, rewrite or unmount: dispatch nothing
    if (grantController === controller) grantController = null;
    if (result.ok) {
      dispatch({ type: 'grant_received', wish: result.value.wish, grant: result.value.grant });
      return;
    }
    if (result.error.kind === 'aborted') return;
    failWith(result.error);
    dispatch({ type: 'grant_failed' });
  }

  async function runBind(effect: Extract<PawEffect, { type: 'request-bind' }>): Promise<void> {
    bindController?.abort();
    const controller = new AbortController();
    bindController = controller;
    const { curseId, kind, clause, grant } = effect;
    const result = await settled(api.postBind({ grant, curseId, kind, clause }, controller.signal));
    if (controller.signal.aborted) return;
    if (bindController === controller) bindController = null;
    if (result.ok) {
      const { verdict, grant: updated } = result.value;
      dispatch({ type: 'verdict_received', curseId, closed: verdict.closed, reason: verdict.reason, grant: updated });
      return;
    }
    if (result.error.kind === 'aborted') return;
    failWith(result.error);
    dispatch({ type: 'bind_failed' });
  }

  async function loadExamples(): Promise<void> {
    const controller = new AbortController();
    examplesController = controller;
    const result = await settled(api.getExamples(controller.signal));
    if (controller.signal.aborted) return;
    examplesController = null;
    // Any error, a 503 included, only means "unavailable". It is not shown as an error (Req 3.7).
    examples = result.ok ? { kind: 'ready', entries: result.value } : { kind: 'unavailable' };
    emit();
  }

  // -- effects --------------------------------------------------------------

  function runEffect(effect: PawEffect, offline: boolean): void {
    switch (effect.type) {
      case 'request-grant':
        if (!offline) void runGrant(effect);
        return;
      case 'request-bind':
        if (examplesOnly) {
          // The Judge is resting too (A9). Never reaches the API; the card stays open.
          notice = { kind: 'info', text: JUDGE_RESTING_MESSAGE };
          announce(JUDGE_RESTING_MESSAGE);
          emit();
          dispatch({ type: 'bind_failed' });
          return;
        }
        void runBind(effect);
        return;
      case 'abort-requests':
        abortInFlight();
        return;
      case 'play':
        // No scene: finish the command on a microtask so the queue cannot stall.
        if (!bridge.send(effect)) scheduler.microtask(() => dispatch(doneEventOf(effect.command)));
        return;
      case 'snap':
        bridge.send(effect); // no scene: a no-op
        return;
    }
  }

  // -- dispatch -------------------------------------------------------------

  function afterTransition(prev: PawContext, next: PawContext, event: PawEvent): void {
    if (NOTICE_CLEARING.has(event.type)) notice = null;
    if (event.type === 'rewrite') liveQueue.length = 0; // stale lines must not follow "The wish is unmade."
    if (event.type === 'stop' || event.type === 'rewrite') abortInFlight();
    if (event.type === 'grant_received' && prev.phase === 'granting' && next.grant === event.grant) {
      grantedSeq += 1;
      grantedNow = true;
    }
    const text = describe(prev, next, event);
    if (text !== null) announce(text);
  }

  function step({ event, offline }: QueuedEvent): void {
    if (event.type === 'bind_submitted' && examplesOnly && ctx.phase === 'binding' && !isBlank(event.clause)) {
      // Do not even enter `judging`: there is nobody to ask (A9).
      notice = { kind: 'info', text: JUDGE_RESTING_MESSAGE };
      announce(JUDGE_RESTING_MESSAGE);
      emit();
      return;
    }
    const prev = ctx;
    const { ctx: next, effects } = reduceFn(prev, event);
    grantedNow = false;
    if (next !== prev) {
      ctx = next;
      afterTransition(prev, next, event);
      emit();
      if (onCue !== undefined) for (const cue of cuesFor(prev, next, event, effects, grantedNow)) onCue(cue);
    }
    for (const effect of effects) runEffect(effect, offline);
  }

  /** Events raised while effects run (a scene calling `done` at once) wait their turn, so effects stay in order. */
  function enqueue(item: QueuedEvent): void {
    pending.push(item);
    if (draining) return;
    draining = true;
    try {
      for (let next = pending.shift(); next !== undefined; next = pending.shift()) step(next);
    } finally {
      draining = false;
    }
  }

  function dispatch(event: PawEvent): void {
    enqueue({ event, offline: false });
  }

  // -- wishing --------------------------------------------------------------

  function submitWish(input: SubmitWishInput): void {
    if (isBlank(input.text) || ctx.phase !== 'idle') return;
    const context = isBlank(input.context) ? undefined : input.context;

    if (!examplesOnly) {
      dispatch(
        context === undefined
          ? { type: 'grant_requested', text: input.text }
          : { type: 'grant_requested', text: input.text, context },
      );
      return;
    }

    // A9: the model is resting. Only an unmodified example can be wished, from its cached Grant.
    if (!isUnmodifiedExample(input)) {
      notice = { kind: 'info', text: RESTING_MESSAGE };
      announce(RESTING_MESSAGE);
      emit();
      return;
    }
    const { wish, grant } = input.example;
    enqueue({
      event:
        wish.context === undefined
          ? { type: 'grant_requested', text: wish.text }
          : { type: 'grant_requested', text: wish.text, context: wish.context },
      offline: true,
    });
    enqueue({ event: { type: 'grant_received', wish, grant: normalizeGrant(grant) }, offline: true });
  }

  // -- lifecycle ------------------------------------------------------------

  // A scene that goes away mid-command will never call `done`. Finish the command so the queue cannot stall.
  bridge.onDone((event) => dispatch(event));
  bridge.onDetach(() => {
    const active = ctx.anim.active;
    if (active !== null) scheduler.microtask(() => dispatch(doneEventOf(active)));
  });

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    submitWish,
    start() {
      if (examples.kind === 'loading' && examplesController === null) void loadExamples();
    },
    dispose() {
      abortInFlight();
      examplesController?.abort();
      examplesController = null;
      cancelLiveGap?.();
      cancelLiveGap = null;
      liveQueue.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// React wrapper
// ---------------------------------------------------------------------------

export interface UsePawSessionOptions {
  /** Defaults to the app's client (`VITE_API_BASE_URL`). Tests pass a fake. */
  readonly api?: ApiClient;
  /** The preference at mount time. Later changes arrive as `motion_preference_changed`. */
  readonly initialReducedMotion?: boolean;
  readonly scheduler?: Scheduler;
  /** Defaults to the app's controller (`localStorage['pawSoundEnabled']`, lazy player). Tests pass a fake. */
  readonly sound?: SoundController;
}

interface Held {
  readonly runner: PawSessionRunner;
  readonly bridge: SceneBridgeHost;
  readonly sound: SoundController;
}

export function usePawSession(options: UsePawSessionOptions = {}): PawSession {
  const held = useRef<Held | null>(null);
  if (held.current === null) {
    const bridge = createSceneBridge();
    const sound = options.sound ?? createSoundController();
    const runner = createPawSession({
      initial: initialState(options.initialReducedMotion ?? false),
      api: options.api ?? defaultApiClient(),
      bridge,
      onCue: (cue) => sound.cue(cue),
      ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    });
    held.current = { runner, bridge, sound };
  }
  const { runner, bridge, sound } = held.current;

  const snapshot = useSyncExternalStore(runner.subscribe, runner.getSnapshot, runner.getSnapshot);

  // GET /api/examples runs once on mount. Unmount aborts every request in flight. Sound restored as on waits for the
  // first gesture (Req 7.4); sound that is off does nothing here.
  useEffect(() => {
    runner.start();
    sound.start();
    return () => {
      runner.dispose();
      sound.dispose();
    };
  }, [runner, sound]);

  return useMemo(
    () => ({ ...snapshot, dispatch: runner.dispatch, submitWish: runner.submitWish, bridge, sound }),
    [snapshot, runner, bridge, sound],
  );
}
