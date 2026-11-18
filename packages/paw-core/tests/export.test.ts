import { describe, expect, it } from 'vitest';

import { exportSpec } from '../src/export';
import type { Curse, Grant, Wish } from '../src/types';

function makeCurse(id: string, type: string = 'permissions', status: 'open' | 'closed' = 'open'): Curse {
  if (status === 'closed') {
    return {
      id,
      type: type as any,
      story: 'A bad thing happens.',
      loophole: 'the exact words in the wish',
      status,
      binding: {
        curseId: id,
        kind: 'ears-clause',
        clause: 'WHEN the owner leaves THEN an admin takes over',
        proposedAt: 1_700_000_000_000,
      },
      verdict: {
        curseId: id,
        closed: true,
        reason: 'The binding prevents the loophole.',
        judgedAt: 1_700_000_001_000,
      },
    };
  }

  return {
    id,
    type: type as any,
    story: 'A bad thing happens.',
    loophole: 'the exact words in the wish',
    status,
  };
}

function makeGrant(wishId: string = 'w1', closed: number = 0): Grant {
  const total = 3;
  const curses = [];
  for (let i = 0; i < closed; i++) {
    curses.push(makeCurse(`c${i}`, 'permissions', 'closed'));
  }
  for (let i = closed; i < total; i++) {
    curses.push(makeCurse(`c${i}`, 'permissions', 'open'));
  }
  return {
    wishId,
    narration: 'The wish is granted literally.',
    curses,
  };
}

function makeWish(id: string = 'w1', text: string = 'Only the owner can delete a project.'): Wish {
  return {
    id,
    text,
    context: 'a project management app',
    createdAt: 1_700_000_000_000,
  };
}

