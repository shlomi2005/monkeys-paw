// The paw state machine (design.md section 5). Pure: no React, three, DOM, timers, randomness or Date.
// `reduce` never mutates its input. Only types are imported from paw-core.
// Comments cite the requirement numbers (Req N.M) from paw-web requirements.md.

import type { Grant } from 'paw-core';
import type {
  AnimCommand,
  Digit,
  PawContext,
  PawEffect,
  PawEvent,
  Transition,
} from './paw-machine-types';

type SnapEffect = Extract<PawEffect, { type: 'snap' }>;
type DoneEvent = Extract<PawEvent, { type: 'curl_done' | 'open_done' | 'rest_done' }>;
type Anim = PawContext['anim'];
/** A command before it gets an id. */
type CommandSpec = Omit<AnimCommand, 'id'>;

const MIN_CURSES = 3;
const MAX_CURSES = 5;

export function initialState(reducedMotion: boolean): PawContext {
  return {
    phase: 'idle',
    endReason: null,
    wish: null,
    grant: null,
    closedIds: [],
    curled: [],
    anim: { active: null, queue: [], nextId: 0 },
    pendingCurseId: null,
    lastVerdict: null,
    reducedMotion,
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** The context is returned unchanged and nothing is emitted. */
function ignore(ctx: PawContext): Transition {
  return { ctx, effects: [] };
}

function isQuiescent(anim: Anim): boolean {
  return anim.active === null && anim.queue.length === 0;
}

function clearedAnim(anim: Anim): Anim {
  return { active: null, queue: [], nextId: anim.nextId };
}

/** Snap amounts of a logical pose: 1 for each curled digit, 0 for the rest (Req 6.10). */
export function amountsFor(curled: readonly Digit[]): SnapEffect['amounts'] {
  const amount = (d: Digit): number => (curled.includes(d) ? 1 : 0);
  return [amount(0), amount(1), amount(2), amount(3), amount(4)];
}

function snap(curled: readonly Digit[], pose: SnapEffect['pose']): SnapEffect {
  return { type: 'snap', amounts: amountsFor(curled), pose };
}

function digitsUpTo(n: number): Digit[] {
  return Array.from({ length: n }, (_, i) => i as Digit);
}

// ---------------------------------------------------------------------------
// Animation queue: at most one active command (Req 5.4)
// ---------------------------------------------------------------------------

/**
 * Gives each command the next id. When nothing is active, the head becomes active and a `play`
 * effect is emitted for it; the rest wait in the queue.
 */
function enqueue(anim: Anim, specs: readonly CommandSpec[]): { anim: Anim; effects: PawEffect[] } {
  const commands = specs.map((spec, i): AnimCommand => ({ id: anim.nextId + i, ...spec }));
  const nextId = anim.nextId + commands.length;
  const waiting = [...anim.queue, ...commands];
  if (anim.active !== null || waiting.length === 0) {
    return { anim: { active: anim.active, queue: waiting, nextId }, effects: [] };
  }
  const [head, ...queue] = waiting;
  return { anim: { active: head, queue, nextId }, effects: [{ type: 'play', command: head }] };
}

const DONE_KIND = { curl_done: 'curl', open_done: 'open', rest_done: 'rest' } as const;

/** Advances the queue when the event matches the active command by id and kind; null otherwise. */
function complete(anim: Anim, event: DoneEvent): { anim: Anim; effects: PawEffect[] } | null {
  const { active } = anim;
  if (active === null || active.id !== event.id || active.kind !== DONE_KIND[event.type]) return null;
  const [head, ...queue] = anim.queue;
  if (head === undefined) return { anim: { ...anim, active: null, queue: [] }, effects: [] };
  return { anim: { ...anim, active: head, queue }, effects: [{ type: 'play', command: head }] };
}

/** `*_done`: a mismatch is ignored. Curling becomes ready once the queue is empty (Req 5.2). */
function onDone(ctx: PawContext, event: DoneEvent): Transition {
  const done = complete(ctx.anim, event);
  if (done === null) return ignore(ctx);
  const phase = ctx.phase === 'curling' && isQuiescent(done.anim) ? 'ready' : ctx.phase;
  return { ctx: { ...ctx, phase, anim: done.anim }, effects: done.effects };
}

// ---------------------------------------------------------------------------
// Granting (Req 5.1, 5.2, 2.9)
// ---------------------------------------------------------------------------

function onGrantRequested(ctx: PawContext, event: Extract<PawEvent, { type: 'grant_requested' }>): Transition {
  if (event.text.trim() === '') return ignore(ctx);
  const request: PawEffect =
    event.context === undefined
      ? { type: 'request-grant', text: event.text }
      : { type: 'request-grant', text: event.text, context: event.context };
  return { ctx: { ...ctx, phase: 'granting' }, effects: [request] };
}

/** Curls digits 0..k-1 in order, or lands them with one snap under reduced motion. */
function onGrantReceived(ctx: PawContext, event: Extract<PawEvent, { type: 'grant_received' }>): Transition {
  const k = event.grant.curses.length;
  // A Grant without 3-5 curses is handled like grant_failed.
  if (k < MIN_CURSES || k > MAX_CURSES) return { ctx: { ...ctx, phase: 'idle' }, effects: [] };

  const curled = digitsUpTo(k);
  const landed: PawContext = { ...ctx, wish: event.wish, grant: event.grant, closedIds: [], curled };
  if (ctx.reducedMotion) {
    return { ctx: { ...landed, phase: 'ready' }, effects: [snap(curled, 'upright')] };
  }
  const queued = enqueue(ctx.anim, curled.map((digit): CommandSpec => ({ kind: 'curl', digit })));
  return { ctx: { ...landed, phase: 'curling', anim: queued.anim }, effects: queued.effects };
}

// ---------------------------------------------------------------------------
// Binding card (Req 4.1-4.3, 4.6)
// ---------------------------------------------------------------------------

function onCircleActivated(ctx: PawContext, index: number): Transition {
  const curse = Number.isInteger(index) ? ctx.grant?.curses[index] : undefined;
  if (curse === undefined || ctx.closedIds.includes(curse.id)) return ignore(ctx);
  return { ctx: { ...ctx, phase: 'binding', pendingCurseId: curse.id, lastVerdict: null }, effects: [] };
}

function onBindSubmitted(ctx: PawContext, event: Extract<PawEvent, { type: 'bind_submitted' }>): Transition {
  if (event.clause.trim() === '' || ctx.pendingCurseId === null || ctx.grant === null) return ignore(ctx);
  const request: PawEffect = {
    type: 'request-bind',
    curseId: ctx.pendingCurseId,
    kind: event.kind,
    clause: event.clause,
    grant: ctx.grant,
  };
  return { ctx: { ...ctx, phase: 'judging' }, effects: [request] };
}

function closeCard(ctx: PawContext): Transition {
  return { ctx: { ...ctx, phase: 'ready', pendingCurseId: null }, effects: [] };
}

// ---------------------------------------------------------------------------
// Verdicts (Req 5.3, 5.5, 5.7, 5.8, 6.1, 6.9)
// ---------------------------------------------------------------------------

/** Only in ready, binding and judging, and only for a curse of the Grant. Everything else is ignored. */
function onVerdict(ctx: PawContext, event: Extract<PawEvent, { type: 'verdict_received' }>): Transition {
  const { grant } = ctx;
  if (grant === null || !grant.curses.some((c) => c.id === event.curseId)) return ignore(ctx);
  const pending = ctx.phase === 'judging' && event.curseId === ctx.pendingCurseId;

  // Rule 1: not closed. Nothing changes; the open card shows "The paw remembers."
  if (!event.closed) {
    return pending ? { ctx: { ...ctx, phase: 'binding', lastVerdict: 'not-closed' }, effects: [] } : ignore(ctx);
  }
  // Rule 2: idempotent close. No pop and no animation.
  if (ctx.closedIds.includes(event.curseId)) return pending ? closeCard(ctx) : ignore(ctx);

  return closeCurse(ctx, event.curseId, event.grant, pending);
}

/** Rules 3 and 4: the curse is open. The top digit pops, whichever circle was bound (LIFO). */
function closeCurse(ctx: PawContext, curseId: string, grant: Grant, pending: boolean): Transition {
  const popped = ctx.curled[ctx.curled.length - 1]; // undefined only if the invariant broke (rule 4)
  const curled = ctx.curled.slice(0, -1);
  const ends = curled.length === 0;
  const closed: PawContext = { ...ctx, grant, closedIds: [...ctx.closedIds, curseId], curled };

  // Rule 3.4: the card closes and the phase is ready. A closing verdict that ends the round clears the card too.
  const next: PawContext = ends
    ? { ...closed, phase: 'ended', endReason: 'all-closed', pendingCurseId: null }
    : pending
      ? { ...closed, phase: 'ready', pendingCurseId: null }
      : closed;

  if (ctx.reducedMotion) {
    // One snap replaces the open (and the rest): zeros and 'rested' at the end.
    return { ctx: next, effects: [snap(curled, ends ? 'rested' : 'upright')] };
  }
  const specs: CommandSpec[] = [];
  if (popped !== undefined) specs.push({ kind: 'open', digit: popped });
  if (ends) specs.push({ kind: 'rest' }); // Rule 3.3: rest after the open
  const queued = enqueue(ctx.anim, specs);
  return { ctx: { ...next, anim: queued.anim }, effects: queued.effects };
}

// ---------------------------------------------------------------------------
// Stop, rewrite and reduced motion (Req 6.7, 6.10, 4.4, 2.9)
// ---------------------------------------------------------------------------

/** Ends the round as stopped. One snap of the logical pose finishes every animation at once. */
function onStop(ctx: PawContext): Transition {
  const effects: PawEffect[] = [];
  if (ctx.phase === 'judging') effects.push({ type: 'abort-requests' }); // a late bind response is discarded
  effects.push(snap(ctx.curled, 'upright'));
  const stopped: PawContext = {
    ...ctx,
    phase: 'ended',
    endReason: 'stopped',
    pendingCurseId: null,
    anim: clearedAnim(ctx.anim),
  };
  return { ctx: stopped, effects };
}

/** Back to the initial state. The scene is told to show the open paw; in-flight requests are aborted. */
function onRewrite(ctx: PawContext): Transition {
  if (ctx.phase === 'idle') return ignore(ctx);
  const reset = initialState(ctx.reducedMotion);
  const abort: PawEffect[] = ctx.phase === 'granting' || ctx.phase === 'judging' ? [{ type: 'abort-requests' }] : [];
  const rest: PawEffect[] = ctx.phase === 'granting' ? [] : [snap([], 'upright')];
  return { ctx: reset, effects: [...abort, ...rest] };
}

/** Turning it on clears the queue and snaps to the logical pose. Turning it off only sets the flag. */
function onMotionPreference(ctx: PawContext, reduced: boolean): Transition {
  if (reduced === ctx.reducedMotion) return ignore(ctx);
  if (!reduced) return { ctx: { ...ctx, reducedMotion: false }, effects: [] };

  const pose = ctx.phase === 'ended' && ctx.endReason === 'all-closed' ? 'rested' : 'upright';
  const next: PawContext = {
    ...ctx,
    reducedMotion: true,
    phase: ctx.phase === 'curling' ? 'ready' : ctx.phase,
    anim: clearedAnim(ctx.anim),
  };
  return { ctx: next, effects: [snap(ctx.curled, pose)] };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** Events accepted in several phases, or null when the event is not one of them. */
function onCommon(ctx: PawContext, event: PawEvent): Transition | null {
  switch (event.type) {
    case 'curl_done':
    case 'open_done':
    case 'rest_done':
      return onDone(ctx, event);
    case 'rewrite':
      return onRewrite(ctx);
    default:
      return null;
  }
}

/** Phase-specific events, in the order of the transition table. */
function onPhase(ctx: PawContext, event: PawEvent): Transition | null {
  switch (ctx.phase) {
    case 'idle':
      return event.type === 'grant_requested' ? onGrantRequested(ctx, event) : null;
    case 'granting':
      if (event.type === 'grant_received') return onGrantReceived(ctx, event);
      return event.type === 'grant_failed' ? { ctx: { ...ctx, phase: 'idle' }, effects: [] } : null;
    case 'curling':
      return event.type === 'stop' ? onStop(ctx) : null; // circles are "arriving": circle_activated is ignored
    case 'ready':
      if (event.type === 'circle_activated') return onCircleActivated(ctx, event.index);
      if (event.type === 'verdict_received') return onVerdict(ctx, event);
      return event.type === 'stop' ? onStop(ctx) : null;
    case 'binding':
      if (event.type === 'bind_submitted') return onBindSubmitted(ctx, event);
      if (event.type === 'card_closed') return closeCard(ctx);
      if (event.type === 'verdict_received') return onVerdict(ctx, event);
      return event.type === 'stop' ? onStop(ctx) : null;
    case 'judging':
      if (event.type === 'bind_failed') return { ctx: { ...ctx, phase: 'binding' }, effects: [] };
      if (event.type === 'verdict_received') return onVerdict(ctx, event);
      return event.type === 'stop' ? onStop(ctx) : null;
    case 'ended':
      return null; // the lock after the end (Req 6.9): only done events and rewrite get through
  }
}

/** Pure transition function. Any event not handled in the current phase is ignored. */
export function reduce(ctx: PawContext, event: PawEvent): Transition {
  if (event.type === 'motion_preference_changed') return onMotionPreference(ctx, event.reduced);
  const result = onPhase(ctx, event) ?? onCommon(ctx, event);
  return result ?? ignore(ctx);
}
