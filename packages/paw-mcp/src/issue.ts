import type { z } from 'zod';

/**
 * Problem lines for a failed input parse. A line never carries a received value or a key the caller
 * chose (paw-power Requirement 6.2): zod's own message for an enum or an unrecognized key quotes
 * them, so those codes get a sentence built here, and a path part is only used when it names one of
 * the fields of our own tools.
 */

/** The fields our tools and curses have. Any other path part is written as `field`. */
const SAFE_FIELDS: ReadonlySet<string> = new Set([
  'requirement',
  'context',
  'curses',
  'curse',
  'amendment',
  'kind',
  'verdict',
  'id',
  'type',
  'story',
  'loophole',
  'status',
  'closed',
  'reason',
  'property',
  'binding',
  'curseId',
  'clause',
  'proposedAt',
  'judgedAt',
]);

/** Codes whose zod message holds only numbers and our own words, never a received value. */
const MESSAGE_CODES: ReadonlySet<string> = new Set([
  'custom',
  'invalid_union',
  'too_small',
  'too_big',
  'not_multiple_of',
  'not_finite',
  'invalid_date',
]);

type PathPart = string | number;

function partOf(part: unknown): string {
  if (typeof part === 'number') return Number.isSafeInteger(part) && part >= 0 ? `[${part}]` : '[?]';
  return typeof part === 'string' && SAFE_FIELDS.has(part) ? `.${part}` : '.field';
}

function pathOf(prefix: string, path: readonly PathPart[]): string {
  return [prefix, ...path.map(partOf)].join('').replace(/^\./, '');
}

/** The options of an enum, only when each is a short plain token (they come from our schemas). */
function optionsOf(options: unknown): string {
  const list = Array.isArray(options) ? options : [];
  return list.filter((o): o is string => typeof o === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(o)).join(', ');
}

/** A message of one of our rules, with the path in front unless the message names it already. */
function ruleLine(path: string, message: string): string {
  const text = message.replace(/\.$/, '');
  return text.includes(path) ? `${text}.` : `${path}: ${text}.`;
}

/** The part of a problem that says what is wrong, without the field. No received value, no caller key. */
function sentenceOf(issue: z.ZodIssue, path: string): string {
  switch (issue.code) {
    case 'invalid_enum_value':
      // zod's own text quotes the received value; a message written by an errorMap of ours does not.
      return issue.message.startsWith('Invalid enum value')
        ? `${path} must be one of: ${optionsOf(issue.options)}.`
        : ruleLine(path, issue.message);
    case 'invalid_type':
      return issue.received === 'undefined' ? `${path} is required.` : `${path} must be a ${issue.expected}.`;
    case 'too_small':
      return issue.type === 'string' ? `${path} must not be empty.` : ruleLine(path, issue.message);
    case 'too_big':
      return issue.type === 'string'
        ? `${path} must be at most ${String(issue.maximum)} characters.`
        : ruleLine(path, issue.message);
    case 'unrecognized_keys':
      return `${path} has a key that is not allowed.`;
    default:
      if (!MESSAGE_CODES.has(issue.code)) return `${path} is not valid.`;
      return ruleLine(path, issue.message);
  }
}

/** One zod issue as one line that names its path: `curse.type must be one of: ...`. */
export function describeIssue(prefix: string, issue: z.ZodIssue): string {
  return sentenceOf(issue, pathOf(prefix, issue.path));
}

/** A failed input parse, by its first issue, as one sentence that names the field. */
export function describeInputIssue(issue: z.ZodIssue | undefined): string {
  if (!issue) return 'Invalid input.';
  const field = pathOf('', issue.path);
  const line = sentenceOf(issue, field === '' ? 'input' : field);
  return `Invalid input: ${line.replace(/\.$/, '')}.`;
}

/** First problem of a failed input parse, as one sentence that names the field. */
export function describeInputError(error: z.ZodError): string {
  return describeInputIssue(error.issues[0]);
}
