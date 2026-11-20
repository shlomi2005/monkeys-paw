import type { z } from 'zod';

/** One zod issue as one line that names its path: `curse.type must be one of: ...`. */
export function describeIssue(prefix: string, issue: z.ZodIssue): string {
  const path = [prefix, ...issue.path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${part}`))]
    .join('')
    .replace(/^\./, '');
  switch (issue.code) {
    case 'invalid_enum_value':
      return `${path} must be one of: ${issue.options.join(', ')}.`;
    case 'invalid_type':
      return issue.received === 'undefined' ? `${path} is required.` : `${path} must be a ${issue.expected}.`;
    case 'too_small':
      return issue.type === 'string' ? `${path} must not be empty.` : `${path}: ${issue.message}.`;
    case 'too_big':
      return issue.type === 'string'
        ? `${path} must be at most ${String(issue.maximum)} characters.`
        : `${path}: ${issue.message}.`;
    default:
      return `${path}: ${issue.message.replace(/\.$/, '')}.`;
  }
}

/** First problem of a failed input parse, as one sentence that names the field. */
export function describeInputError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid input.';
  const field = issue.path.join('.');
  const text = field !== '' && !issue.message.includes(field) ? `${field}: ${issue.message}` : issue.message;
  return `Invalid input: ${text.replace(/\.$/, '')}.`;
}
