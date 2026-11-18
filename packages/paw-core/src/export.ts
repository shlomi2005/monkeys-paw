// exportSpec: generate requirementsMd (user story + EARS acceptance criteria)
// and propertiesMd (one property per closed curse). Include IntegrityResult.

import { computeIntegrity } from './integrity';
import type { Curse, Grant, SpecExport, Wish } from './types';

/**
 * Generate the EARS acceptance criteria markdown for a single closed binding.
 * The curse's binding.clause is the binding text (either a rewrite or an EARS clause).
 * We format it as an acceptance criterion starting with WHEN/IF/WHILE/WHERE/THE SYSTEM SHALL.
 */
function earsCriterion(clauseText: string): string {
  const trimmed = clauseText.trim();
  // If the clause already starts with an EARS keyword, use it as-is.
  // Otherwise, prefix with "THE SYSTEM SHALL" and make it a constraint.
  if (
    trimmed.startsWith('WHEN ') ||
    trimmed.startsWith('IF ') ||
    trimmed.startsWith('WHILE ') ||
    trimmed.startsWith('WHERE ') ||
    trimmed.startsWith('THE SYSTEM SHALL ')
  ) {
    return trimmed;
  }
  // Fallback: treat as a constraint to enforce.
  return `THE SYSTEM SHALL ${trimmed}`;
}

/**
 * Generate a testable property statement from a closed curse.
 * One property per closed curse, phrased as a universally quantified invariant.
 * If the curse.verdict.property is present (Task 25), use it; otherwise fall back to template.
 * Format: *For any* <scenario derived from curse and binding>, <property> [<curse-type>] (Req <number>)
 */
function curseProperty(curse: Curse, requirement: Wish, index: number): string {
  const curseTypeTag = `${curse.type}`;
  
  // Task 25: Use verdict.property if available, otherwise fall back to template
  if (curse.verdict?.property) {
    return `- ${curse.verdict.property}`;
  }
  
  const boundClause = curse.binding?.clause || '(binding not found)';
  // Fall back to template format
  return `*For any* wish matching "${requirement.text}", ${boundClause} [\`${curseTypeTag}\`] (Req 6.3)`;
}

/**
 * Export a Kiro-ready spec: requirementsMd (user story + EARS criteria)
 * and propertiesMd (one property per closed curse).
 * 
 * Task 22: exportSpec now takes the original Wish to include in the introduction
 * and to use in property generation.
 */
export function exportSpec(wish: Wish, grant: Grant): SpecExport {
  const integrity = computeIntegrity(grant);

  // Collect closed curses with their bindings.
  const closedCurses = grant.curses.filter(
    (c) => c.status === 'closed' && c.binding && c.verdict,
  );

  // Req 6.2: Generate requirements.md in Kiro format with Introduction, User Story, and EARS criteria.
  // Start with wish as criterion 1, then add one per closed curse.
  const acceptanceCriteria = [
    `1. **WHEN** a requirement matches "${wish.text}"${wish.context ? ` in ${wish.context}` : ''} **THE SYSTEM SHALL** close all loopholes binding specific edge cases.`,
    ...closedCurses.map((c, idx) => {
      const clauseText = c.binding!.clause.trim();
      let criterion: string;
      
      // Check if clause starts with EARS keyword
      if (clauseText.match(/^(WHEN|IF|WHILE|WHERE|THE SYSTEM SHALL)\s/i)) {
        criterion = clauseText;
      } else {
        criterion = `THE SYSTEM SHALL ${clauseText}`;
      }
      
      return `${idx + 2}. ${criterion}`;
    }),
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
  // Task 23: Each property is phrased as a universally quantified testable statement.
  const propertyLines = closedCurses.map((c, i) => curseProperty(c, wish, i + 1));
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
