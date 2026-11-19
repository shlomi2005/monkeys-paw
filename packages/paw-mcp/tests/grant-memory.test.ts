import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGrantMemory, openHandles } from '../src/grant-memory';
import { makeGrant } from './fixtures';

const id = (n: number): string => `wish${String(n).padStart(4, '0')}-0000`;

describe('grant memory', () => {
  it('evicts the oldest grant when the 21st arrives', () => {
    const memory = createGrantMemory();
    for (let n = 1; n <= 21; n++) memory.remember(makeGrant(id(n)));
    expect(memory.size()).toBe(20);
    expect(memory.resolve(`${id(1).slice(0, 8)}:curse-0`)).toBeNull();
    expect(memory.resolve(`${id(2).slice(0, 8)}:curse-0`)).not.toBeNull();
    expect(memory.resolve(`${id(21).slice(0, 8)}:curse-0`)).not.toBeNull();
  });

  it('remembering an old grant again makes it the newest', () => {
    const memory = createGrantMemory(2);
    memory.remember(makeGrant(id(1)));
    memory.remember(makeGrant(id(2)));
    memory.remember(makeGrant(id(1)));
    memory.remember(makeGrant(id(3)));
    expect(memory.resolve(`${id(2).slice(0, 8)}:curse-0`)).toBeNull();
    expect(memory.resolve(`${id(1).slice(0, 8)}:curse-0`)).not.toBeNull();
  });

  it('resolves a full handle to that grant and curse', () => {
    const memory = createGrantMemory();
    memory.remember(makeGrant('aaaaaaaa-1'));
    memory.remember(makeGrant('bbbbbbbb-2'));
    const found = memory.resolve('aaaaaaaa:curse-2');
    expect(found?.grant.wishId).toBe('aaaaaaaa-1');
    expect(found?.curse.id).toBe('curse-2');
    expect(found?.handle).toBe('aaaaaaaa:curse-2');
  });

  it('returns null for a curse the grant does not hold', () => {
    const memory = createGrantMemory();
    memory.remember(makeGrant('aaaaaaaa-1', 3));
    expect(memory.resolve('aaaaaaaa:curse-4')).toBeNull();
    expect(memory.resolve('zzzzzzzz:curse-0')).toBeNull();
  });

  it('a bare id uses the newest grant only', () => {
    const memory = createGrantMemory();
    memory.remember(makeGrant('aaaaaaaa-1', 5));
    memory.remember(makeGrant('bbbbbbbb-2', 3));
    expect(memory.resolve('curse-1')?.grant.wishId).toBe('bbbbbbbb-2');
    expect(memory.resolve('curse-4')).toBeNull();
  });

  it('strips one pair of brackets or quotes and surrounding spaces', () => {
    const memory = createGrantMemory();
    memory.remember(makeGrant('aaaaaaaa-1'));
    for (const text of ['[aaaaaaaa:curse-2]', '"aaaaaaaa:curse-2"', "'aaaaaaaa:curse-2'", '  [aaaaaaaa:curse-2]  ', '[ aaaaaaaa:curse-2 ]']) {
      expect(memory.resolve(text)?.handle, text).toBe('aaaaaaaa:curse-2');
    }
    expect(memory.resolve('[curse-1]')?.curse.id).toBe('curse-1');
    expect(memory.resolve('"curse-1"')?.curse.id).toBe('curse-1');
  });

  it('strips only one pair and only a matching pair', () => {
    const memory = createGrantMemory();
    memory.remember(makeGrant('aaaaaaaa-1'));
    for (const text of ['[[aaaaaaaa:curse-2]]', '[aaaaaaaa:curse-2', 'aaaaaaaa:curse-2]', '"aaaaaaaa:curse-2\'', '[]', '"', '']) {
      expect(memory.resolve(text), text).toBeNull();
    }
  });

  it('a bare id on an empty memory is unknown', () => {
    expect(createGrantMemory().resolve('curse-0')).toBeNull();
  });

  it('two wishIds that share the first 8 characters resolve to the newest', () => {
    const memory = createGrantMemory();
    memory.remember(makeGrant('samepref-old'));
    memory.remember(makeGrant('samepref-new'));
    expect(memory.resolve('samepref:curse-0')?.grant.wishId).toBe('samepref-new');
  });

  it('lists the open handles of a grant', () => {
    const grant = makeGrant('aaaaaaaa-1', 3);
    grant.curses[1] = { ...grant.curses[1]!, status: 'closed' };
    expect(openHandles(grant)).toEqual(['aaaaaaaa:curse-0', 'aaaaaaaa:curse-2']);
  });

  it('never holds more than 20 grants (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 12 }), { maxLength: 80 }), (wishIds) => {
        const memory = createGrantMemory();
        for (const wishId of wishIds) {
          memory.remember(makeGrant(wishId));
          expect(memory.size()).toBeLessThanOrEqual(20);
        }
        expect(memory.size()).toBeLessThanOrEqual(new Set(wishIds).size);
      }),
    );
  });
});
