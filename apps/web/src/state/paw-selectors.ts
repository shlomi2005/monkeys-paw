// Derived view of the paw state machine (design.md sections 2, 5, 6 and 7).
// Pure functions of `PawContext`: nothing here is stored.

import { computeIntegrity } from 'paw-core';
import type { Curse, CurseType, Grant } from 'paw-core';
import type { Digit, PawContext } from './paw-machine-types';

export type CircleIndex = Digit;

export interface CircleView {
  readonly index: CircleIndex;
  readonly status: 'empty' | 'arriving' | 'open' | 'closed' | 'open-final';
  /** Empty string for an empty circle: the component hides it. */
  readonly ariaLabel: string;
}

export interface Medal {
  readonly score: number;
  readonly closed: number;
  readonly open: number;
  readonly text: string;
}

export interface CardView {
  readonly curse: Curse;
  /** The last verdict for this curse was "not closed": the card shows "The paw remembers." */
  readonly remembers: boolean;
  readonly judging: boolean;
}

export interface PawView {
  readonly circles: readonly [CircleView, CircleView, CircleView, CircleView, CircleView];
  readonly fingerText: string;
  readonly medal: Medal | null;
  readonly showStop: boolean;
  readonly showExport: boolean;
  readonly card: CardView | null;
}

const TYPE_LABELS: Readonly<Record<CurseType, string>> = {
  permissions: 'Permissions',
  time: 'Time',
  money: 'Money',
  scale: 'Scale',
  abuse: 'Abuse',
  privacy: 'Privacy',
  accessibility: 'Accessibility',
  'data-loss': 'Data loss',
  concurrency: 'Concurrency',
  'edge-input': 'Edge input',
};

/** Display name of a curse type tag. */
export function curseTypeLabel(type: CurseType): string {
  return TYPE_LABELS[type];
}

/** True when no animation command is active or queued. */
export function isQuiescent(ctx: PawContext): boolean {
  return ctx.anim.active === null && ctx.anim.queue.length === 0;
}

/** The Grant with each curse's `status` set from `closedIds`. `binding` and `verdict` are untouched. */
export function projectGrant(ctx: PawContext): Grant | null {
  const grant = ctx.grant;
  if (grant === null) return null;
  return {
    ...grant,
    curses: grant.curses.map((curse) => ({
      ...curse,
      status: ctx.closedIds.includes(curse.id) ? ('closed' as const) : ('open' as const),
    })),
  };
}

function circleFor(ctx: PawContext, index: CircleIndex): CircleView {
  const curse = ctx.grant?.curses[index];
  if (curse === undefined) return { index, status: 'empty', ariaLabel: '' };
  const label = curseTypeLabel(curse.type);

  if (ctx.phase === 'curling') {
    const waiting = ctx.anim.queue.some((c) => c.kind === 'curl' && c.digit === index);
    return waiting
      ? { index, status: 'empty', ariaLabel: '' }
      : { index, status: 'arriving', ariaLabel: `${label} curse, arriving` };
  }
  if (ctx.closedIds.includes(curse.id)) {
    return { index, status: 'closed', ariaLabel: `${label} curse, closed, sealed` };
  }
  if (ctx.phase === 'ended') {
    return { index, status: 'open-final', ariaLabel: `${label} curse, open, the paw remembers` };
  }
  return { index, status: 'open', ariaLabel: `${label} curse, open, click to bind` };
}

/** One view per finger, always five. */
export function circleViews(ctx: PawContext): PawView['circles'] {
  return [
    circleFor(ctx, 0),
    circleFor(ctx, 1),
    circleFor(ctx, 2),
    circleFor(ctx, 3),
    circleFor(ctx, 4),
  ];
}

/** The paw's text equivalent (Req 2.9, 2.10, 8.2). */
export function fingerText(ctx: PawContext): string {
  if (ctx.grant === null) return 'The paw rests, all fingers open.';
  if (ctx.phase === 'ended' && ctx.endReason === 'all-closed') return 'The paw rests.';
  const n = ctx.curled.length;
  if (ctx.phase === 'ended') {
    return n === 1 ? '1 finger stays curled.' : `${n} fingers stay curled.`;
  }
  return n === 1 ? '1 finger curled.' : `${n} fingers curled.`;
}

/** The Wish Integrity medal, computed whenever a Grant exists. Visibility is decided by `selectView`. */
export function medalFor(ctx: PawContext): Medal | null {
  const grant = projectGrant(ctx);
  if (grant === null) return null;
  const { score, closed, open } = computeIntegrity(grant);
  return { score, closed, open, text: `Integrity ${score}/5: ${closed} closed, ${open} open` };
}

/** A Grant is active, the round is running and at least one curse is open (Req 6.6). */
export function showStop(ctx: PawContext): boolean {
  if (ctx.grant === null) return false;
  if (
    ctx.phase !== 'curling' &&
    ctx.phase !== 'ready' &&
    ctx.phase !== 'binding' &&
    ctx.phase !== 'judging'
  ) {
    return false;
  }
  return ctx.grant.curses.some((curse) => !ctx.closedIds.includes(curse.id));
}

function cardFor(ctx: PawContext): CardView | null {
  if (ctx.phase !== 'binding' && ctx.phase !== 'judging') return null;
  const curse = ctx.grant?.curses.find((c) => c.id === ctx.pendingCurseId);
  if (curse === undefined) return null;
  return {
    curse,
    remembers: ctx.lastVerdict === 'not-closed',
    judging: ctx.phase === 'judging',
  };
}

export function selectView(ctx: PawContext): PawView {
  const medal = ctx.phase === 'ended' && isQuiescent(ctx) ? medalFor(ctx) : null;
  return {
    circles: circleViews(ctx),
    fingerText: fingerText(ctx),
    medal,
    showStop: showStop(ctx),
    showExport: medal !== null,
    card: cardFor(ctx),
  };
}
