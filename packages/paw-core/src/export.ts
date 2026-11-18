// exportSpec: generate requirementsMd (user story + EARS acceptance criteria)
// and propertiesMd (one property per closed curse). Include IntegrityResult.

import { computeIntegrity } from './integrity';
import type { Grant, SpecExport } from './types';

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
 * One property per closed curse, phrased as an invariant.
 */
function curseProperty(curse: Curse, index: number): string {
  const curseTypeTag = `[${curse.type}]`;
  const boundClause = curse.binding?.clause || '(binding not found)';
  return `**P${index}: ${curseTypeTag}** — ${boundClause}`;
}

// Import Curse here to keep types separate from implementation
import type { Curse } from './types';

/**
 * Export a Kiro-ready spec: requirementsMd (user story + EARS criteria)
 * and propertiesMd (one property per closed curse).
 */
export function exportSpec(grant: Grant): SpecExport {
  const integrity = computeIntegrity(grant);

  // Collect closed curses with their bindings.
  const closedCurses = grant.curses.filter(
    (c) => c.status === 'closed' && c.binding && c.verdict,
  );

  // Req 6.2: Generate requirements.md with user story and EARS criteria.
  // The user story is inferred from the context (we'd need to pass the original wish text).
  // For now, we generate a header with the integrity score and then EARS criteria.
  const criteriaLines = closedCurses.map((c) => {
    const criterion = earsCriterion(c.binding!.clause);
    return `- ${criterion}`;
  });

  const requirementsMd = [
    '# Requirements',
    '',
    `**Wish Integrity:** ${integrity.score}/5 (${integrity.closed}/${integrity.total} curses closed)`,
    '',
    '## Acceptance Criteria',
    '',
    ...(criteriaLines.length > 0
      ? criteriaLines
      : ['*(No closed curses yet.)*']),
    '',
  ].join('\n');

  // Req 6.3: Generate properties.md with one property per closed curse.
  const propertyLines = closedCurses.map((c, i) => curseProperty(c, i + 1));
  const propertiesMd = [
    '# Correctness Properties',
    '',
    '## Closed Curses',
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
