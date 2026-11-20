import { CurseSchema, CurseTypeSchema } from 'paw-core';
import { describeIssue } from './issue';
import { isObject, parseJsonArg } from './json-arg';
import { LOOPHOLE_MAX, MAX_CURSES, MIN_CURSES, STORY_MAX } from './limits';

export const MAX_PROBLEMS = 10;

export interface CheckedCurse {
  id: string;
  type: (typeof CurseTypeSchema.options)[number];
  status: 'open';
  story: string;
  loophole: string;
}

export type CheckCursesResult =
  | { ok: true; curses: CheckedCurse[]; warnings: string[] }
  | { ok: false; problems: string[] };

/** Words of 4 or more letters, lowercased. A word is a run of Unicode letters. */
function wordsOf(text: string): Set<string> {
  const words = new Set<string>();
  for (const match of text.matchAll(/\p{L}+/gu)) {
    if ([...match[0]].length >= 4) words.add(match[0].toLowerCase());
  }
  return words;
}

function textField(
  item: Record<string, unknown>,
  name: 'story' | 'loophole',
  path: string,
  max: number,
  problems: string[],
): string | null {
  const raw = item[name];
  if (raw === undefined || raw === null) {
    problems.push(`${path}.${name} must not be empty.`);
    return null;
  }
  if (typeof raw !== 'string') {
    problems.push(`${path}.${name} must be a string.`);
    return null;
  }
  const text = raw.trim();
  if (text === '') {
    problems.push(`${path}.${name} must not be empty.`);
    return null;
  }
  const length = [...text].length;
  if (length > max) {
    problems.push(`${path}.${name} must be at most ${max} characters (got ${length}).`);
    return null;
  }
  return text;
}

/**
 * Check the curses an agent wrote (Req 24). Pure: no network, no state. Collects every problem, one line
 * each with its path. Keys other than `type`, `story` and `loophole` are ignored, so a client cannot choose an id.
 */
export function checkCurses(requirement: string, curses: unknown): CheckCursesResult {
  const parsed = parseJsonArg(curses, 'curses', 'array');
  if (!parsed.ok) return { ok: false, problems: [parsed.problem] };
  const items = parsed.value;

  if (items.length < MIN_CURSES || items.length > MAX_CURSES) {
    return { ok: false, problems: [`curses must have ${MIN_CURSES} to ${MAX_CURSES} items (got ${items.length}).`] };
  }

  const problems: string[] = [];
  const repeats: string[] = [];
  const checked: CheckedCurse[] = [];
  const firstWithType = new Map<string, number>();

  items.forEach((item, i) => {
    const path = `curses[${i}]`;
    if (!isObject(item)) {
      problems.push(`${path} must be an object.`);
      return;
    }
    const before = problems.length;
    const type = CurseTypeSchema.safeParse(item.type);
    if (!type.success) problems.push(`${path}.type must be one of: ${CurseTypeSchema.options.join(', ')}.`);
    const story = textField(item, 'story', path, STORY_MAX, problems);
    const loophole = textField(item, 'loophole', path, LOOPHOLE_MAX, problems);
    if (type.success) {
      const seen = firstWithType.get(type.data);
      if (seen === undefined) firstWithType.set(type.data, i);
      else {
        repeats.push(`${path}.type repeats "${type.data}" (curses[${seen}] has it); every curse needs its own type.`);
      }
    }
    if (problems.length > before || !type.success || story === null || loophole === null) return;

    const candidate = { id: `curse-${i}`, type: type.data, story, loophole, status: 'open' as const };
    const guard = CurseSchema.safeParse(candidate);
    if (!guard.success) {
      for (const issue of guard.error.issues) problems.push(describeIssue(path, issue));
      return;
    }
    checked.push(candidate);
  });

  problems.push(...repeats);
  if (problems.length > 0) return { ok: false, problems: problems.slice(0, MAX_PROBLEMS) };

  const requirementWords = wordsOf(requirement);
  const warnings: string[] = [];
  for (const curse of checked) {
    const quotes = [...wordsOf(curse.loophole)].some((word) => requirementWords.has(word));
    if (!quotes) {
      warnings.push(`${curse.id}: the loophole does not quote the requirement; point to its exact words.`);
    }
  }
  return { ok: true, curses: checked, warnings };
}
