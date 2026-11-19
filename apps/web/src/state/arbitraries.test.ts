import * as fc from 'fast-check';
import { CurseTypeSchema } from 'paw-core';
import { describe, expect, it } from 'vitest';
import { arbGrant, arbSession, numRuns } from './arbitraries';
import type { Session } from './arbitraries';

describe('arbitraries (generator support, does not call reduce)', () => {
  it('arbGrant always yields 3-5 curses with unique, non-empty ids and valid types', () => {
    fc.assert(
      fc.property(arbGrant, (grant) => {
        const ids = grant.curses.map((c) => c.id);
        expect(grant.curses.length).toBeGreaterThanOrEqual(3);
        expect(grant.curses.length).toBeLessThanOrEqual(5);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.every((id) => id.length > 0)).toBe(true);
        expect(grant.curses.every((c) => CurseTypeSchema.options.includes(c.type))).toBe(true);
      }),
      { numRuns: numRuns() },
    );
  });

  it('shrinking a failing session property returns a shorter intent list', () => {
    let firstFailing: Session | null = null;
    const result = fc.check(
      fc.property(arbSession, (session) => {
        const holds = !session.intents.some((intent) => intent.kind === 'stop');
        if (!holds && firstFailing === null) firstFailing = session;
        return holds;
      }),
      { seed: 20260101, numRuns: 500 },
    );

    expect(result.failed).toBe(true);
    const original = firstFailing as Session | null;
    expect(original).not.toBeNull();
    const shrunk = (result.counterexample as [Session])[0];
    expect(shrunk.intents.length).toBeGreaterThanOrEqual(1);
    expect(shrunk.intents.length).toBeLessThan((original as Session).intents.length);
    expect(shrunk.intents.some((intent) => intent.kind === 'stop')).toBe(true);
  });
});
