import {
  CurseSchema,
  EARS_CLAUSE_FORMAT,
  VerdictSchema,
  isEarsCriterion,
  proposeBinding,
  type Binding,
  type BindingKind,
  type Curse,
  type Verdict,
} from 'paw-core';
import { MAX_PROBLEMS } from './check-curses';
import { describeIssue } from './issue';
import { parseJsonArg } from './json-arg';
import { PROPERTY_MAX_WORDS } from './limits';

export interface CheckVerdictInput {
  curse: unknown;
  amendment: string;
  kind: BindingKind;
  verdict: unknown;
}

export type CheckVerdictResult =
  | { ok: true; curse: Curse; verdict: Verdict; binding: Binding }
  | { ok: false; problems: string[] };

function parseCurse(value: unknown, problems: string[]): Curse | null {
  const parsed = parseJsonArg(value, 'curse', 'object');
  if (!parsed.ok) {
    problems.push(parsed.problem);
    return null;
  }
  const raw = parsed.value;
  // Only these keys count; a `binding` or `verdict` the client attaches is ignored.
  const candidate = {
    id: raw.id ?? 'curse-0',
    type: raw.type,
    story: raw.story,
    loophole: raw.loophole,
    status: raw.status ?? 'open',
  };
  const result = CurseSchema.safeParse(candidate);
  if (!result.success) {
    for (const issue of result.error.issues) problems.push(describeIssue('curse', issue));
    return null;
  }
  return result.data;
}

/** The checked verdict fields (without the injected `curseId` and `judgedAt`), or null after pushing problems. */
function parseVerdictFields(
  value: unknown,
  problems: string[],
): { closed: boolean; reason: string; property?: string } | null {
  const parsed = parseJsonArg(value, 'verdict', 'object');
  if (!parsed.ok) {
    problems.push(parsed.problem);
    return null;
  }
  const raw = parsed.value;
  const before = problems.length;

  const closed = raw.closed;
  if (typeof closed !== 'boolean') problems.push('verdict.closed must be true or false.');

  let reason = '';
  if (raw.reason === undefined || raw.reason === null) problems.push('verdict.reason must not be empty.');
  else if (typeof raw.reason !== 'string') problems.push('verdict.reason must be a string.');
  else if (raw.reason.trim() === '') problems.push('verdict.reason must not be empty.');
  else reason = raw.reason.trim();

  let property: string | undefined;
  if (closed === true) {
    const p = raw.property;
    if (p === undefined || p === null || (typeof p === 'string' && p.trim() === '')) {
      problems.push('verdict.property is required when closed is true.');
    } else if (typeof p !== 'string') {
      problems.push('verdict.property must be a string.');
    } else {
      const text = p.trim();
      if (!text.startsWith('For any')) problems.push('verdict.property must start with "For any".');
      const words = text.split(/\s+/).length;
      if (words > PROPERTY_MAX_WORDS) {
        problems.push(`verdict.property must be at most ${PROPERTY_MAX_WORDS} words (got ${words}).`);
      }
      property = text;
    }
  }
  if (problems.length > before || typeof closed !== 'boolean') return null;
  return property === undefined ? { closed, reason } : { closed, reason, property };
}

/**
 * Check the verdict an agent wrote as the Judge (Req 25). Pure: no network, no state. The system injects
 * `curseId` and `judgedAt` (from `now`), as `judgeBinding` does, and builds the binding with `proposeBinding`.
 */
export function checkVerdict(input: CheckVerdictInput, now: () => number): CheckVerdictResult {
  const problems: string[] = [];
  const curse = parseCurse(input.curse, problems);

  if (input.kind === 'ears-clause' && !isEarsCriterion(input.amendment)) {
    problems.push(`amendment is not an EARS clause. ${EARS_CLAUSE_FORMAT}`);
  }

  const fields = parseVerdictFields(input.verdict, problems);

  if (problems.length > 0 || !curse || !fields) {
    return { ok: false, problems: problems.slice(0, MAX_PROBLEMS) };
  }

  const verdict = VerdictSchema.safeParse({ ...fields, curseId: curse.id, judgedAt: now() });
  if (!verdict.success) {
    return {
      ok: false,
      problems: verdict.error.issues.map((issue) => describeIssue('verdict', issue)).slice(0, MAX_PROBLEMS),
    };
  }
  return { ok: true, curse, verdict: verdict.data, binding: proposeBinding(curse, input.amendment, input.kind) };
}
