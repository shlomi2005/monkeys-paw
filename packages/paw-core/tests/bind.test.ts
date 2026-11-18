import { describe, expect, it } from 'vitest';

import { proposeBinding } from '../src/bind';
import type { Curse } from '../src/types';

function makeCurse(id: string = 'c1'): Curse {
  return {
    id,
    type: 'permissions',
    story: 'A bad thing happens.',
    loophole: 'the exact words',
    status: 'open',
  };
}

describe('proposeBinding (task 10)', () => {
  it('creates a binding with kind "rewrite"', () => {
    const curse = makeCurse();
    const binding = proposeBinding(curse, 'Only the owner and admins can delete', 'rewrite');

    expect(binding.curseId).toBe('c1');
    expect(binding.kind).toBe('rewrite');
    expect(binding.clause).toBe('Only the owner and admins can delete');
    expect(binding.proposedAt).toBeGreaterThan(0);
  });

  it('creates a binding with kind "ears-clause"', () => {
    const curse = makeCurse();
    const binding = proposeBinding(
      curse,
      'WHEN the owner role is removed THEN the assigned admin takes over deletion',
      'ears-clause',
    );

    expect(binding.curseId).toBe('c1');
    expect(binding.kind).toBe('ears-clause');
    expect(binding.clause).toBe('WHEN the owner role is removed THEN the assigned admin takes over deletion');
  });

  it('trims whitespace from the clause', () => {
    const curse = makeCurse();
    const binding = proposeBinding(curse, '  Only admins can delete  ', 'rewrite');

    expect(binding.clause).toBe('Only admins can delete');
  });

  it('rejects empty clause text', () => {
    const curse = makeCurse();

    expect(() => proposeBinding(curse, '', 'rewrite')).toThrow(
      /Binding clause cannot be empty/,
    );
    expect(() => proposeBinding(curse, '   ', 'rewrite')).toThrow(
      /Binding clause cannot be empty/,
    );
  });

  it('records proposedAt as a valid timestamp', () => {
    const curse = makeCurse();
    const before = Date.now();
    const binding = proposeBinding(curse, 'a clause', 'rewrite');
    const after = Date.now();

    expect(binding.proposedAt).toBeGreaterThanOrEqual(before);
    expect(binding.proposedAt).toBeLessThanOrEqual(after);
  });
});
