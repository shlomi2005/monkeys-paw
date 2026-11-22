import type { Curse, Grant } from 'paw-core';
import type { Verdict } from 'paw-core';
import {
  MAX_CLAUSE_CHARS,
  MAX_ID_CHARS,
  MAX_LOOPHOLE_CHARS,
  MAX_PROPERTY_CHARS,
  MAX_REASON_CHARS,
  MAX_USER_STORY_CHARS,
  MAX_WISH_CRITERION_CHARS,
} from './schemas';

/** `text` unchanged when it fits; else cut at `max` UTF-16 units, one less where that would split a surrogate pair. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/** A verdict that fits the request caps. An over-long `property` is omitted. */
export function fitVerdict(v: Verdict): Verdict {
  const { property, ...rest } = v;
  return {
    ...rest,
    curseId: cut(v.curseId, MAX_ID_CHARS),
    reason: cut(v.reason, MAX_REASON_CHARS),
    ...(property !== undefined && property.length <= MAX_PROPERTY_CHARS ? { property } : {}),
  };
}

function fitCurse(c: Curse): Curse {
  return {
    ...c,
    id: cut(c.id, MAX_ID_CHARS),
    loophole: cut(c.loophole, MAX_LOOPHOLE_CHARS),
    ...(c.binding
      ? {
          binding: {
            ...c.binding,
            curseId: cut(c.binding.curseId, MAX_ID_CHARS),
            clause: cut(c.binding.clause, MAX_CLAUSE_CHARS),
          },
        }
      : {}),
    ...(c.verdict ? { verdict: fitVerdict(c.verdict) } : {}),
  };
}

/** A grant that fits the request caps, so what the server serves can be sent back to export and bind. */
export function fitGrant(g: Grant): Grant {
  const { userStory, wishCriterion, ...rest } = g;
  return {
    ...rest,
    wishId: cut(g.wishId, MAX_ID_CHARS),
    curses: g.curses.map(fitCurse),
    ...(userStory !== undefined && userStory.length <= MAX_USER_STORY_CHARS ? { userStory } : {}),
    ...(wishCriterion !== undefined && wishCriterion.length <= MAX_WISH_CRITERION_CHARS ? { wishCriterion } : {}),
  };
}
