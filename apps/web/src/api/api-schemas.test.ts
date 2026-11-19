// Unit tests for `normalizeGrant` and the bind consistency check (design.md section 6).

import type { Curse, Grant, Verdict } from 'paw-core';
import { describe, expect, it } from 'vitest';
import { isBindConsistent, normalizeGrant } from './api-schemas';

function curse(id: string, overrides: Partial<Curse> = {}): Curse {
  return {
    id,
    type: 'permissions',
    story: `Story ${id}.`,
    loophole: `Loophole ${id}.`,
    status: 'open',
    ...overrides,
  };
}

function grantOf(...curses: Curse[]): Grant {
  return { wishId: 'wish-1', narration: 'Granted.', curses };
}

function verdictFor(curseId: string, closed: boolean): Verdict {
  return { curseId, closed, reason: 'Because.', judgedAt: 1 };
}

describe('normalizeGrant', () => {
  const closedCurse = curse('b', {
    status: 'closed',
    binding: { curseId: 'b', kind: 'ears-clause', clause: 'WHEN x THE SYSTEM SHALL y', proposedAt: 5 },
    verdict: { curseId: 'b', closed: true, reason: 'Shut.', judgedAt: 6, property: 'p' },
  });
  const source = grantOf(curse('a'), closedCurse, curse('c', { status: 'closed' }));

  it('opens every curse', () => {
    const result = normalizeGrant(source);
    expect(result.curses.map((c) => c.status)).toEqual(['open', 'open', 'open']);
  });

  it('drops every binding and verdict', () => {
    const result = normalizeGrant(source);
    for (const c of result.curses) {
      expect(c).not.toHaveProperty('binding');
      expect(c).not.toHaveProperty('verdict');
    }
  });

  it('keeps ids, order, types, stories and loopholes', () => {
    const result = normalizeGrant(source);
    expect(result.curses.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(result.curses[1]).toEqual({
      id: 'b',
      type: 'permissions',
      story: 'Story b.',
      loophole: 'Loophole b.',
      status: 'open',
    });
  });

  it('keeps the grant-level fields', () => {
    const withStory: Grant = { ...source, userStory: 'As a user, I want x.' };
    const result = normalizeGrant(withStory);
    expect(result.wishId).toBe('wish-1');
    expect(result.narration).toBe('Granted.');
    expect(result.userStory).toBe('As a user, I want x.');
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(source);
    normalizeGrant(source);
    expect(JSON.stringify(source)).toBe(before);
    expect(source.curses[1]?.status).toBe('closed');
  });

  it('returns the same shape for an already normal grant', () => {
    const fresh = grantOf(curse('a'), curse('b'), curse('c'));
    expect(normalizeGrant(fresh)).toEqual(fresh);
  });
});

describe('isBindConsistent', () => {
  it('accepts a closed verdict whose curse is closed', () => {
    const grant = grantOf(curse('a'), curse('b', { status: 'closed' }), curse('c'));
    expect(isBindConsistent('b', { grant, verdict: verdictFor('b', true) })).toBe(true);
  });

  it('accepts an open verdict whose curse is open', () => {
    const grant = grantOf(curse('a'), curse('b'), curse('c'));
    expect(isBindConsistent('b', { grant, verdict: verdictFor('b', false) })).toBe(true);
  });

  it('rejects a closed verdict when the curse is still open', () => {
    const grant = grantOf(curse('a'), curse('b'), curse('c'));
    expect(isBindConsistent('b', { grant, verdict: verdictFor('b', true) })).toBe(false);
  });

  it('rejects an open verdict when the curse is closed', () => {
    const grant = grantOf(curse('a'), curse('b', { status: 'closed' }), curse('c'));
    expect(isBindConsistent('b', { grant, verdict: verdictFor('b', false) })).toBe(false);
  });

  it('rejects a verdict for a different curse than the one requested', () => {
    const grant = grantOf(curse('a', { status: 'closed' }), curse('b'), curse('c'));
    expect(isBindConsistent('b', { grant, verdict: verdictFor('a', true) })).toBe(false);
  });

  it('rejects a matching verdict when the requested curse is not in the grant', () => {
    const grant = grantOf(curse('a'), curse('b'), curse('c'));
    expect(isBindConsistent('zz', { grant, verdict: verdictFor('zz', false) })).toBe(false);
    expect(isBindConsistent('zz', { grant, verdict: verdictFor('zz', true) })).toBe(false);
  });

  it('rejects when the verdict names a curse that is missing and the request names another', () => {
    const grant = grantOf(curse('a'), curse('b'), curse('c'));
    expect(isBindConsistent('a', { grant, verdict: verdictFor('zz', false) })).toBe(false);
  });

  it('looks the curse up by id, not by position', () => {
    const grant = grantOf(curse('a', { status: 'closed' }), curse('b'), curse('c'));
    expect(isBindConsistent('b', { grant, verdict: verdictFor('b', false) })).toBe(true);
    expect(isBindConsistent('b', { grant, verdict: verdictFor('b', true) })).toBe(false);
  });
});
