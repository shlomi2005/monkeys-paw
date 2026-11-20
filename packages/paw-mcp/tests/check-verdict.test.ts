import { afterEach, describe, expect, it } from 'vitest';
import { checkVerdict, type CheckVerdictInput } from '../src/check-verdict';
import { connectPaw, textOf, type Connected } from './stub-api';

const NOW = () => 1_700_000_000_000;
const CLAUSE = 'WHEN the owner has left, THE SYSTEM SHALL let any member delete the project.';
const PROPERTY = 'For any project whose owner has left, at least one member can still delete it.';

const CURSE = {
  id: 'curse-2',
  type: 'permissions',
  story: 'The owner quits. Nobody may delete the project, ever.',
  loophole: 'Only the owner can delete',
  status: 'open',
};

function input(over: Partial<CheckVerdictInput> = {}): CheckVerdictInput {
  return {
    curse: CURSE,
    amendment: CLAUSE,
    kind: 'ears-clause',
    verdict: { closed: true, reason: 'A member can delete it.', property: PROPERTY },
    ...over,
  };
}

function problems(over: Partial<CheckVerdictInput> = {}): string[] {
  const result = checkVerdict(input(over), NOW);
  if (result.ok) throw new Error('expected problems');
  return result.problems;
}

describe('checkVerdict: good input', () => {
  it('closed: injects curseId and judgedAt, builds the binding with proposeBinding', () => {
    const before = Date.now();
    const result = checkVerdict(input(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdict).toEqual({
      curseId: 'curse-2',
      closed: true,
      reason: 'A member can delete it.',
      property: PROPERTY,
      judgedAt: 1_700_000_000_000,
    });
    expect(result.binding).toMatchObject({ curseId: 'curse-2', kind: 'ears-clause', clause: CLAUSE });
    expect(typeof result.binding.proposedAt).toBe('number');
    expect(result.binding.proposedAt).toBeGreaterThanOrEqual(before);
  });

  it('open: a verdict with no property passes', () => {
    const result = checkVerdict(input({ verdict: { closed: false, reason: 'Still names no successor.' } }), NOW);
    expect(result.ok && result.verdict).toEqual({
      curseId: 'curse-2',
      closed: false,
      reason: 'Still names no successor.',
      judgedAt: 1_700_000_000_000,
    });
  });

  it('property is dropped when closed is false, and nothing from the agent can set curseId or judgedAt', () => {
    const result = checkVerdict(
      input({ verdict: { closed: false, reason: 'No.', property: PROPERTY, curseId: 'evil', judgedAt: 1 } }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('property' in result.verdict).toBe(false);
    expect(result.verdict.curseId).toBe('curse-2');
    expect(result.verdict.judgedAt).toBe(1_700_000_000_000);
  });

  it('the curse id defaults to curse-0 and the status to open', () => {
    const { id: _id, status: _status, ...rest } = CURSE;
    const result = checkVerdict(input({ curse: rest }), NOW);
    expect(result.ok && result.verdict.curseId).toBe('curse-0');
    expect(result.ok && result.binding.curseId).toBe('curse-0');
  });

  it('accepts the JSON-string forms of curse and verdict', () => {
    const result = checkVerdict(
      input({
        curse: JSON.stringify(CURSE),
        verdict: JSON.stringify({ closed: true, reason: 'Fine.', property: PROPERTY }),
      }),
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  it('a rewrite needs no EARS keyword', () => {
    const result = checkVerdict(input({ kind: 'rewrite', amendment: 'Any member may delete a project.' }), NOW);
    expect(result.ok && result.binding.kind).toBe('rewrite');
  });

  it('trims the amendment, the reason and the property', () => {
    const result = checkVerdict(
      input({ amendment: `  ${CLAUSE}  `, verdict: { closed: true, reason: '  Fine.  ', property: `  ${PROPERTY} ` } }),
      NOW,
    );
    expect(result.ok && [result.binding.clause, result.verdict.reason, result.verdict.property]).toEqual([
      CLAUSE,
      'Fine.',
      PROPERTY,
    ]);
  });

  it('a property of exactly 40 words passes, 41 does not', () => {
    const words = (n: number) => `For any ${Array.from({ length: n - 2 }, (_, i) => `w${i}`).join(' ')}`;
    expect(checkVerdict(input({ verdict: { closed: true, reason: 'ok', property: words(40) } }), NOW).ok).toBe(true);
    expect(problems({ verdict: { closed: true, reason: 'ok', property: words(41) } })).toEqual([
      'verdict.property must be at most 40 words (got 41).',
    ]);
  });
});

describe('checkVerdict: bad input', () => {
  it('an ears-clause that fails isEarsCriterion: the error names the keywords', () => {
    const [line] = problems({ amendment: 'Let any member delete the project.' });
    expect(line).toContain('amendment is not an EARS clause.');
    for (const keyword of ['WHEN', 'IF', 'WHILE', 'WHERE', 'THE SYSTEM SHALL', 'SHALL']) expect(line).toContain(keyword);
    expect(problems({ amendment: 'WHEN the owner leaves, the system keeps a member.' })).toHaveLength(1);
  });

  it('closed missing or not boolean', () => {
    expect(problems({ verdict: { reason: 'x' } })).toEqual(['verdict.closed must be true or false.']);
    expect(problems({ verdict: { closed: 'true', reason: 'x', property: PROPERTY } })).toEqual([
      'verdict.closed must be true or false.',
    ]);
  });

  it('an empty or missing reason', () => {
    expect(problems({ verdict: { closed: false, reason: '   ' } })).toEqual(['verdict.reason must not be empty.']);
    expect(problems({ verdict: { closed: false } })).toEqual(['verdict.reason must not be empty.']);
    expect(problems({ verdict: { closed: false, reason: 4 } })).toEqual(['verdict.reason must be a string.']);
  });

  it('closed: true with no property, one that does not start with "For any"', () => {
    expect(problems({ verdict: { closed: true, reason: 'ok' } })).toEqual([
      'verdict.property is required when closed is true.',
    ]);
    expect(problems({ verdict: { closed: true, reason: 'ok', property: '  ' } })).toEqual([
      'verdict.property is required when closed is true.',
    ]);
    expect(problems({ verdict: { closed: true, reason: 'ok', property: 'Every project can be deleted.' } })).toEqual([
      'verdict.property must start with "For any".',
    ]);
    expect(problems({ verdict: { closed: true, reason: 'ok', property: 3 } })).toEqual([
      'verdict.property must be a string.',
    ]);
  });

  it('a bad curse names its path', () => {
    expect(problems({ curse: { ...CURSE, type: 'bugs' } })).toEqual([
      'curse.type must be one of: permissions, time, money, scale, abuse, privacy, accessibility, data-loss, concurrency, edge-input.',
    ]);
    expect(problems({ curse: { ...CURSE, story: 'x'.repeat(361) } })).toEqual([
      'curse.story must be at most 360 characters.',
    ]);
    expect(problems({ curse: { type: 'time' } })).toEqual(['curse.story is required.', 'curse.loophole is required.']);
  });

  it('a curse or a verdict that is not an object', () => {
    expect(problems({ curse: 'nope' })).toEqual(['curse must be an object, or a JSON string of an object.']);
    expect(problems({ curse: '[1]' })).toEqual(['curse must be an object, or a JSON string of an object.']);
    expect(problems({ verdict: 'nope' })).toEqual(['verdict must be an object, or a JSON string of an object.']);
  });

  it('reports every problem at once, one per line', () => {
    expect(problems({ curse: { ...CURSE, type: 'bugs' }, amendment: 'nothing', verdict: { closed: 'x' } })).toHaveLength(4);
  });
});

describe('paw_check_verdict over MCP', () => {
  let connected: Connected | undefined;
  afterEach(async () => {
    await connected?.close();
    connected = undefined;
  });

  async function call(args: Record<string, unknown>, now = NOW) {
    connected ??= await connectPaw({ mode: 'local', now });
    return connected.client.callTool({ name: 'paw_check_verdict', arguments: args });
  }

  it('CLOSED: text form, structuredContent, injected clock', async () => {
    const result = await call({ curse: CURSE, amendment: CLAUSE, verdict: { closed: true, reason: 'A member can delete it.', property: PROPERTY } });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe(`CLOSED: A member can delete it.\nProperty: ${PROPERTY}`);
    expect(textOf(result)).not.toContain('Still open');
    const s = result.structuredContent as { verdict: { judgedAt: number; curseId: string }; binding: { clause: string; kind: string } };
    expect(s.verdict.judgedAt).toBe(1_700_000_000_000);
    expect(s.verdict.curseId).toBe('curse-2');
    expect(s.binding).toMatchObject({ clause: CLAUSE, kind: 'ears-clause' });
  });

  it('OPEN: not an error, says the loophole remains and names the check tool', async () => {
    const result = await call({
      curse: JSON.stringify(CURSE),
      amendment: CLAUSE,
      verdict: JSON.stringify({ closed: false, reason: 'It names no successor' }),
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe(
      'OPEN: It names no successor. The loophole remains. Rewrite the amendment, judge it again, and call paw_check_verdict again.',
    );
  });

  it('kind defaults to ears-clause', async () => {
    const result = await call({ curse: CURSE, amendment: 'Any member may delete.', verdict: { closed: false, reason: 'No.' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('amendment is not an EARS clause.');
  });

  it('failure: isError, the heading, one problem per line', async () => {
    const result = await call({ curse: CURSE, amendment: CLAUSE, verdict: { closed: true, reason: 'ok' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('The verdict does not pass yet:\nverdict.property is required when closed is true.');
    expect(result.structuredContent).toBeUndefined();
  });

  it('an amendment of 501 characters is an input error', async () => {
    const result = await call({ curse: CURSE, amendment: 'a'.repeat(501), kind: 'rewrite', verdict: { closed: false, reason: 'x' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('amendment must be at most 500 characters');
  });

  it('stores nothing: the same call twice gives the same answer', async () => {
    const args = { curse: CURSE, amendment: CLAUSE, verdict: { closed: false, reason: 'No.' } };
    expect(textOf(await call(args))).toBe(textOf(await call(args)));
  });
});
