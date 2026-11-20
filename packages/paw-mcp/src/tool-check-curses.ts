import { z } from 'zod';
import { CurseTypeSchema } from 'paw-core';
import { checkCurses } from './check-curses';
import { describeInputError } from './issue';
import { errorResult, renderCheckedCurses, renderProblems, textResult, type ToolResult } from './render';

export const inputShape = {
  requirement: z
    .string()
    .trim()
    .min(1, 'requirement must not be empty')
    .max(500, 'requirement must be at most 500 characters')
    .describe('The requirement the curses are about: one software requirement with its key acceptance criteria. At most 500 characters.'),
  curses: z
    .union([z.array(z.unknown()), z.string()], {
      errorMap: () => ({ message: 'curses must be an array, or a JSON string of an array' }),
    })
    .describe(
      '3 to 5 curses, each {type, story, loophole}, no ids; or a JSON string of that array. Get the rules from paw_rules first.',
    ),
};

export const outputShape = {
  curses: z.array(
    z.object({
      id: z.string(),
      type: CurseTypeSchema,
      status: z.literal('open'),
      story: z.string(),
      loophole: z.string(),
    }),
  ),
  warnings: z.array(z.string()),
};

export const DESCRIPTION =
  'Check the curses you wrote for a requirement against the Paw\'s rules. On success it returns them with ids ' +
  '(curse-0...) and any warnings; on failure it lists every problem, one per line. It calls no model and no server.';

export const FAILURE_HEADING = 'The curses do not pass yet:';

export async function handleCheckCurses(args: unknown): Promise<ToolResult> {
  const input = z.object(inputShape).safeParse(args);
  if (!input.success) return errorResult(describeInputError(input.error));
  const result = checkCurses(input.data.requirement, input.data.curses);
  if (!result.ok) return errorResult(renderProblems(FAILURE_HEADING, result.problems));
  return textResult(renderCheckedCurses(result.curses, result.warnings), {
    curses: result.curses,
    warnings: result.warnings,
  });
}
