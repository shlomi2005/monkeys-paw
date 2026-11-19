// Test support for the paw state machine. App code must never import this file.
// Generators, the intent interpreter, `drain` and the reference model described in
// design.md, "Event-sequence generator".

import * as fc from 'fast-check';
import { BindingKindSchema, CurseTypeSchema } from 'paw-core';
import type { BindingKind, Curse, Grant, Wish } from 'paw-core';
import { initialState, reduce } from './paw-machine';
import type {
  AnimCommand,
  Digit,
  EndReason,
  PawContext,
  PawEffect,
  PawEvent,
  Phase,
  Transition,
} from './paw-machine-types';

export type ReduceFn = (ctx: PawContext, event: PawEvent) => Transition;

/** Run count for property tests: `FC_NUM_RUNS` (default 300 locally, 2000 in CI). */
export function numRuns(): number {
  // The web tsconfig has no Node types, so read the environment through globalThis.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const raw = env?.['FC_NUM_RUNS'];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
}

// ---------------------------------------------------------------------------
// Small pure helpers shared by the interpreter, the model and the tests
// ---------------------------------------------------------------------------

/** Digits `[0, 1, ..., n-1]`: what `curled` holds after a Grant with n curses arrives. */
export function digitsUpTo(n: number): Digit[] {
  return Array.from({ length: n }, (_, i) => i as Digit);
}

export function wishFor(grant: Grant): Wish {
  return { id: grant.wishId, text: 'a test wish', createdAt: 0 };
}

export function grantReceivedEvent(grant: Grant): PawEvent {
  return { type: 'grant_received', wish: wishFor(grant), grant };
}

/** The grant as the API client hands it over for a closed verdict: that curse has status `closed`. */
export function withClosed(grant: Grant, curseId: string): Grant {
  return {
    ...grant,
    curses: grant.curses.map((c) => (c.id === curseId ? { ...c, status: 'closed' as const } : c)),
  };
}

const DONE_TYPE = { curl: 'curl_done', open: 'open_done', rest: 'rest_done' } as const;

