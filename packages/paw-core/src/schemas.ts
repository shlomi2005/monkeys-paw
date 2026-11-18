import { z } from 'zod';

/** All 10 curse type tags from curse-taxonomy.md, in canonical order. */
export const CurseTypeSchema = z.enum([
  'permissions',
  'time',
  'money',
  'scale',
  'abuse',
  'privacy',
  'accessibility',
  'data-loss',
  'concurrency',
  'edge-input',
]);

export const BindingKindSchema = z.enum(['rewrite', 'ears-clause']);

export const VerdictSchema = z.object({
  curseId: z.string().min(1),
  closed: z.boolean(),
  reason: z.string().min(1),
  judgedAt: z.number(),
  property: z.string().optional(), // Task 25, Req 11.2
});

export const BindingSchema = z.object({
  curseId: z.string().min(1),
  kind: BindingKindSchema,
  clause: z.string().min(1),
  proposedAt: z.number(),
});

export const CurseSchema = z.object({
  id: z.string().min(1),
  type: CurseTypeSchema,
  // Task 94: Brevity by prompt, not by failure. Max 30 words ≈ 360 chars.
  story: z.string().max(360),
  loophole: z.string().min(1),
  status: z.enum(['open', 'closed']).default('open'),
  binding: BindingSchema.optional(),
  verdict: VerdictSchema.optional(),
});

export const GrantSchema = z.object({
  wishId: z.string().min(1),
  // Task 94: Narration max 25 words ≈ 260 chars.
  narration: z.string().min(1).max(260),
  curses: z.array(CurseSchema).min(3).max(5),
  userStory: z.string().optional(), // Task 25, Req 11.1
});

export const IntegrityResultSchema = z.object({
  score: z.number().int().min(0).max(5),
  total: z.number().int().min(0),
  closed: z.number().int().min(0),
  open: z.number().int().min(0),
});

export const SpecExportSchema = z.object({
  wishId: z.string().min(1),
  requirementsMd: z.string(),
  propertiesMd: z.string(),
  integrity: IntegrityResultSchema,
});

/** Judge quality-gate output (during grant): is the curse specific or generic? */
export const QualityGateSchema = z.object({
  specific: z.boolean(),
  reason: z.string().min(1),
});
