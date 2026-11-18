import { describe, expect, it } from 'vitest';

import { exportSpec } from '../src/export';
import type { Curse, Grant } from '../src/types';

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

describe('exportSpec (task 16)', () => {
  it('produces requirementsMd and propertiesMd for a grant with no closed curses', () => {
    const grant = makeGrant('w1', 0);
    const spec = exportSpec(grant);

    expect(spec.wishId).toBe('w1');
    expect(spec.requirementsMd.includes('Requirements')).toBe(true);
    expect(spec.propertiesMd.includes('Correctness Properties')).toBe(true);
    // No properties yet; should have a placeholder.
    expect(spec.propertiesMd.includes('No properties yet')).toBe(true);
    expect(spec.integrity.score).toBe(0);
  });

  it('produces one property per closed curse', () => {
    const grant = makeGrant('w1', 2);
    const spec = exportSpec(grant);

    // P2: one property per closed curse.
    const propertyCount = (spec.propertiesMd.match(/\*\*P\d+:/g) || []).length;
    expect(propertyCount).toBe(2);
  });

  it('generates EARS acceptance criteria from closed bindings', () => {
    const grant = makeGrant('w1', 1);
    const spec = exportSpec(grant);

    // The binding is "WHEN the owner leaves THEN an admin takes over"
    // which should appear in the criteria.
    expect(spec.requirementsMd.includes('WHEN the owner leaves')).toBe(true);
    expect(spec.requirementsMd.includes('an admin takes over')).toBe(true);
  });

  it('includes integrity score in the export', () => {
    const grant = makeGrant('w1', 1);
    const spec = exportSpec(grant);

    expect(spec.integrity.total).toBe(3);
    expect(spec.integrity.closed).toBe(1);
    expect(spec.integrity.open).toBe(2);
    // 1 closed out of 3 total: floor(1/3 * 5) = floor(1.666...) = 1
    expect(spec.integrity.score).toBe(1);
  });

  it('satisfies P1: every acceptance criterion matches the EARS pattern', () => {
    const grant = makeGrant('w1', 1);
    const spec = exportSpec(grant);

    const lines = spec.requirementsMd.split('\n');
    const criteriaLines = lines.filter((line) => line.startsWith('- '));

    for (const line of criteriaLines) {
      const criterion = line.substring(2); // Remove "- "
      // P1: every line must start with one of the EARS keywords.
      const matchesEars =
        /^(WHEN|IF|WHILE|WHERE|THE SYSTEM SHALL)/.test(criterion);
      expect(matchesEars).toBe(true);
    }
  });

  it('handles all closed curses correctly', () => {
    const grant = makeGrant('w1', 3);
    const spec = exportSpec(grant);

    // All 3 are closed.
    expect(spec.integrity.closed).toBe(3);
    expect(spec.integrity.open).toBe(0);
    expect(spec.integrity.score).toBe(5); // 3/3 * 5 = 5
    
    // Should have 3 properties.
    const propertyCount = (spec.propertiesMd.match(/\*\*P\d+:/g) || []).length;
    expect(propertyCount).toBe(3);
  });

  it('always produces valid (non-malformed) markdown files', () => {
    const grant = makeGrant('w1', 0);
    const spec = exportSpec(grant);

    // Basic sanity checks: no double newlines at the end, valid headers, etc.
    expect(spec.requirementsMd).toMatch(/^# Requirements/);
    expect(spec.propertiesMd).toMatch(/^# Correctness Properties/);
    expect(spec.requirementsMd.endsWith('\n')).toBe(true);
    expect(spec.propertiesMd.endsWith('\n')).toBe(true);
  });
});
