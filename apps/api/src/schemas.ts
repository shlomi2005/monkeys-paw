import { z } from 'zod';
import {
  BindingKindSchema,
  BindingSchema,
  CurseSchema,
  GrantSchema,
  IntegrityResultSchema,
  SpecExportSchema,
  VerdictSchema,
} from 'paw-core';

/**
 * Wish as created by the API (includes server-generated id and createdAt).
 * (Req 1.1, Task 18)
 */
export const WishSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(1, 'Wish text cannot be empty'),
  context: z.string().optional(),
  createdAt: z.number(),
});

export type Wish = z.infer<typeof WishSchema>;

/**
 * Request body for POST /api/grant.
 */
export const GrantRequestSchema = z.object({
  wish: z.object({
    text: z.string().trim().min(1, 'Wish text cannot be empty'),
    context: z.string().optional(),
  }),
});

export type GrantRequest = z.infer<typeof GrantRequestSchema>;

/**
 * Response for POST /api/grant.
 */
export const GrantResponseSchema = z.object({
  wish: WishSchema,
  grant: GrantSchema,
});

export type GrantResponse = z.infer<typeof GrantResponseSchema>;

/**
 * Request body for POST /api/bind.
 */
export const BindRequestSchema = z.object({
  grant: GrantSchema,
  curseId: z.string().min(1, 'curseId cannot be empty'),
  kind: BindingKindSchema,
  clause: z.string().trim().min(1, 'Binding clause cannot be empty'),
});

export type BindRequest = z.infer<typeof BindRequestSchema>;

/**
 * Response for POST /api/bind.
 */
export const BindResponseSchema = z.object({
  grant: GrantSchema,
  verdict: VerdictSchema,
});

export type BindResponse = z.infer<typeof BindResponseSchema>;

/**
 * Request body for POST /api/export.
 */
export const ExportRequestSchema = z.object({
  wish: WishSchema,
  grant: GrantSchema,
});

export type ExportRequest = z.infer<typeof ExportRequestSchema>;

/**
 * Examples array response schema.
 */
export const ExamplesResponseSchema = z.array(
  z.object({
    wish: WishSchema,
    grant: GrantSchema,
  }),
);

export type ExamplesResponse = z.infer<typeof ExamplesResponseSchema>;

/**
 * Health check response schema.
 */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  mode: z.enum(['normal', 'examples-only']),
  budget: z.object({
    dailyBudgetCents: z.number().int().min(0),
    spentCents: z.number().int().min(0),
    remainingCents: z.number().int().min(0),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