describe('exportSpec (task 16)', () => {
  it('produces requirementsMd and propertiesMd for a grant with no closed curses', () => {
    const wish = makeWish();
    const grant = makeGrant('w1', 0);
    const spec = exportSpec(wish, grant);

    expect(spec.wishId).toBe('w1');
    expect(spec.requirementsMd.includes('# Requirements Document')).toBe(true);
    expect(spec.requirementsMd.includes('## Introduction')).toBe(true);
    expect(spec.requirementsMd.includes('**User Story:**')).toBe(true);
    expect(spec.propertiesMd.includes('# Correctness Properties')).toBe(true);
    // No properties yet; should have a placeholder.
    expect(spec.propertiesMd.includes('No properties yet')).toBe(true);
    expect(spec.integrity.score).toBe(0);
  });

  it('produces one property per closed curse', () => {
    const wish = makeWish();
    const grant = makeGrant('w1', 2);
    const spec = exportSpec(wish, grant);

    // P2: one property per closed curse.
    const propertyCount = (spec.propertiesMd.match(/\*For any\*/g) || []).length;
    expect(propertyCount).toBe(2);
  });

  it('generates EARS acceptance criteria from closed bindings', () => {
    const wish = makeWish();
    const grant = makeGrant('w1', 1);
    const spec = exportSpec(wish, grant);

    // The binding is "WHEN the owner leaves THEN an admin takes over"
    // which should appear in the criteria.
    expect(spec.requirementsMd.includes('WHEN the owner leaves')).toBe(true);
    expect(spec.requirementsMd.includes('an admin takes over')).toBe(true);
  });

  it('includes integrity score in the export', () => {
    const wish = makeWish();
    const grant = makeGrant('w1', 1);
    const spec = exportSpec(wish, grant);

    expect(spec.integrity.total).toBe(3);
    expect(spec.integrity.closed).toBe(1);
    expect(spec.integrity.open).toBe(2);
    // 1 closed out of 3 total: floor(1/3 * 5) = floor(1.666...) = 1
    expect(spec.integrity.score).toBe(1);
  });

  it('satisfies P1: every acceptance criterion matches the EARS pattern', () => {
    const wish = makeWish();
    const grant = makeGrant('w1', 1);
    const spec = exportSpec(wish, grant);

    const lines = spec.requirementsMd.split('\n');
    const criteriaLines = lines.filter((line) => /^\d+\./.test(line));

    for (const line of criteriaLines) {
      // P1: every numbered line must contain one of the EARS keywords.
      const matchesEars =
        /\b(WHEN|IF|WHILE|WHERE|THE SYSTEM SHALL)\b/.test(line);
      expect(matchesEars).toBe(true);
    }
  });

  it('handles all closed curses correctly', () => {
    const wish = makeWish();
    const grant = makeGrant('w1', 3);
    const spec = exportSpec(wish, grant);

    // All 3 are closed.
    expect(spec.integrity.closed).toBe(3);
    expect(spec.integrity.open).toBe(0);
    expect(spec.integrity.score).toBe(5); // 3/3 * 5 = 5
    
    // Should have 3 properties.
    const propertyCount = (spec.propertiesMd.match(/\*For any\*/g) || []).length;
    expect(propertyCount).toBe(3);
  });

  it('always produces valid (non-malformed) markdown files', () => {
    const wish = makeWish();
    const grant = makeGrant('w1', 0);
    const spec = exportSpec(wish, grant);

    // Basic sanity checks: no double newlines at the end, valid headers, etc.
    expect(spec.requirementsMd).toMatch(/^# Requirements Document/);
    expect(spec.propertiesMd).toMatch(/^# Correctness Properties/);
    expect(spec.requirementsMd.endsWith('\n')).toBe(true);
    expect(spec.propertiesMd.endsWith('\n')).toBe(true);
  });

  it('includes the original wish in the introduction', () => {
    const wish = makeWish('w1', 'Only the owner can delete a project.');
    const grant = makeGrant('w1', 0);
    const spec = exportSpec(wish, grant);

    expect(spec.requirementsMd).toContain('Only the owner can delete a project.');
    expect(spec.requirementsMd).toContain('a project management app');
  });

  it('includes numbered EARS acceptance criteria', () => {
    const wish = makeWish();
    const grant = makeGrant('w1', 2);
    const spec = exportSpec(wish, grant);

    // Should have criterion 1 (the original wish) + 2 more (the closed curses).
    expect(spec.requirementsMd).toMatch(/^1\./m);
    expect(spec.requirementsMd).toMatch(/^2\./m);
    expect(spec.requirementsMd).toMatch(/^3\./m);
  });

  it('properties start with "*For any*" and include curse type', () => {
    const wish = makeWish();
    const grant = makeGrant('w1', 1);
    const spec = exportSpec(wish, grant);

    const propertyLines = spec.propertiesMd.split('\n').filter((l) => l.startsWith('*For any*'));
    expect(propertyLines.length).toBe(1);
    
    const property = propertyLines[0];
    expect(property).toMatch(/\*For any\*/);
    expect(property).toMatch(/\`permissions\`/);
    expect(property).toMatch(/Req 6\.3/);
  });

  it('example: produces correct format for "Only the owner can delete a project" with 2 closed curses', () => {
    const wish: Wish = {
      id: 'w1',
      text: 'Only the owner can delete a project.',
      context: 'a project management app',
      createdAt: 1700000000000,
    };

    const grant: Grant = {
      wishId: 'w1',
      narration: 'The wish is granted literally. The system forbids deletion to anyone but the owner in all cases.',
      curses: [
        {
          id: 'c0',
          type: 'permissions',
          story: 'The owner quits the company. Now nobody can delete the project, not even admins.',
          loophole: 'Only the owner',
          status: 'closed',
          binding: {
            curseId: 'c0',
            kind: 'ears-clause',
            clause: 'WHEN the owner leaves THE SYSTEM SHALL transfer deletion rights to a designated admin',
            proposedAt: 1700000000000,
          },
          verdict: {
            curseId: 'c0',
            closed: true,
            reason: 'The binding ensures succession of deletion rights.',
            judgedAt: 1700000001000,
          },
        },
        {
          id: 'c1',
          type: 'data-loss',
          story: 'A ransomware attack deletes the project. Because only the owner can delete, nobody can restore it.',
          loophole: 'delete a project',
          status: 'closed',
          binding: {
            curseId: 'c1',
            kind: 'ears-clause',
            clause: 'IF data is deleted without authorization THE SYSTEM SHALL maintain immutable audit logs and enforce a 7-day soft-delete',
            proposedAt: 1700000000500,
          },
          verdict: {
            curseId: 'c1',
            closed: true,
            reason: 'The binding prevents permanent loss.',
            judgedAt: 1700000001500,
          },
        },
      ],
    };

    const spec = exportSpec(wish, grant);

    // Verify structure and content
    expect(spec.requirementsMd).toContain('# Requirements Document');
    expect(spec.requirementsMd).toContain('## Introduction');
    expect(spec.requirementsMd).toContain('Only the owner can delete a project.');
    expect(spec.requirementsMd).toContain('a project management app');
    expect(spec.requirementsMd).toContain('**User Story:**');
    expect(spec.requirementsMd).toContain('1. **WHEN**');
    expect(spec.requirementsMd).toContain('2. WHEN the owner leaves');
    expect(spec.requirementsMd).toContain('3. IF data is deleted');
    expect(spec.requirementsMd).toContain('**Wish Integrity:** 5/5');

    expect(spec.propertiesMd).toContain('# Correctness Properties');
    expect(spec.propertiesMd).toContain('*For any*');
    const propertyLines = spec.propertiesMd.split('\n').filter((l) => l.startsWith('*For any*'));
    expect(propertyLines).toHaveLength(2);
    expect(propertyLines[0]).toContain('`permissions`');
    expect(propertyLines[1]).toContain('`data-loss`');
  });
});
