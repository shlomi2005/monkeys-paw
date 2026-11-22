import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_MESSAGES } from '../src/api-client';

/**
 * The tool repeats a message of the Paw API only when it is one of the API's fixed messages, and
 * then as a sentence of its own. These tests read the API's source files as text (no import, no
 * environment file) so that a changed or a new message there cannot go unseen here.
 */

const read = (relative: string): string =>
  readFileSync(new URL(`../../../apps/api/src/${relative}`, import.meta.url), 'utf8');

const SOURCES = [read('routes/grant.ts'), read('routes/bind.ts'), read('budget/messages.ts')].join('\n');

/** The 500 answers say what failed in the route; the tool does not repeat them (it says the status). */
const SERVER_FAILURE = /^An error occurred while /;

describe('the API messages the tool knows', () => {
  it('are the five fixed messages of the API', () => {
    expect([...API_MESSAGES.keys()]).toHaveLength(5);
  });

  it.each([...API_MESSAGES.keys()])('%j is a string literal in the API source', (message) => {
    expect(SOURCES.includes(`'${message}'`)).toBe(true);
  });

  it('every message literal of the grant and bind routes is known here, or is a 500 text', () => {
    const literals = [...[read('routes/grant.ts'), read('routes/bind.ts')].join('\n').matchAll(/message:\s*'([^']*)'/g)].map(
      (match) => match[1],
    );
    expect(literals.length).toBeGreaterThan(0);
    for (const literal of literals) {
      expect(API_MESSAGES.has(literal) || SERVER_FAILURE.test(literal), `unknown message literal ${literal}`).toBe(true);
    }
  });

  it('our sentences carry nothing of the API text', () => {
    for (const [upstream, ours] of API_MESSAGES) {
      expect(ours).not.toBe(upstream);
      expect(ours).toMatch(/^[\x20-\x7e]+$/); // ASCII
    }
  });
});
