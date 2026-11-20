import { z } from 'zod';
import { BindingKindSchema } from 'paw-core';
import { checkVerdict } from './check-verdict';
import { describeInputError } from './issue';
import { errorResult, renderLocalVerdict, renderProblems, textResult, type ToolResult } from './render';

export const inputShape = {
  curse: z
    .union([z.record(z.unknown()), z.string()], {
      errorMap: () => ({ message: 'curse must be an object, or a JSON string of an object' }),
    })
    .describe(
      'The curse being closed, {type, story, loophole} with an optional id (default curse-0), as paw_check_curses returns it; or a JSON string of that object.',
    ),
  amendment: z
    .string()
    .trim()
    .min(1, 'amendment must not be empty')
    .max(500, 'amendment must be at most 500 characters')
    .describe('The EARS clause or the rewritten requirement that should close the loophole. At most 500 characters.'),
  kind: BindingKindSchema.default('ears-clause').describe(
    "'ears-clause' (default) adds a clause; 'rewrite' replaces the requirement.",
  ),
  verdict: z
    .union([z.record(z.unknown()), z.string()], {
      errorMap: () => ({ message: 'verdict must be an object, or a JSON string of an object' }),
    })
    .describe(
      'Your verdict as the Judge: {closed, reason, property?}, or a JSON string of that object. property is required when closed is true. Get the rules from paw_rules (kind bind) first.',
    ),
};

export const outputShape = {
  verdict: z.object({
    curseId: z.string(),
    closed: z.boolean(),
    reason: z.string(),
    property: z.string().optional(),
    judgedAt: z.number(),
  }),
  binding: z.object({
    curseId: z.string(),
    kind: BindingKindSchema,
    clause: z.string(),
    proposedAt: z.number(),
  }),
};

export const DESCRIPTION =
  'Check the verdict you wrote as the Judge on an amendment against the Judge\'s rules. On success it returns the ' +
  'normalised verdict and binding; on failure it lists every problem, one per line. Nothing is stored. It calls no ' +
  'model and no server.';

export const FAILURE_HEADING = 'The verdict does not pass yet:';

export async function handleCheckVerdict(now: () => number, args: unknown): Promise<ToolResult> {
  const input = z.object(inputShape).safeParse(args);
  if (!input.success) return errorResult(describeInputError(input.error));
  const result = checkVerdict(input.data, now);
  if (!result.ok) return errorResult(renderProblems(FAILURE_HEADING, result.problems));
  return textResult(renderLocalVerdict(result.verdict), { verdict: result.verdict, binding: result.binding });
}
