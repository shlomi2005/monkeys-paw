import { z } from 'zod';
import {
  BindResponseSchema,
  BindingKindSchema,
  ExamplesResponseSchema,
  GrantResponseSchema,
  BindingSchema,
  CurseSchema,
  GrantSchema,
  VerdictSchema,
  WishSchema,
} from 'paw-core';
import type { BindResponse, ExamplesResponse, GrantResponse } from 'paw-core';

// Moved to paw-core (paw-web task 2, decision A7); re-exported so routes and tests keep their imports.
export { BindResponseSchema, ExamplesResponseSchema, GrantResponseSchema, WishSchema };
export type { BindResponse, ExamplesResponse, GrantResponse };

/**
 * Input caps (paw-api task 107). They bound the worst case of one grant and one bind
 * (`budget/worst-case.ts`) and match the web form and the MCP tools.
 */
/** Longest `wish.text`, in characters, after trim. */
export const MAX_WISH_TEXT_CHARS = 500;
/** Longest `wish.context`, in characters. */
export const MAX_WISH_CONTEXT_CHARS = 200;
/** Longest binding `clause`, in characters, after trim. */
export const MAX_CLAUSE_CHARS = 1000;
/** Longest `loophole` of any curse in a request, in characters. */
export const MAX_LOOPHOLE_CHARS = 1000;

/** Longest id (wish, curse, binding and verdict curse ids), in characters. */
export const MAX_ID_CHARS = 100;
/** Longest `userStory`, in characters. */
export const MAX_USER_STORY_CHARS = 1000;
/** Longest `wishCriterion`, in characters. */
export const MAX_WISH_CRITERION_CHARS = 1000;
/** Longest verdict `reason`, in characters. */
export const MAX_REASON_CHARS = 1000;
/** Longest verdict `property`, in characters. */
export const MAX_PROPERTY_CHARS = 1000;
/** A grant has 3 to 5 curses. */
export const MIN_CURSES = 3;
export const MAX_CURSES = 5;
/**
 * Largest request body read, in bytes. The largest legitimate export is five curses with every capped
 * string at its cap, and a control character costs 6 bytes of JSON ("\u0001"): about 5 x 4660 chars
 * (story 360, loophole, clause, reason and property 1000 each, three ids of 100) plus the grant (2360)
 * and the wish (800), x 6, is about 159 KB. 192 KiB leaves room for keys and numbers.
 */
export const MAX_BODY_BYTES = 192 * 1024;

const CappedBindingSchema = BindingSchema.extend({
  curseId: z.string().min(1).max(MAX_ID_CHARS),
  clause: z.string().min(1).max(MAX_CLAUSE_CHARS),
});
const CappedVerdictSchema = VerdictSchema.extend({
  curseId: z.string().min(1).max(MAX_ID_CHARS),
  reason: z.string().min(1).max(MAX_REASON_CHARS),
  property: z.string().max(MAX_PROPERTY_CHARS).optional(),
});
const CappedCurseSchema = CurseSchema.extend({
  id: z.string().min(1).max(MAX_ID_CHARS),
  loophole: z.string().min(1).max(MAX_LOOPHOLE_CHARS),
  binding: CappedBindingSchema.optional(),
  verdict: CappedVerdictSchema.optional(),
});
/** The grant a request may carry. The curse count is checked before any curse is parsed. */
export const CappedGrantSchema = GrantSchema.extend({
  wishId: z.string().min(1).max(MAX_ID_CHARS),
  userStory: z.string().max(MAX_USER_STORY_CHARS).optional(),
  wishCriterion: z.string().max(MAX_WISH_CRITERION_CHARS).optional(),
  curses: z.array(z.unknown()).min(MIN_CURSES).max(MAX_CURSES).pipe(z.array(CappedCurseSchema)),
});
/** The wish an export request may carry. */
export const CappedWishSchema = WishSchema.extend({
  id: z.string().min(1).max(MAX_ID_CHARS),
  text: z.string().trim().min(1, 'Wish text cannot be empty').max(MAX_WISH_TEXT_CHARS),
  context: z.string().trim().max(MAX_WISH_CONTEXT_CHARS).optional(),
});

/**
 * Request body for POST /api/grant.
 */
export const GrantRequestSchema = z.object({
  wish: z.object({
    text: z
      .string()
      .trim()
      .min(1, 'Wish text cannot be empty')
      .max(MAX_WISH_TEXT_CHARS, `Wish text is longer than ${MAX_WISH_TEXT_CHARS} characters`),
    context: z
      .string()
      .trim()
      .max(MAX_WISH_CONTEXT_CHARS, `Wish context is longer than ${MAX_WISH_CONTEXT_CHARS} characters`)
      .optional(),
  }),
});

export type GrantRequest = z.infer<typeof GrantRequestSchema>;

/**
 * Request body for POST /api/bind.
 */
export const BindRequestSchema = z.object({
  grant: CappedGrantSchema,
  curseId: z.string().min(1, 'curseId cannot be empty').max(MAX_ID_CHARS),
  kind: BindingKindSchema,
  clause: z
    .string()
    .trim()
    .min(1, 'Binding clause cannot be empty')
    .max(MAX_CLAUSE_CHARS, `Binding clause is longer than ${MAX_CLAUSE_CHARS} characters`),
});

export type BindRequest = z.infer<typeof BindRequestSchema>;

/**
 * Request body for POST /api/export.
 */
export const ExportRequestSchema = z.object({
  wish: CappedWishSchema,
  grant: CappedGrantSchema,
});

export type ExportRequest = z.infer<typeof ExportRequestSchema>;

/**
 * Health check response schema.
 */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  mode: z.enum(['normal', 'examples-only']),
  budget: z.object({
    dailyBudgetCents: z.number().min(0),
    spentCents: z.number().min(0),
    remainingCents: z.number().min(0),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
