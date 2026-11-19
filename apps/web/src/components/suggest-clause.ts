// A starting EARS clause for the binding card (paw-web Req 4.2). The API sends no suggested clause and grants are
// normalized without a binding, so the card builds an editable template from the curse's type and loophole.
// Pure and total: it never throws, and the result is one line of plain text (no HTML).

import type { Curse } from 'paw-core';

/** Longest slice of the loophole quoted in the template. The user edits the rest. */
const MAX_QUOTE_LENGTH = 100;

/** What the user still has to write. Square brackets, so the template contains no angle brackets. */
const GAP = '[say what the system must do]';

/** Fallback when the loophole text is blank or unusable. */
const FALLBACK_QUOTE = 'the wish as written';

interface Template {
  /** Starts with an EARS keyword (IF, WHEN, WHILE or WHERE). `%` marks where the quoted loophole goes. */
  readonly condition: string;
  readonly response: string;
}

const TEMPLATES: Readonly<Record<string, Template>> = {
  permissions: {
    condition: 'IF the rule "%" leaves nobody allowed to act',
    response: '[name who may act instead and how they get access]',
  },
  time: {
    condition: 'WHEN the rule "%" meets a deadline, a time zone or a clock change',
    response: '[say which time counts and what happens at the boundary]',
  },
  money: {
    condition: 'IF the rule "%" produces a wrong, repeated or free amount',
    response: '[say how amounts are rounded, refunded or capped]',
  },
  scale: {
    condition: 'WHEN the rule "%" meets zero, one or a huge number of items',
    response: '[state the limit and what happens beyond it]',
  },
  abuse: {
    condition: 'IF a hostile user follows "%" to harm others',
    response: '[say what is blocked, limited or recorded]',
  },
  privacy: {
    condition: 'IF "%" exposes or keeps data nobody meant to expose or keep',
    response: '[say what is hidden, expired or deleted]',
  },
  accessibility: {
    condition:
      'IF a user relies on assistive technology, a slow network, a small screen or another language when "%" applies',
    response: '[say what they must still be able to do]',
  },
  'data-loss': {
    condition: 'IF "%" would delete or overwrite data',
    response: '[say what is confirmed first, kept or recoverable]',
  },
  concurrency: {
    condition: 'WHEN two users or two retries trigger "%" at the same moment',
    response: '[say which one wins and how duplicates are prevented]',
  },
  'edge-input': {
    condition: 'IF the input to "%" is empty, negative, very long, emoji, right-to-left or null',
    response: '[say whether it is accepted or rejected and what the user sees]',
  },
};

const DEFAULT_TEMPLATE: Template = { condition: 'IF "%" does not cover a real case', response: GAP };

/**
 * Turns loophole text into something safe to quote inside one sentence: one line, no angle brackets, no inner
 * double quotes, no sentence punctuation inside or at the end, at most `MAX_QUOTE_LENGTH` characters.
 */
function quoteOf(loophole: unknown): string {
  const text = typeof loophole === 'string' ? loophole : '';
  const cleaned = text
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/["\u201c\u201d]/g, "'")
    .replace(/\s*[.!?\u2026]+(?=\s|$)/g, ';')
    .replace(/[;\s]*;[;\s]*/g, '; ')
    .replace(/\s+/g, ' ')
    .replace(/^[;\s]+|[;\s]+$/g, '');
  if (cleaned === '') return FALLBACK_QUOTE;
  if (cleaned.length <= MAX_QUOTE_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_QUOTE_LENGTH).replace(/[;\s]+$/, '')} (…)`;
}

/** An editable EARS clause that starts from the curse's type and loophole. One sentence, ends with a period. */
export function suggestClause(curse: Pick<Curse, 'type' | 'loophole'>): string {
  const type: unknown = curse?.type;
  const template =
    typeof type === 'string' && Object.hasOwn(TEMPLATES, type) ? TEMPLATES[type] : DEFAULT_TEMPLATE;
  const condition = template.condition.replace('%', () => quoteOf(curse?.loophole));
  return `${condition}, THEN THE SYSTEM SHALL ${template.response}.`;
}
