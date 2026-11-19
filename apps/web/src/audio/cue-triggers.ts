// Which sound cue goes with which transition (design.md "Sound (Req 7)"). Pure: no audio, no DOM.
// The session calls this on the same transitions that drive the scene, so sound and picture never disagree.

import type { PawContext, PawEffect, PawEvent } from '../state/paw-machine-types';
import type { SoundCue } from './sound-types';

function openCurseCount(ctx: PawContext): number {
  return ctx.grant === null ? 0 : ctx.grant.curses.filter((curse) => !ctx.closedIds.includes(curse.id)).length;
}

/**
 * The cues of one accepted transition, in the order to play them.
 *
 * - A `play` curl is a finger curling: creak. Under reduced motion there is no `play`, so one creak per `snap` that
 *   adds curls.
 * - A `play` open is a finger opening: sigh.
 * - "Granted." appearing (`grantedNow`) is the stamp. It comes last, so when it lands together with the first curl it
 *   is the cue that stays (a new cue fades the previous one out).
 * - Stop with at least one curse still open: the seals crack, once (Req 6.7).
 */
export function cuesFor(
  prev: PawContext,
  next: PawContext,
  event: PawEvent,
  effects: readonly PawEffect[],
  grantedNow: boolean,
): SoundCue[] {
  const cues: SoundCue[] = [];
  for (const effect of effects) {
    if (effect.type === 'play') {
      if (effect.command.kind === 'curl') cues.push('creak');
      else if (effect.command.kind === 'open') cues.push('sigh');
    } else if (effect.type === 'snap' && next.curled.length > prev.curled.length) {
      cues.push('creak');
    }
  }
  if (event.type === 'stop' && prev.phase !== 'ended' && next.endReason === 'stopped' && openCurseCount(next) > 0) {
    cues.push('crack');
  }
  if (grantedNow) cues.push('stamp');
  return cues;
}
