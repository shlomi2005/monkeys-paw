import { z } from 'zod';
import { BindResponseSchema, BindingKindSchema } from 'paw-core';
import { openHandles } from './grant-memory';
import { errorResult, renderVerdict, textResult, type ToolResult } from './render';
import { describeInputError, type ToolDeps } from './tool-curse';

export const inputShape = {
  curse: z
    .string()
    .trim()
    .min(1, 'curse must not be empty')
    .max(100, 'curse must be at most 100 characters')
    .describe('A handle from paw_curse such as 3f2a9c1e:curse-2, or a bare id such as curse-2 for the newest grant.'),
  amendment: z
    .string()
    .trim()
    .min(1, 'amendment must not be empty')
    .max(500, 'amendment must be at most 500 characters')
    .describe('The EARS clause or the rewritten requirement that should close the loophole. At most 500 characters.'),
  kind: BindingKindSchema.default('ears-clause').describe(
    "'ears-clause' (default) adds a clause; 'rewrite' replaces the requirement.",
  ),
};

export const outputShape = {
  handle: z.string(),
  closed: z.boolean(),
  reason: z.string(),
  property: z.string().optional(),
  openHandles: z.array(z.string()),
};

export const DESCRIPTION =
  'Test whether an amendment closes one loophole. The Judge answers CLOSED or OPEN. ' +
  'Call paw_curse first; handles last only while this server runs.';

export async function handleBind(deps: ToolDeps, args: unknown): Promise<ToolResult> {
  const input = z.object(inputShape).safeParse(args);
  if (!input.success) return errorResult(describeInputError(input.error));
  const { curse: ref, amendment, kind } = input.data;

  const found = deps.memory.resolve(ref);
  if (!found) {
    return errorResult(
      `Unknown curse "${ref.slice(0, 60)}". Call paw_curse first; handles last only while this server runs.`,
    );
  }

  const body = { grant: found.grant, curseId: found.curse.id, kind, clause: amendment };
  const res = await deps.api.postJson('paw_bind', '/api/bind', body, BindResponseSchema);
  if (!res.ok) return errorResult(res.message);

  const { grant, verdict } = res.data;
  deps.memory.remember(grant);
  return textResult(renderVerdict(verdict, grant), {
    handle: found.handle,
    closed: verdict.closed,
    reason: verdict.reason,
    ...(verdict.property ? { property: verdict.property } : {}),
    openHandles: openHandles(grant),
  });
}
