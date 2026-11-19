// exportSpec: generate requirementsMd (user story + EARS acceptance criteria)
// and propertiesMd (one property per closed curse). Include IntegrityResult.
//
// Style: acceptance criteria are plain EARS lines ("1. WHEN ... THE SYSTEM SHALL ...").
// Property lines have one format, model-written or template:
//   - *For any* <sentence> [`<curse-type>`] (Requirement 1.<k>)
// where k is the number of the curse's acceptance criterion.

import { isEarsCriterion } from './ears';
import { computeIntegrity } from './integrity';
import type { Curse, Grant, SpecExport, Wish } from './types';

/** Collapse all whitespace (including newlines) so each item stays on one markdown line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Remove trailing sentence punctuation and spaces. */
function stripTrailingPunctuation(text: string): string {
  return text.replace(/[\s.!?;:,]+$/, '');
}

/** Lowercase the first letter, unless the first word looks like an acronym (e.g. "API"). */
function lowerFirst(text: string): string {
  if (text.length === 0) return text;
  if (text.length > 1 && /[A-Z]/.test(text[1]!)) return text;
  return text[0]!.toLowerCase() + text.slice(1);
}

/**
 * Criterion 1: the wish restated in EARS.
 * Uses the Genie's `wishCriterion` when it reads as EARS; otherwise a deterministic restatement.
 */
function wishCriterionText(wish: Wish, grant: Grant): string {
  if (grant.wishCriterion && isEarsCriterion(grant.wishCriterion)) {
    return oneLine(grant.wishCriterion);
  }

  const wishText = oneLine(wish.text);
  const body = lowerFirst(stripTrailingPunctuation(wishText) || wishText);
  const context = wish.context ? stripTrailingPunctuation(oneLine(wish.context)) : '';
  const where = context ? `, in the context of ${context}` : '';
  return `THE SYSTEM SHALL ensure that ${body}${where}.`;
}

/**
 * Generate the EARS acceptance criterion for a single closed binding.
 * The curse's binding.clause is either a rewrite or an EARS clause. A clause that already
 * starts with an EARS keyword (any case) gets the keyword uppercased; anything else is
 * prefixed with "THE SYSTEM SHALL".
 */
function earsCriterion(clauseText: string): string {
  const trimmed = oneLine(clauseText);
  const match = /^(WHEN|IF|WHILE|WHERE|THE SYSTEM SHALL)\b/i.exec(trimmed);
  if (match) {
    return match[1]!.toUpperCase() + trimmed.slice(match[1]!.length);
  }
  return `THE SYSTEM SHALL ${trimmed}`;
}

/**
 * One property line for a closed curse, in the one format used for model-written and template
 * properties: `- *For any* ... [`type`] (Requirement 1.k)`.
 * The model-written verdict.property is used only when it starts with "For any" (any case).
 */
function curseProperty(curse: Curse, wish: Wish, requirementNumber: number): string {
  const suffix = ` [\`${curse.type}\`] (Requirement 1.${requirementNumber})`;

  const modelProperty = curse.verdict?.property ? oneLine(curse.verdict.property) : '';
  const lead = /^for any\b/i.exec(modelProperty);
  if (lead) {
    return `- *For any*${modelProperty.slice(lead[0].length)}${suffix}`;
  }

  const boundClause = oneLine(curse.binding?.clause || '(binding not found)');
  return `- *For any* wish matching "${oneLine(wish.text)}", ${boundClause}${suffix}`;
}

/**
 * Export a Kiro-ready spec: requirementsMd (user story + EARS criteria)
 * and propertiesMd (one property per closed curse).
 *
 * Task 22: exportSpec takes the original Wish to include in the introduction
 * and to use in property generation.
 */
export function exportSpec(wish: Wish, grant: Grant): SpecExport {
  const integrity = computeIntegrity(grant);

  // Collect closed curses with their bindings.
  const closedCurses = grant.curses.filter(
    (c) => c.status === 'closed' && c.binding && c.verdict,
  );

  // Req 6.2: Generate requirements.md in Kiro format with Introduction, User Story, and EARS criteria.
  // Criterion 1 is the wish in EARS, then one criterion per closed curse (numbered from 2).
  const acceptanceCriteria = [
    `1. ${wishCriterionText(wish, grant)}`,
    ...closedCurses.map((c, idx) => `${idx + 2}. ${earsCriterion(c.binding!.clause)}`),
  ];

  const requirementsMd = [
    '# Requirements Document',
    '',
    '## Introduction',
    '',
    `The requirement is: "${wish.text}"${wish.context ? ` (Context: ${wish.context})` : ''}`,
    '',
    `**Wish Integrity:** ${integrity.score}/5 (${integrity.closed}/${integrity.total} curses closed)`,
    '',
    '### Requirement 1',
    '',
    // Task 25: Use grant.userStory if available, otherwise fall back to template
    `**User Story:** ${grant.userStory || `As a spec author, I want this requirement to be airtight, so ${wish.text.toLowerCase()}`}`,
    '',
    '#### Acceptance Criteria',
    '',
    ...acceptanceCriteria,
    '',
  ].join('\n');

  // Req 6.3: Generate properties.md with one property per closed curse.
  // Each property points at the acceptance criterion that closes its curse (idx + 2).
  const propertyLines = closedCurses.map((c, idx) => curseProperty(c, wish, idx + 2));
  const propertiesMd = [
    '# Correctness Properties',
    '',
    '## Derived from Closed Curses',
    '',
    ...(propertyLines.length > 0
      ? propertyLines
      : ['*(No properties yet; close a curse to add one.)*']),
    '',
  ].join('\n');

  return {
    wishId: grant.wishId,
    requirementsMd,
    propertiesMd,
    integrity,
  };
}