/** The `*_done` event that completes `command`. */
export function doneEventFor(command: AnimCommand): PawEvent {
  return { type: DONE_TYPE[command.kind], id: command.id };
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

const arbId = fc.stringMatching(/^c[a-z0-9]{2,6}$/);
const arbSentence = fc.stringMatching(/^[A-Z][a-z]{2,8}( [a-z]{2,8}){2,8}\.$/);

const arbCurse: fc.Arbitrary<Curse> = fc.record({
  id: arbId,
  type: fc.constantFrom(...CurseTypeSchema.options),
  story: arbSentence,
  loophole: arbSentence,
  status: fc.constantFrom('open' as const, 'closed' as const),
});

const arbWishId = fc.stringMatching(/^w[a-z0-9]{3,8}$/);

/** A valid Grant: 3-5 curses, unique non-empty ids, random `status`. */
export const arbGrant: fc.Arbitrary<Grant> = fc.record({
  wishId: arbWishId,
  narration: arbSentence,
  curses: fc.uniqueArray(arbCurse, { minLength: 3, maxLength: 5, selector: (c) => c.id }),
});

/** A Grant the machine must reject: 0-2 or 6-7 curses. */
export const arbBadGrant: fc.Arbitrary<Grant> = fc.record({
  wishId: arbWishId,
  narration: arbSentence,
  curses: fc.oneof(
    fc.uniqueArray(arbCurse, { minLength: 0, maxLength: 2, selector: (c) => c.id }),
    fc.uniqueArray(arbCurse, { minLength: 6, maxLength: 7, selector: (c) => c.id }),
  ),
});

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

export type VerdictTarget = 'pending' | 'known' | 'closed' | 'unknown';

export type Intent =
  | { readonly kind: 'request'; readonly text: string }
  | { readonly kind: 'receive'; readonly grant: Grant }
  | { readonly kind: 'receiveBad'; readonly grant: Grant }
  | { readonly kind: 'fail' }
  | { readonly kind: 'doneActive' }
  | { readonly kind: 'doneStale'; readonly type: 'curl_done' | 'open_done' | 'rest_done'; readonly id: number }
  | { readonly kind: 'activate'; readonly index: number }
  | { readonly kind: 'activateOpen'; readonly pick: number }
  | { readonly kind: 'closeCard' }
  | { readonly kind: 'submit'; readonly bindKind: BindingKind; readonly clause: string }
  | { readonly kind: 'verdict'; readonly target: VerdictTarget; readonly pick: number; readonly closed: boolean }
  | { readonly kind: 'bindFailed' }
  | { readonly kind: 'stop' }
  | { readonly kind: 'rewrite' }
  | { readonly kind: 'motion'; readonly reduced: boolean }
  | { readonly kind: 'late'; readonly pick: number };

const arbBlank = fc.constantFrom('', ' ', '  \t');
const arbWords = fc.stringMatching(/^[a-z][a-z ]{2,20}$/);

/** Weights follow design.md; `receiveBad` (weight 1) exercises the invalid-size Grant gap. */
export const arbIntent: fc.Arbitrary<Intent> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc
      .oneof(arbBlank, arbWords)
      .map((text): Intent => ({ kind: 'request', text })),
  },
  { weight: 3, arbitrary: arbGrant.map((grant): Intent => ({ kind: 'receive', grant })) },
  { weight: 1, arbitrary: arbBadGrant.map((grant): Intent => ({ kind: 'receiveBad', grant })) },
  { weight: 1, arbitrary: fc.constant<Intent>({ kind: 'fail' }) },
  { weight: 6, arbitrary: fc.constant<Intent>({ kind: 'doneActive' }) },
  {
    weight: 2,
    arbitrary: fc
      .record({
        type: fc.constantFrom('curl_done' as const, 'open_done' as const, 'rest_done' as const),
        id: fc.nat(12),
      })
      .map(({ type, id }): Intent => ({ kind: 'doneStale', type, id })),
  },
  {
    weight: 5,
    arbitrary: fc.integer({ min: -1, max: 6 }).map((index): Intent => ({ kind: 'activate', index })),
  },
  { weight: 4, arbitrary: fc.nat(9).map((pick): Intent => ({ kind: 'activateOpen', pick })) },
  { weight: 1, arbitrary: fc.constant<Intent>({ kind: 'closeCard' }) },
  {
    weight: 3,
    arbitrary: fc
      .record({
        bindKind: fc.constantFrom(...BindingKindSchema.options),
        clause: fc.oneof(
          { weight: 3, arbitrary: arbWords },
          { weight: 1, arbitrary: arbBlank },
        ),
      })
      .map(({ bindKind, clause }): Intent => ({ kind: 'submit', bindKind, clause })),
  },
  {
    weight: 5,
    arbitrary: fc
      .record({
        target: fc.constantFrom<VerdictTarget>('pending', 'known', 'closed', 'unknown'),
        pick: fc.nat(9),
        closed: fc.oneof(
          { weight: 3, arbitrary: fc.constant(true) },
          { weight: 2, arbitrary: fc.constant(false) },
        ),
      })
      .map(({ target, pick, closed }): Intent => ({ kind: 'verdict', target, pick, closed })),
  },
  { weight: 1, arbitrary: fc.constant<Intent>({ kind: 'bindFailed' }) },
  { weight: 1, arbitrary: fc.constant<Intent>({ kind: 'stop' }) },
  { weight: 1, arbitrary: fc.constant<Intent>({ kind: 'rewrite' }) },
  { weight: 1, arbitrary: fc.boolean().map((reduced): Intent => ({ kind: 'motion', reduced })) },
  { weight: 1, arbitrary: fc.nat(30).map((pick): Intent => ({ kind: 'late', pick })) },
);

export interface Session {
  readonly reducedMotion: boolean;
  readonly intents: readonly Intent[];
}

export const arbSession: fc.Arbitrary<Session> = fc.record({
  reducedMotion: fc.boolean(),
  intents: fc.array(arbIntent, { maxLength: 80 }),
});

/** Like `arbSession`, but opens with a wish and a Grant so most sessions reach the interesting phases. */
export const arbPrimedSession: fc.Arbitrary<Session> = fc
  .tuple(arbGrant, arbSession)
  .map(([grant, session]) => ({
    reducedMotion: session.reducedMotion,
    intents: [
      { kind: 'request', text: 'a wish' } as const,
      { kind: 'receive', grant } as const,
      ...session.intents,
    ],
  }));

export const arbAnySession: fc.Arbitrary<Session> = fc.oneof(
  { weight: 1, arbitrary: arbSession },
  { weight: 3, arbitrary: arbPrimedSession },
);

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------

