import { CurseSchema, GrantSchema } from 'paw-core';

const cursesDef = GrantSchema.shape.curses._def;

/** 3 and 5: read from `GrantSchema`, not copied. */
export const MIN_CURSES = cursesDef.minLength?.value ?? 0;
export const MAX_CURSES = cursesDef.maxLength?.value ?? Number.POSITIVE_INFINITY;

/** 360: read from `CurseSchema`. */
export const STORY_MAX = CurseSchema.shape.story._def.checks.reduce(
  (max, check) => (check.kind === 'max' ? check.value : max),
  Number.POSITIVE_INFINITY,
);

/** The API's cap on a loophole in a bind request (not importable from `apps/api`). */
export const LOOPHOLE_MAX = 1000;

/** The Judge prompt's rule: a verdict property is at most 40 words. */
export const PROPERTY_MAX_WORDS = 40;
