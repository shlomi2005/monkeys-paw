// Test support for the round-end components (StopButton, IntegrityMedal): real PawContext fixtures, driven through the
// real reducer. App code must never import this file.

import type { Grant } from 'paw-core';
import { initialState, reduce } from '../state/paw-machine';
import type { AnimCommand, PawContext, PawEvent } from '../state/paw-machine-types';

const TYPES = ['permissions', 'money', 'time', 'data-loss', 'edge-input'] as const;

/** A Grant with `k` open curses (3 to 5), ids c0..c(k-1). */
export function grantOf(k: number): Grant {
  return {
    wishId: 'w1',
    narration: 'The paw obeys. Exactly.',
    curses: Array.from({ length: k }, (_, i) => ({
      id: `c${i}`,
      type: TYPES[i] ?? 'time',
      story: `Story ${i}.`,
      loophole: `Loophole ${i}.`,
      status: 'open' as const,
    })),
  };
}

const DONE_TYPE = { curl: 'curl_done', open: 'open_done', rest: 'rest_done' } as const;

function doneEventFor(command: AnimCommand): PawEvent {
  return { type: DONE_TYPE[command.kind], id: command.id };
}

function grantReceivedEvent(grant: Grant): PawEvent {
  return { type: 'grant_received', wish: { id: grant.wishId, text: 'a test wish', createdAt: 0 }, grant };
}

function withClosed(grant: Grant, curseId: string): Grant {
  return { ...grant, curses: grant.curses.map((c) => (c.id === curseId ? { ...c, status: 'closed' as const } : c)) };
}

export function send(ctx: PawContext, ...events: PawEvent[]): PawContext {
  return events.reduce((current, event) => reduce(current, event).ctx, ctx);
}

/** Finishes every animation command, so the machine is quiescent. */
export function drain(ctx: PawContext): PawContext {
  let current = ctx;
  for (let i = 0; i < 50 && current.anim.active !== null; i += 1) {
    current = send(current, doneEventFor(current.anim.active));
  }
  return current;
}

/** A wish is being granted: no Grant yet. */
export function granting(): PawContext {
  return send(initialState(false), { type: 'grant_requested', text: 'a wish' });
}

/** A Grant of `k` curses has arrived and its curls are still running. */
export function curling(k: number): PawContext {
  return send(granting(), grantReceivedEvent(grantOf(k)));
}

/** A Grant of `k` curses, every curl finished, every curse open. */
export function ready(k: number, reducedMotion = false): PawContext {
  const start = send(initialState(reducedMotion), { type: 'grant_requested', text: 'a wish' });
  return drain(send(start, grantReceivedEvent(grantOf(k))));
}

/** Binds curse `index` with a closing verdict, as the session does. The finger-open animation is left running. */
export function closeCurse(ctx: PawContext, index: number): PawContext {
  const grant = ctx.grant;
  if (grant === null) throw new Error('no grant');
  const curse = grant.curses[index];
  if (curse === undefined) throw new Error(`no curse ${index}`);
  const closed = [...ctx.closedIds, curse.id].reduce<Grant>((g, id) => withClosed(g, id), grant);
  return send(
    ctx,
    { type: 'circle_activated', index },
    { type: 'bind_submitted', kind: 'ears-clause', clause: 'The system shall do the right thing.' },
    { type: 'verdict_received', curseId: curse.id, closed: true, reason: 'Closed.', grant: closed },
  );
}
