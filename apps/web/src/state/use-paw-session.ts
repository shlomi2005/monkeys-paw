// The session: the effect runner around the pure paw machine, and the React hook that wraps it
// (design.md sections 2, 5 "Effect runner", 6 "Examples-only play" and 7 "Live region").
//
// `createPawSession` is framework-free so most tests run in the node environment. It takes the
// reducer, an `ApiClient`, the scene bridge and a scheduler. `usePawSession` is a thin
// `useRef` / `useSyncExternalStore` wrapper around it.

import type { Grant } from 'paw-core';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { defaultApiClient } from '../api/api-client';
import type { ApiClient } from '../api/api-client';
import type { ApiError, ApiResult } from '../api/api-errors';
import {
  CLAUSE_AS_WRITTEN_MESSAGE,
  JUDGE_LIVE_ONLY_MESSAGE,
  JUDGE_RESTING_MESSAGE,
  NO_LIVE_WISH_MESSAGE,
  OUTSIDE_NOTE_MESSAGE,
  RESTING_MESSAGE,
  SERVER_STUMBLE_MESSAGE,
} from '../api/api-messages';
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
import { READY_ROUNDS, isReadyRound } from './ready-rounds';
import { EXAMPLE_NOTE_MESSAGE } from '../api/api-messages';
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

/** Where the page stands on live wishes (Req 13.1). `outside` is sticky: nothing clears it. */
export type LiveState = 'unknown' | 'open' | 'outside';

/** What `submitWish` did. Only `adult-required` asks the UI to show the age alert and focus the checkbox. */
export type SubmitOutcome = 'ignored' | 'replayed' | 'outside' | 'resting' | 'adult-required' | 'sent';

