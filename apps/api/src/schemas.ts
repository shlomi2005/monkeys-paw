import { z } from 'zod';
import {
  BindResponseSchema,
  BindingKindSchema,
  ExamplesResponseSchema,
  GrantResponseSchema,
  GrantSchema,
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
/** Longest `loophole` of the curse being judged, in characters. */
export const MAX_LOOPHOLE_CHARS = 1000;

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
  grant: GrantSchema,
  curseId: z.string().min(1, 'curseId cannot be empty'),
  kind: BindingKindSchema,
  clause: z
    .string()
    .trim()
    .min(1, 'Binding clause cannot be empty')
    .max(MAX_CLAUSE_CHARS, `Binding clause is longer than ${MAX_CLAUSE_CHARS} characters`),
});

export type BindRequest = z.infer<typeof BindRequestSchema>;

/** True when the curse being judged has a loophole short enough to put in the Judge prompt. */
export function isLoopholeWithinCap(curse: { loophole: string }): boolean {
  return curse.loophole.length <= MAX_LOOPHOLE_CHARS;
}

/**
 * Request body for POST /api/export.
 */
export const ExportRequestSchema = z.object({
  wish: WishSchema,
  grant: GrantSchema,
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