export interface Step {
  readonly before: PawContext;
  readonly event: PawEvent;
  readonly after: PawContext;
  readonly effects: readonly PawEffect[];
}

function isLateCandidate(event: PawEvent): boolean {
  return (
    event.type === 'curl_done' ||
    event.type === 'open_done' ||
    event.type === 'rest_done' ||
    event.type === 'verdict_received'
  );
}

function pickFrom<T>(items: readonly T[], pick: number): T | undefined {
  return items.length === 0 ? undefined : items[pick % items.length];
}

/** Turns one intent into a concrete event using the current context, or null when it has no meaning yet. */
function toEvent(
  intent: Intent,
  ctx: PawContext,
  late: readonly PawEvent[],
  lastGrant: Grant | null,
): PawEvent | null {
  switch (intent.kind) {
    case 'request':
      return { type: 'grant_requested', text: intent.text };
    case 'receive':
    case 'receiveBad':
      return grantReceivedEvent(intent.grant);
    case 'fail':
      return { type: 'grant_failed' };
    case 'doneActive':
      return ctx.anim.active === null ? null : doneEventFor(ctx.anim.active);
    case 'doneStale': {
      const active = ctx.anim.active;
      const matches = active !== null && DONE_TYPE[active.kind] === intent.type && active.id === intent.id;
      return { type: intent.type, id: matches ? intent.id + 1000 : intent.id };
    }
    case 'activate':
      return { type: 'circle_activated', index: intent.index };
    case 'activateOpen': {
      const curses = ctx.grant?.curses ?? [];
      const open = curses.map((c, i) => ({ c, i })).filter(({ c }) => !ctx.closedIds.includes(c.id));
      const chosen = pickFrom(open, intent.pick);
      return chosen === undefined ? null : { type: 'circle_activated', index: chosen.i };
    }
    case 'closeCard':
      return { type: 'card_closed' };
    case 'submit':
      return { type: 'bind_submitted', kind: intent.bindKind, clause: intent.clause };
    case 'verdict': {
      const base = ctx.grant ?? lastGrant;
      if (base === null) return null;
      const known = pickFrom(base.curses, intent.pick)?.id ?? 'unknown-curse';
      let curseId: string;
      switch (intent.target) {
        case 'pending':
          curseId = ctx.pendingCurseId ?? known;
          break;
        case 'known':
          curseId = known;
          break;
        case 'closed':
          curseId = pickFrom(ctx.closedIds, intent.pick) ?? known;
          break;
        case 'unknown':
          curseId = 'unknown-curse';
          break;
      }
      return {
        type: 'verdict_received',
        curseId,
        closed: intent.closed,
        reason: 'a reason',
        grant: intent.closed ? withClosed(base, curseId) : base,
      };
    }
    case 'bindFailed':
      return { type: 'bind_failed' };
    case 'stop':
      return { type: 'stop' };
    case 'rewrite':
      return { type: 'rewrite' };
    case 'motion':
      return { type: 'motion_preference_changed', reduced: intent.reduced };
    case 'late':
      return pickFrom(late, intent.pick) ?? null;
  }
}

/** Runs intents from `start`, returning one step per intent that produced an event. */
export function runFrom(
  start: PawContext,
  intents: readonly Intent[],
  reduceFn: ReduceFn = reduce,
): Step[] {
  const steps: Step[] = [];
  const late: PawEvent[] = [];
  let lastGrant: Grant | null = start.grant;
  let ctx = start;
  for (const intent of intents) {
    const event = toEvent(intent, ctx, late, lastGrant);
    if (event === null) continue;
    const transition = reduceFn(ctx, event);
    steps.push({ before: ctx, event, after: transition.ctx, effects: transition.effects });
    if (event.type === 'grant_received') lastGrant = event.grant;
    if (isLateCandidate(event)) late.push(event);
    ctx = transition.ctx;
  }
  return steps;
}

/** The trace of steps `{ before, event, after, effects }` for a whole session. */
export function runSession(session: Session, reduceFn: ReduceFn = reduce): Step[] {
  return runFrom(initialState(session.reducedMotion), session.intents, reduceFn);
}

/** Context after the last step, or `fallback` when the trace is empty. */
export function lastContext(steps: readonly Step[], fallback: PawContext): PawContext {
  return steps.length === 0 ? fallback : steps[steps.length - 1].after;
}

/** Final context of a generated session: any state the machine can reach. */
export const arbReachable: fc.Arbitrary<PawContext> = arbAnySession.map((session) =>
  lastContext(runSession(session), initialState(session.reducedMotion)),
);

