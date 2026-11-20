import { describe, expect, it } from 'vitest';

import { EARS_CLAUSE_FORMAT, isEarsCriterion } from '../src/ears';

// Every plausible clause opener. isEarsCriterion accepts some of them; the format
// line must name exactly those.
const PROBES = [
  'WHEN',
  'IF',
  'WHILE',
  'WHERE',
  'THE SYSTEM SHALL',
  'WHENEVER',
  'UNLESS',
  'AFTER',
  'BEFORE',
  'UNTIL',
  'ALWAYS',
  'GIVEN',
  'THEN',
];

describe('EARS_CLAUSE_FORMAT', () => {
  it('is one line', () => {
    expect(EARS_CLAUSE_FORMAT.trim()).toBe(EARS_CLAUSE_FORMAT);
    expect(EARS_CLAUSE_FORMAT).not.toContain('\n');
  });

  it('names every keyword that isEarsCriterion accepts as a start, and none it rejects', () => {
    for (const keyword of PROBES) {
      const accepted = isEarsCriterion(`${keyword} the owner leaves, the system SHALL keep a member.`);
      const named = new RegExp(`\\b${keyword}\\b`).test(EARS_CLAUSE_FORMAT);
      expect({ keyword, named }).toEqual({ keyword, named: accepted });
    }
  });

  it('names the five openers explicitly and the need for SHALL', () => {
    for (const keyword of ['WHEN', 'IF', 'WHILE', 'WHERE', 'THE SYSTEM SHALL']) {
      expect(EARS_CLAUSE_FORMAT).toContain(keyword);
    }
    expect(EARS_CLAUSE_FORMAT).toMatch(/contain SHALL/);
  });

  it('a clause without SHALL is rejected, which the line says is required', () => {
    expect(isEarsCriterion('WHEN the owner leaves, the system keeps a member.')).toBe(false);
  });
});
