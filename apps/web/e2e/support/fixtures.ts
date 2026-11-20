// Fixtures for the stubbed API (paw-web task 42). Every fixture is built from `paw-core` types and parsed with the
// `paw-core` zod schemas when it is built. A fixture that does not parse throws at once, so a broken fixture fails
// the test loudly instead of silently feeding the app something the real API would never send.

import {
  BindResponseSchema,
  ExamplesResponseSchema,
  GrantResponseSchema,
  SpecExportSchema,
  exportSpec,
} from 'paw-core';
import type { BindingKind, BindResponse, ExamplesResponse, Grant, GrantResponse, SpecExport, Verdict, Wish } from 'paw-core';

export type CurseCount = 3 | 5;

/** The body of an error answer (the real API sends `{ message }`, see `apps/api/src/app.ts`). */
export interface ErrorBody {
  readonly message: string;
}

export const WISH_TEXT = 'Only the owner can delete a project';
export const WISH_CONTEXT = 'a team workspace app';

/** Fixed clock for fixtures, so the same input always gives the same bytes. */
const FIXED_TIME = 1_700_000_000_000;

const CURSE_SEEDS = [
  {
    type: 'permissions',
    story: 'The owner quits the company. Granted: nobody may delete the project, ever.',
    loophole: 'Only the owner can delete a project',
  },
  {
    type: 'time',
    story: 'The owner deletes the project at 11:59 on a Friday. The backup job runs at midnight and finds nothing.',
    loophole: 'can delete a project',
  },
  {
    type: 'abuse',
    story: 'A new hire is named the owner of every project. Granted. The first thing they do is tidy up.',
    loophole: 'Only the owner',
  },
  {
    type: 'privacy',
    story: 'The deleted project is gone from the screen. Its files stay on the server, readable by anyone with the link.',
    loophole: 'delete a project',
  },
  {
    type: 'edge-input',
    story: 'A project is called nothing at all. Nobody can find it, so nobody can delete it.',
    loophole: 'a project',
  },
] as const;

export const WISH: Wish = {
  id: 'wish-e2e-1',
  text: WISH_TEXT,
  context: WISH_CONTEXT,
  createdAt: FIXED_TIME,
};

/** Throws with the zod issues when `schema` rejects `value`. */
function checked<T>(
  schema: { parse(value: unknown): T },
  value: unknown,
  what: string,
): T {
  try {
    return schema.parse(value);
  } catch (error) {
    throw new Error(`The e2e fixture "${what}" does not match its paw-core schema: ${String(error)}`, { cause: error });
  }
}

/** A fresh Grant of 3 or 5 curses, all open. Curse ids are `curse-1` to `curse-5`, in circle order. */
export function grantFixture(count: CurseCount, wishId: string = WISH.id): Grant {
  return {
    wishId,
    narration: 'Granted. The owner alone may delete a project. The rest may only watch.',
    curses: CURSE_SEEDS.slice(0, count).map((seed, index) => ({
      id: `curse-${index + 1}`,
      type: seed.type,
      story: seed.story,
      loophole: seed.loophole,
      status: 'open' as const,
    })),
    userStory: 'As a team member, I want only the owner to delete a project, so that nothing disappears by accident.',
    wishCriterion: 'THE SYSTEM SHALL allow only the owner of a project to delete the project.',
  };
}

/** The body of `POST /api/grant`, parsed with `GrantResponseSchema`. */
export function grantResponseFixture(count: CurseCount): GrantResponse {
  return checked(GrantResponseSchema, { wish: WISH, grant: grantFixture(count) }, `grant response (${count} curses)`);
}

/** The body of `GET /api/examples`: three cached examples (3, 5 and 3 curses), parsed with `ExamplesResponseSchema`. */
export function examplesFixture(): ExamplesResponse {
  const entries = [
    { wish: { ...WISH, id: 'example-1' }, grant: grantFixture(3, 'example-1') },
    {
      wish: { id: 'example-2', text: 'Refunds are instant', context: 'an online shop', createdAt: FIXED_TIME },
      grant: grantFixture(5, 'example-2'),
    },
    {
      wish: { id: 'example-3', text: 'Free for students', createdAt: FIXED_TIME },
      grant: grantFixture(3, 'example-3'),
    },
  ];
  return checked(ExamplesResponseSchema, entries, 'examples');
}

export function closedVerdict(curseId: string): Verdict {
  return {
    curseId,
    closed: true,
    reason: 'The clause names who may act when the owner is gone.',
    judgedAt: FIXED_TIME,
    property: `For any project whose owner has left, the loophole of ${curseId} stays shut.`,
  };
}

export function notClosedVerdict(curseId: string): Verdict {
  return {
    curseId,
    closed: false,
    reason: 'The clause still lets the loophole through.',
    judgedAt: FIXED_TIME,
  };
}

/**
 * The body of `POST /api/bind`: `grant` with the bound curse marked `closed` (with its binding and verdict) when
 * `closed` is true, and unchanged when it is false. Parsed with `BindResponseSchema`.
 */
export function bindResponseFixture(
  grant: Grant,
  curseId: string,
  kind: BindingKind,
  clause: string,
  closed: boolean,
): BindResponse {
  const verdict = closed ? closedVerdict(curseId) : notClosedVerdict(curseId);
  const nextGrant: Grant = closed
    ? {
        ...grant,
        curses: grant.curses.map((curse) =>
          curse.id === curseId
            ? {
                ...curse,
                status: 'closed' as const,
                binding: { curseId, kind, clause, proposedAt: FIXED_TIME },
                verdict,
              }
            : curse,
        ),
      }
    : grant;
  return checked(BindResponseSchema, { grant: nextGrant, verdict }, `bind response (closed: ${closed})`);
}

/** The body of `POST /api/export`: what the real `exportSpec` makes of the request, parsed with `SpecExportSchema`. */
export function exportFixture(wish: Wish, grant: Grant): SpecExport {
  return checked(SpecExportSchema, exportSpec(wish, grant), 'export');
}

/** The in-character 503 answers of the real API ("the paw is resting"). */
export function restingBody(): ErrorBody {
  return { message: 'The paw is resting. Browse the examples until it wakes.' };
}