// ---------------------------------------------------------------------------
// drain
// ---------------------------------------------------------------------------

const DRAIN_LIMIT = 200;

/**
 * Completes the active command until the machine is quiescent, and answers a pending
 * `judging` with `bind_failed`. Throws when the machine does not settle.
 */
export function drain(
  ctx: PawContext,
  reduceFn: ReduceFn = reduce,
): { ctx: PawContext; steps: Step[] } {
  const steps: Step[] = [];
  let current = ctx;
  for (let i = 0; i < DRAIN_LIMIT; i += 1) {
    let event: PawEvent;
    if (current.anim.active !== null) {
      event = doneEventFor(current.anim.active);
    } else if (current.anim.queue.length > 0) {
      throw new Error('drain: queued commands but no active command');
    } else if (current.phase === 'judging') {
      event = { type: 'bind_failed' };
    } else {
      return { ctx: current, steps };
    }
    const transition = reduceFn(current, event);
    steps.push({ before: current, event, after: transition.ctx, effects: transition.effects });
    current = transition.ctx;
  }
  throw new Error('drain: the machine did not settle');
}

// ---------------------------------------------------------------------------
// Reference model: a plain stack and set, updated only from accepted events
// ---------------------------------------------------------------------------

/** Phases in which a verdict is handled at all (design.md, verdict rules). */
const VERDICT_PHASES: readonly Phase[] = ['ready', 'binding', 'judging'];

export interface RefModel {
  /** A grant request is in flight. */
  readonly awaiting: boolean;
  /** Curse ids of the active Grant, null when there is none. */
  readonly curseIds: readonly string[] | null;
  /** The curled-digit stack. */
  readonly stack: readonly Digit[];
  /** Curses whose close verdict was accepted. */
  readonly closed: ReadonlySet<string>;
  readonly ended: EndReason | null;
  /** True when the last step was an accepted close. */
  readonly closeAccepted: boolean;
  /** The digit that accepted close popped, null otherwise. */
  readonly popped: Digit | null;
}

export const EMPTY_MODEL: RefModel = {
  awaiting: false,
  curseIds: null,
  stack: [],
  closed: new Set<string>(),
  ended: null,
  closeAccepted: false,
  popped: null,
};

/**
 * Advances the model by one step. The model keeps its own stack, set and lifecycle.
 * It reads only the phase before the step, to know whether a verdict is in a phase that handles it.
 */
export function stepModel(model: RefModel, step: Pick<Step, 'before' | 'event'>): RefModel {
  const base: RefModel = { ...model, closeAccepted: false, popped: null };
  const event = step.event;
  switch (event.type) {
    case 'grant_requested':
      return model.awaiting || model.curseIds !== null || event.text.trim() === ''
        ? base
        : { ...base, awaiting: true };
    case 'grant_received': {
      if (!model.awaiting) return base;
      const count = event.grant.curses.length;
      if (count < 3 || count > 5) return { ...base, awaiting: false };
      return { ...EMPTY_MODEL, curseIds: event.grant.curses.map((c) => c.id), stack: digitsUpTo(count) };
    }
    case 'grant_failed':
      return { ...base, awaiting: false };
    case 'rewrite':
      return EMPTY_MODEL;
    case 'stop':
      return model.curseIds === null || model.ended !== null ? base : { ...base, ended: 'stopped' };
    case 'verdict_received': {
      const accepted =
        event.closed &&
        model.curseIds !== null &&
        model.ended === null &&
        VERDICT_PHASES.includes(step.before.phase) &&
        model.curseIds.includes(event.curseId) &&
        !model.closed.has(event.curseId) &&
        model.stack.length > 0;
      if (!accepted) return base;
      const stack = model.stack.slice(0, -1);
      return {
        ...base,
        stack,
        closed: new Set(model.closed).add(event.curseId),
        ended: stack.length === 0 ? 'all-closed' : null,
        closeAccepted: true,
        popped: model.stack[model.stack.length - 1],
      };
    }
    default:
      return base;
  }
}

/** The model after each step of a trace that starts from `initialState`. */
export function runModel(steps: readonly Step[]): RefModel[] {
  const models: RefModel[] = [];
  let model = EMPTY_MODEL;
  for (const step of steps) {
    model = stepModel(model, step);
    models.push(model);
  }
  return models;
}