/** The examples shown when live wishes are outside, the examples are unavailable or empty, or the paw rests: the ready rounds. */
const READY_EXAMPLES: ExamplesState = { kind: 'ready', entries: READY_ROUNDS };

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
  /** `GET /api/live` and refusals (Req 13.1). Memory only. */
  readonly live: LiveState;
  /** The 18+ tick (Req 13.2). Memory only, kept through Rewrite. */
  readonly adultConfirmed: boolean;
  /** The example whose round is being replayed from memory (no grant, no bind), until Rewrite. Null otherwise. */
  readonly replayed: ExampleEntry | null;
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
  readonly live: LiveState;
  readonly adultConfirmed: boolean;
  readonly replayed: ExampleEntry | null;
  /** The checkbox. Ignored unless the machine is idle. */
  readonly setAdultConfirmed: (value: boolean) => void;
  /** "Make the wish" in the six steps of design \"Live gate and ready rounds\". Replays an example from memory when it may. */
  readonly submitWish: (input: SubmitWishInput) => SubmitOutcome;
  /** The scene attaches to this: `subscribe`, `setReady` and `done`. */
  readonly bridge: SceneBridgeHost;
  /** The sound toggle's state and the lazy player. The session feeds it the cues. */
  readonly sound: SoundController;
  /** The client the session calls. The export buttons use it for `postExport` (design.md section 6, "Export"). */
  readonly api: ApiClient;
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
  readonly submitWish: (input: SubmitWishInput) => SubmitOutcome;
  readonly setAdultConfirmed: (value: boolean) => void;
  /** Loads the examples and probes `/api/live` once. Safe to call again after `dispose` (React strict mode mounts twice). */
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
  /** True for a replay from memory: the `request-grant` and `request-bind` effects are skipped, so no API call is made. */
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
  let stored: ExamplesState = { kind: 'loading' };
  let examples: ExamplesState = stored;
  let live: LiveState = 'unknown';
  let adultConfirmed = false;
  let replayed: ExampleEntry | null = null;
  let notice: NoticeOf = null;
  let examplesOnly = false;
  let liveText = '';
  let grantedSeq = 0;
  let liveSeq = 0;
  /** Set when the transition being handled accepted a Grant, so "Granted." gets its stamp cue. */
  let grantedNow = false;

  let viewCtx = ctx;
  let view = selectView(ctx);
  let snapshot: PawSnapshot = { ctx, view, examples, notice, examplesOnly, liveText, grantedSeq, liveSeq, live, adultConfirmed, replayed };
  const listeners = new Set<() => void>();

  let grantController: AbortController | null = null;
  let bindController: AbortController | null = null;
  let examplesController: AbortController | null = null;
  let liveController: AbortController | null = null;
  let liveProbed = false;

  const liveQueue: string[] = [];
  let cancelLiveGap: (() => void) | null = null;

  const pending: QueuedEvent[] = [];
  let draining = false;

  function emit(): void {
    if (viewCtx !== ctx) {
      viewCtx = ctx;
      view = selectView(ctx);
    }
    examples =
      live === 'outside' ||
      examplesOnly ||
      stored.kind === 'unavailable' ||
      (stored.kind === 'ready' && stored.entries.length === 0)
        ? READY_EXAMPLES
        : stored;
    snapshot = { ctx, view, examples, notice, examplesOnly, liveText, grantedSeq, liveSeq, live, adultConfirmed, replayed };
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
    if (error.kind === 'adult') adultConfirmed = false; // the server says the tick is missing (Req 13.5)
    announce(error.message);
    if (error.kind === 'outside') becomeOutside();
    emit();
  }

  /** The refusal and the probe both end here. The line is announced once, when it becomes known. The caller emits. */
  function becomeOutside(): void {
    if (live === 'outside') return;
    live = 'outside';
    announce(OUTSIDE_NOTE_MESSAGE);
  }

  async function runGrant(effect: Extract<PawEffect, { type: 'request-grant' }>): Promise<void> {
    grantController?.abort();
    const controller = new AbortController();
    grantController = controller;
    const request = effect.context === undefined ? { text: effect.text } : { text: effect.text, context: effect.context };
    const result = await settled(api.postGrant(request, controller.signal, adultConfirmed));
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
    const result = await settled(api.postBind({ grant, curseId, kind, clause }, controller.signal, adultConfirmed));
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
    stored = result.ok ? { kind: 'ready', entries: result.value } : { kind: 'unavailable' };
    emit();
  }

  async function loadLive(): Promise<void> {
    const controller = new AbortController();
    liveController = controller;
    const result = await settled(api.getLive(controller.signal));
    if (controller.signal.aborted) return;
    liveController = null;
    liveProbed = true;
    // A failure leaves `unknown`: the server still decides. `outside` is sticky, so a late `true` changes nothing.
    if (result.ok) {
      if (result.value.resting === true) examplesOnly = true;
      if (!result.value.live) becomeOutside();
      else if (live === 'unknown') live = 'open';
    }
    emit();
  }

  // -- effects --------------------------------------------------------------

  function runEffect(effect: PawEffect, offline: boolean): void {
    switch (effect.type) {
      case 'request-grant':
        if (!offline) void runGrant(effect);
        return;
      case 'request-bind':
        if (offline) return; // a replay from memory: the verdict is dispatched by the session
        if (replayed !== null) {
          // Never reaches the API in a replayed round, whatever raised the event (a race, a forced click).
          notice = { kind: 'info', text: examplesOnly ? JUDGE_RESTING_MESSAGE : JUDGE_LIVE_ONLY_MESSAGE };
          announce(notice.text);
          emit();
          dispatch({ type: 'bind_failed' });
          return;
        }
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
    if (event.type === 'rewrite') {
      replayed = null;
      liveQueue.length = 0; // stale lines must not follow "The wish is unmade."
    }
    if (event.type === 'stop' || event.type === 'rewrite') abortInFlight();
    if (event.type === 'grant_received' && prev.phase === 'granting' && next.grant === event.grant) {
      grantedSeq += 1;
      grantedNow = true;
    }
    const text = describe(prev, next, event);
    if (text !== null) announce(text);
  }

  /**
   * Accept in a replayed round: no bind request, ever. A ready round accepts only its own clause (trimmed) and plays
   * its verdict through the same events as a live one. Anything else leaves the card open with a line.
   */
  function replayBind(event: Extract<PawEvent, { type: 'bind_submitted' }>): void {
    const curse = replayed?.grant.curses.find((c) => c.id === ctx.pendingCurseId);
    const binding = curse?.binding;
    const verdict = curse?.verdict;
    const current = ctx.grant;
    if (replayed === null || curse === undefined || binding === undefined || verdict === undefined || current === null || !isReadyRound(replayed)) {
      const text = examplesOnly ? JUDGE_RESTING_MESSAGE : JUDGE_LIVE_ONLY_MESSAGE;
      notice = { kind: 'info', text };
      announce(text);
      emit();
      return;
    }
    if (event.clause.trim() !== binding.clause.trim()) {
      notice = { kind: 'info', text: CLAUSE_AS_WRITTEN_MESSAGE };
      announce(CLAUSE_AS_WRITTEN_MESSAGE);
      emit();
      return;
    }
    const closedGrant: Grant = {
      ...current,
      curses: current.curses.map((c) => (c.id === curse.id ? { ...c, status: 'closed' as const, binding, verdict } : c)),
    };
    enqueue({ event, offline: true });
    enqueue({
      event: { type: 'verdict_received', curseId: curse.id, closed: true, reason: verdict.reason, grant: closedGrant },
      offline: true,
    });
  }

  function step({ event, offline }: QueuedEvent): void {
    if (event.type === 'bind_submitted' && !offline && replayed !== null && ctx.phase === 'binding' && !isBlank(event.clause)) {
      replayBind(event);
      return;
    }
    if (event.type === 'bind_submitted' && !offline && examplesOnly && ctx.phase === 'binding' && !isBlank(event.clause)) {
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

  /** Plays an example from memory: the machine runs as usual, and no request is made. */
  function replay(entry: ExampleEntry): void {
    const { wish, grant } = entry;
    replayed = entry;
    enqueue({
      event:
        wish.context === undefined
          ? { type: 'grant_requested', text: wish.text }
          : { type: 'grant_requested', text: wish.text, context: wish.context },
      offline: true,
    });
    enqueue({ event: { type: 'grant_received', wish, grant: normalizeGrant(grant) }, offline: true });
    if (isReadyRound(entry) && ctx.phase !== 'idle') {
      announce(EXAMPLE_NOTE_MESSAGE);
      emit();
    }
  }

  function say(text: string): void {
    notice = { kind: 'info', text };
    announce(text);
    emit();
  }

  /** The six steps of design "Live gate and ready rounds". Nothing is sent in steps 1 to 5. */
  function submitWish(input: SubmitWishInput): SubmitOutcome {
    // 1. Not idle (or blank): nothing.
    if (isBlank(input.text) || ctx.phase !== 'idle') return 'ignored';
    const context = isBlank(input.context) ? undefined : input.context;

    // 2. An unmodified example that replays needs no tick and shows no alert.
    if (isUnmodifiedExample(input) && (isReadyRound(input.example) || live === 'outside' || examplesOnly || !adultConfirmed)) {
      replay(input.example);
      return 'replayed';
    }
    // 3. Outside: nothing is sent.
    if (live === 'outside') {
      say(NO_LIVE_WISH_MESSAGE);
      return 'outside';
    }
    // 4. The paw is resting (A9).
    if (examplesOnly) {
      say(RESTING_MESSAGE);
      return 'resting';
    }
    // 5. No tick: the UI shows the alert.
    if (!adultConfirmed) return 'adult-required';

    // 6. A live request.
    replayed = null;
    dispatch(
      context === undefined
        ? { type: 'grant_requested', text: input.text }
        : { type: 'grant_requested', text: input.text, context },
    );
    return 'sent';
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
    setAdultConfirmed(value) {
      if (ctx.phase !== 'idle' || adultConfirmed === value) return;
      adultConfirmed = value;
      emit();
    },
    start() {
      if (stored.kind === 'loading' && examplesController === null) void loadExamples();
      if (!liveProbed && liveController === null) void loadLive();
    },
    dispose() {
      abortInFlight();
      examplesController?.abort();
      examplesController = null;
      liveController?.abort();
      liveController = null;
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
  readonly api: ApiClient;
}

export function usePawSession(options: UsePawSessionOptions = {}): PawSession {
  const held = useRef<Held | null>(null);
  if (held.current === null) {
    const bridge = createSceneBridge();
    const sound = options.sound ?? createSoundController();
    const api = options.api ?? defaultApiClient();
    const runner = createPawSession({
      initial: initialState(options.initialReducedMotion ?? false),
      api,
      bridge,
      onCue: (cue) => sound.cue(cue),
      ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    });
    held.current = { runner, bridge, sound, api };
  }
  const { runner, bridge, sound, api } = held.current;

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
    () => ({
      ...snapshot,
      dispatch: runner.dispatch,
      submitWish: runner.submitWish,
      setAdultConfirmed: runner.setAdultConfirmed,
      bridge,
      sound,
      api,
    }),
    [snapshot, runner, bridge, sound, api],
  );
}
