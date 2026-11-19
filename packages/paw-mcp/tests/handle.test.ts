import { describe, expect, it } from 'vitest';
import { parseHandle, toHandle } from '../src/handle';

describe('handle', () => {
  it('uses the first 8 characters of the wishId', () => {
    expect(toHandle('3f2a9c1e-aaaa-bbbb', 'curse-2')).toBe('3f2a9c1e:curse-2');
  });

  it('keeps a short wishId whole', () => {
    expect(toHandle('abc', 'curse-0')).toBe('abc:curse-0');
  });

  it('round trips', () => {
    expect(parseHandle(toHandle('3f2a9c1e-aaaa', 'curse-4'))).toEqual({ prefix: '3f2a9c1e', curseId: 'curse-4' });
  });

  it('splits at the last colon', () => {
    expect(parseHandle('a:b:curse-1')).toEqual({ prefix: 'a:b', curseId: 'curse-1' });
  });

  it.each(['curse-1', '', ':curse-1', '3f2a9c1e:'])('rejects %j', (text) => {
    expect(parseHandle(text)).toBeNull();
  });
});
