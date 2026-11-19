// Live-region text for the paw state machine (design.md sections 5 and 7).
// Pure: no React, DOM or timers. `describe` compares two contexts and the event between them.
// Error lines are not produced here: the session takes them from `api-messages.ts`.
// The Integrity medal is its own `role="status"` region, so it is never repeated here.

import type { Curse } from 'paw-core';
import type { PawContext, PawEvent } from './paw-machine-types';
import { curseTypeLabel } from './paw-selectors';

/** "Curse i, <Type label>: <story>", numbered from 1 (Req 5.2). `index` is the zero-based position. */
function curseLine(curse: Curse, index: number): string {
  return `Curse ${index + 1}, ${curseTypeLabel(curse.type)}: ${curse.story}`;
}

/** The reason as a sentence of its own: trimmed, with a full stop unless it already ends in `.`, `!` or `?`. */
function sentence(reason: string): string {
  const text = reason.trim();
  if (text === '') return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Joins non-empty parts with single spaces. */
function join(...parts: readonly string[]): string {
  return parts.filter((part) => part !== '').join(' ');
}

function openCount(ctx: PawContext): number {
  const curses = ctx.grant?.curses ?? [];
  return curses.filter((curse) => !ctx.closedIds.includes(curse.id)).length;
}

function onGrantReceived(next: PawContext, event: Extract<PawEvent, { type: 'grant_received' }>): string | null {
  // A Grant the reducer rejected (wrong size) leaves `next.grant` as it was.
  if (next.grant === null || next.grant !== event.grant) return null;
  const curses = next.grant.curses;
  if (next.reducedMotion) {
    return join(`Granted. ${curses.length} curses.`, ...curses.map(curseLine));
  }
  return `Granted. ${curses.length} curses arrive.`;
}

function onCurlDone(prev: PawContext, next: PawContext): string | null {
  const digit = prev.anim.active?.digit;
  if (digit === undefined) return null;
  const curse = next.grant?.curses[digit];
  return curse === undefined ? null : curseLine(curse, digit);
}

function onVerdict(
  prev: PawContext,
  next: PawContext,
  event: Extract<PawEvent, { type: 'verdict_received' }>,
): string | null {
  if (!event.closed) {
    // Accepted only for the pending curse: the card stays open and "remembers".
    return join('Not closed. The paw remembers.', event.reason.trim());
  }
  const sealed = join('Closed. The seal holds.', sentence(event.reason));
  if (next.closedIds.length === prev.closedIds.length) {
    // Idempotent close of an already closed curse: the card closes, no finger moves.
    return sealed;
  }
  const popped = next.curled.length < prev.curled.length;
  const closing = popped ? join(sealed, 'Finger opens.') : sealed;
  // Under reduced motion there is no `rest_done`, so the ending is announced with the close.
  const ended = next.phase === 'ended' && next.endReason === 'all-closed';
  return next.reducedMotion && ended ? join(closing, 'The paw rests.') : closing;
}

function onStop(prev: PawContext): string {
  const open = openCount(prev);
  return open === 1 ? 'You stopped. 1 curse is still open.' : `You stopped. ${open} curses are still open.`;
}

/**
 * The text for the live region after `event` moved the machine from `prev` to `next`,
 * or null when nothing should be announced.
 */
export function describe(prev: PawContext, next: PawContext, event: PawEvent): string | null {
  if (next === prev) return null; // the reducer ignored the event
  switch (event.type) {
    case 'grant_received':
      return onGrantReceived(next, event);
    case 'curl_done':
      return onCurlDone(prev, next);
    case 'verdict_received':
      return onVerdict(prev, next, event);
    case 'rest_done':
      return 'The paw rests.';
    case 'stop':
      return onStop(prev);
    case 'rewrite':
      return 'The wish is unmade.';
    default:
      return null;
  }
}
