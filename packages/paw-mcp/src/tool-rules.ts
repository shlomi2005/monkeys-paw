import { z } from 'zod';
import { describeInputError } from './issue';
import { errorResult, textResult, type ToolResult } from './render';
import { buildRules } from './rules';

export const inputShape = {
  kind: z
    .enum(['curse', 'bind'], { errorMap: () => ({ message: 'kind must be "curse" or "bind"' }) })
    .describe('"curse" to find loopholes in a requirement; "bind" to judge whether an amendment closes one.'),
};

export const outputShape = {
  kind: z.enum(['curse', 'bind']),
  sections: z.array(z.object({ name: z.string(), text: z.string() })),
  jsonSchema: z.record(z.unknown()),
  next: z.string(),
};

export const DESCRIPTION =
  'Get the rules of the Monkey\'s Paw as text: kind "curse" for finding loopholes in a requirement, kind "bind" for ' +
  'judging whether an amendment closes one. Call it first. It calls no model and no server.';

export async function handleRules(args: unknown): Promise<ToolResult> {
  const input = z.object(inputShape).safeParse(args);
  if (!input.success) return errorResult(describeInputError(input.error));
  const { text, kind, sections, jsonSchema, next } = buildRules(input.data.kind);
  return textResult(text, { kind, sections, jsonSchema, next });
}
