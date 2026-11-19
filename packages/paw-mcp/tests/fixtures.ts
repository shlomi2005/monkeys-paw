import type { Grant } from 'paw-core';

/** A schema-valid grant with `count` open curses `curse-0`... */
export function makeGrant(wishId: string, count = 4): Grant {
  const types = ['permissions', 'time', 'money', 'scale', 'abuse'] as const;
  return {
    wishId,
    narration: 'Granted. Exactly.',
    curses: Array.from({ length: count }, (_, i) => ({
      id: `curse-${i}`,
      type: types[i % types.length] as (typeof types)[number],
      story: `Story ${i} for ${wishId}.`,
      loophole: `Loophole ${i}.`,
      status: 'open' as const,
    })),
  };
}
