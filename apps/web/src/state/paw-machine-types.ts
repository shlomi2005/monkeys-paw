// Types of the paw state machine (design.md section 5). Pure types: no React, three or DOM.

import type { BindingKind, Grant, Wish } from 'paw-core';

/** 0 thumb, 1 index, 2 middle, 3 ring, 4 little. */
export type Digit = 0 | 1 | 2 | 3 | 4;

export type Phase = 'idle' | 'granting' | 'curling' | 'ready' | 'binding' | 'judging' | 'ended';

export type EndReason = 'all-closed' | 'stopped';

export interface AnimCommand {
  readonly id: number;
  readonly kind: 'curl' | 'open' | 'rest';
  readonly digit?: Digit;
}

export interface PawContext {
  readonly phase: Phase;
  /** Non-null only when `phase === 'ended'`. */
  readonly endReason: EndReason | null;
  /** In memory only (Req 11). */
  readonly wish: Wish | null;
  readonly grant: Grant | null;
  /** Closed curse ids. The circles read this, not the stack. */
  readonly closedIds: readonly string[];
  /** LIFO stack, bottom = first curled. */
  readonly curled: readonly Digit[];
  readonly anim: {
    readonly active: AnimCommand | null;
    readonly queue: readonly AnimCommand[];
    readonly nextId: number;
  };
  /** Card open or request in flight. */
  readonly pendingCurseId: string | null;
  /** Drives "The paw remembers." in the open card. */
  readonly lastVerdict: 'not-closed' | null;
  /** Preference, survives rewrite. */
  readonly reducedMotion: boolean;
}

export type PawEvent =
  | { type: 'grant_requested'; text: string; context?: string }
  | { type: 'grant_received'; wish: Wish; grant: Grant }
  | { type: 'grant_failed' }
  | { type: 'curl_done'; id: number }
  | { type: 'open_done'; id: number }
  | { type: 'rest_done'; id: number }
  | { type: 'circle_activated'; index: number }
  /** Cancel or Escape (Req 4.2, 4.6). */
  | { type: 'card_closed' }
  | { type: 'bind_submitted'; kind: BindingKind; clause: string }
  | { type: 'verdict_received'; curseId: string; closed: boolean; reason: string; grant: Grant }
  | { type: 'bind_failed' }
  | { type: 'stop' }
  | { type: 'rewrite' }
  | { type: 'motion_preference_changed'; reduced: boolean };

export type PawEffect =
  | { type: 'request-grant'; text: string; context?: string }
  | { type: 'request-bind'; curseId: string; kind: BindingKind; clause: string; grant: Grant }
  | { type: 'abort-requests' }
  | { type: 'play'; command: AnimCommand }
  | {
      type: 'snap';
      amounts: readonly [number, number, number, number, number];
      pose: 'upright' | 'rested';
    };

export interface Transition {
  readonly ctx: PawContext;
  readonly effects: readonly PawEffect[];
}
