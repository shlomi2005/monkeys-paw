import { z } from 'zod';
import { CurseTypeSchema, GrantResponseSchema } from 'paw-core';
import type { ApiClient } from './api-client';
import type { GrantMemory } from './grant-memory';
import { curseViews, errorResult, renderCurses, textResult, type ToolResult } from './render';

export const inputShape = {
  requirement: z
    .string()
    .trim()
    .min(1, 'requirement must not be empty')
    .max(500, 'requirement must be at most 500 characters')
    .describe('One software requirement, with its key acceptance criteria. At most 500 characters.'),
  context: z
    .string()
    .trim()
    .max(200, 'context must be at most 200 characters')
    .optional()
    .describe('Optional: one line about the app or feature. At most 200 characters.'),
};

export const outputShape = {
  wishId: z.string(),
  narration: z.string(),
  curses: z.array(
    z.object({
      handle: z.string(),
      id: z.string(),
      type: CurseTypeSchema,
      status: z.enum(['open', 'closed']),
      story: z.string(),
      loophole: z.string(),
    }),
  ),
};

export const DESCRIPTION =
  'Curse a software requirement. The Paw follows it to the letter and returns up to five loopholes, ' +
  'each with a handle you can pass to paw_bind.';

export interface ToolDeps {
  api: ApiClient;
  memory: GrantMemory;
}

/** First problem of a failed input parse, as one sentence that names the field. */
export function describeInputError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid input.';
  const field = issue.path.join('.');
  const text = field !== '' && !issue.message.includes(field) ? `${field}: ${issue.message}` : issue.message;
  return `Invalid input: ${text.replace(/\.$/, '')}.`;
}

export async function handleCurse(deps: ToolDeps, args: unknown): Promise<ToolResult> {
  const input = z.object(inputShape).safeParse(args);
  if (!input.success) return errorResult(describeInputError(input.error));
  const { requirement, context } = input.data;

  const wish = context ? { text: requirement, context } : { text: requirement };
  const res = await deps.api.postJson('paw_curse', '/api/grant', { wish }, GrantResponseSchema);
  if (!res.ok) return errorResult(res.message);

  const { grant } = res.data;
  deps.memory.remember(grant);
  return textResult(renderCurses(grant), {
    wishId: grant.wishId,
    narration: grant.narration,
    curses: curseViews(grant),
  });
}
