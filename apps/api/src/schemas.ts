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
    dailyBudgetCents: z.number().int().min(0),
    spentCents: z.number().int().min(0),
    remainingCents: z.number().int().min(0),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
