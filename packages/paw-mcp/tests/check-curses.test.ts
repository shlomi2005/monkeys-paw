import { afterEach, describe, expect, it } from 'vitest';
import { checkCurses } from '../src/check-curses';
import { connectPaw, textOf, type Connected } from './stub-api';

const REQUIREMENT = 'Only the owner can delete a project.';

function curse(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'permissions', story: 'The owner quits. Nobody may delete the project, ever.', loophole: 'Only the owner can delete', ...over };
}

function three(): Record<string, unknown>[] {
  return [
    curse(),
    curse({ type: 'time', story: 'The owner is on leave until spring.', loophole: 'the owner can delete a project' }),
    curse({ type: 'abuse', story: 'A hostile owner deletes every project at once.', loophole: 'owner can delete' }),
  ];
}

function problems(requirement: string, curses: unknown): string[] {
  const result = checkCurses(requirement, curses);
  if (result.ok) throw new Error('expected problems');
  return result.problems;
}

describe('checkCurses: good input', () => {
  it('assigns ids curse-0.., status open, and trims the strings', () => {
    const result = checkCurses(REQUIREMENT, [
      curse({ story: '  Padded story about the owner.  ', loophole: '  owner can delete ' }),
      curse({ type: 'time' }),
      curse({ type: 'money' }),
      curse({ type: 'scale' }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.curses.map((c) => c.id)).toEqual(['curse-0', 'curse-1', 'curse-2', 'curse-3']);
    expect(result.curses.every((c) => c.status === 'open')).toBe(true);
    expect(result.curses[0]).toEqual({
      id: 'curse-0',
      type: 'permissions',
      status: 'open',
      story: 'Padded story about the owner.',
      loophole: 'owner can delete',
    });
    expect(result.warnings).toEqual([]);
  });

  it('accepts 3 and 5 curses', () => {
    const types = ['permissions', 'time', 'money', 'scale', 'abuse'];
    for (const n of [3, 5]) {
      expect(checkCurses(REQUIREMENT, types.slice(0, n).map((type) => curse({ type }))).ok).toBe(true);
    }
  });

  it('accepts a JSON string of the array', () => {
    const result = checkCurses(REQUIREMENT, JSON.stringify(three()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.curses).toHaveLength(3);
  });

  it('ignores extra keys, so a client cannot choose an id or a status', () => {
    const items = three().map((c, i) => ({ ...c, id: `mine-${i}`, status: 'closed', binding: { x: 1 }, extra: true }));
    const result = checkCurses(REQUIREMENT, items);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.curses.map((c) => c.id)).toEqual(['curse-0', 'curse-1', 'curse-2']);
    expect(result.curses.every((c) => c.status === 'open')).toBe(true);
    expect(Object.keys(result.curses[0]!).sort()).toEqual(['id', 'loophole', 'status', 'story', 'type']);
  });

  it('accepts a story of exactly 360 characters and a loophole of exactly 1000', () => {
    const items = [
      curse({ story: 'x'.repeat(360), loophole: `owner ${'y'.repeat(994)}` }),
      curse({ type: 'time' }),
      curse({ type: 'money' }),
    ];
    expect(checkCurses(REQUIREMENT, items).ok).toBe(true);
  });
});

describe('checkCurses: each bad input gives its line with its path', () => {
  it('not an array, not JSON', () => {
    expect(problems(REQUIREMENT, 'nope')).toEqual(['curses must be an array, or a JSON string of an array.']);
    expect(problems(REQUIREMENT, { a: 1 })).toEqual(['curses must be an array, or a JSON string of an array.']);
    expect(problems(REQUIREMENT, '{"a":1}')).toEqual(['curses must be an array, or a JSON string of an array.']);
    expect(problems(REQUIREMENT, 7)).toEqual(['curses must be an array, or a JSON string of an array.']);
  });

  it('2 and 6 curses', () => {
    expect(problems(REQUIREMENT, three().slice(0, 2))).toEqual(['curses must have 3 to 5 items (got 2).']);
    expect(problems(REQUIREMENT, [...three(), curse({ type: 'money' }), curse({ type: 'scale' }), curse({ type: 'privacy' })])).toEqual([
      'curses must have 3 to 5 items (got 6).',
    ]);
    expect(problems(REQUIREMENT, [])).toEqual(['curses must have 3 to 5 items (got 0).']);
  });

  it('a non-object item', () => {
    const items = three();
    items[1] = 'text' as unknown as Record<string, unknown>;
    expect(problems(REQUIREMENT, items)).toEqual(['curses[1] must be an object.']);
    items[1] = null as unknown as Record<string, unknown>;
    expect(problems(REQUIREMENT, items)).toEqual(['curses[1] must be an object.']);
    items[1] = [] as unknown as Record<string, unknown>;
    expect(problems(REQUIREMENT, items)).toEqual(['curses[1] must be an object.']);
  });

  it('a bad or missing type lists the ten tags', () => {
    const tags =
      'permissions, time, money, scale, abuse, privacy, accessibility, data-loss, concurrency, edge-input';
    const items = three();
    items[2] = curse({ type: 'bugs' });
    expect(problems(REQUIREMENT, items)).toEqual([`curses[2].type must be one of: ${tags}.`]);
    items[2] = { story: 'S', loophole: 'owner' };
    expect(problems(REQUIREMENT, items)).toEqual([`curses[2].type must be one of: ${tags}.`]);
  });

  it('an empty or missing story or loophole', () => {
    for (const field of ['story', 'loophole'] as const) {
      for (const bad of ['', '   ', undefined, null]) {
        const items = three();
        items[0] = curse({ [field]: bad });
        expect(problems(REQUIREMENT, items)).toEqual([`curses[0].${field} must not be empty.`]);
      }
    }
  });

  it('a story or loophole that is not a string', () => {
    const items = three();
    items[0] = curse({ story: 5 });
    expect(problems(REQUIREMENT, items)).toEqual(['curses[0].story must be a string.']);
  });

  it('story of 361 characters, loophole of 1001', () => {
    const items = three();
    items[1] = curse({ type: 'time', story: 'x'.repeat(361) });
    expect(problems(REQUIREMENT, items)).toEqual(['curses[1].story must be at most 360 characters (got 361).']);
    items[1] = curse({ type: 'time', loophole: 'y'.repeat(1001) });
    expect(problems(REQUIREMENT, items)).toEqual(['curses[1].loophole must be at most 1000 characters (got 1001).']);
  });

  it('a repeated type', () => {
    const items = three();
    items[2] = curse({ type: 'permissions' });
    expect(problems(REQUIREMENT, items)).toEqual([
      'curses[2].type repeats "permissions" (curses[0] has it); every curse needs its own type.',
    ]);
  });

  it('reports every problem at once, in item order, repeats last', () => {
    const items = [
      curse({ story: '' }),
      curse({ type: 'bugs' }),
      curse({ type: 'permissions', loophole: '' }),
      'x',
    ];
    expect(problems(REQUIREMENT, items)).toEqual([
      'curses[0].story must not be empty.',
      'curses[1].type must be one of: permissions, time, money, scale, abuse, privacy, accessibility, data-loss, concurrency, edge-input.',
      'curses[2].loophole must not be empty.',
      'curses[3] must be an object.',
      'curses[2].type repeats "permissions" (curses[0] has it); every curse needs its own type.',
    ]);
  });

  it('cuts 11 problems to 10: the 11th is dropped', () => {
    const types = ['bugs', 'time', 'money', 'scale', 'abuse'];
    const items = types.map((type) => curse({ type, story: '', loophole: '' }));
    // 1 bad type + 5 empty stories + 5 empty loopholes = 11 problems.
    const all = problems(REQUIREMENT, items);
    expect(all).toHaveLength(10);
    expect(all[0]).toContain('curses[0].type must be one of');
    expect(all.at(-1)).toBe('curses[4].story must not be empty.');
    expect(all).not.toContain('curses[4].loophole must not be empty.');
  });
});

describe('checkCurses: warnings', () => {
  it('warns when a loophole shares no word of 4 letters with the requirement', () => {
    const items = three();
    items[1] = curse({ type: 'time', loophole: 'something else entirely' });
    const result = checkCurses(REQUIREMENT, items);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual(['curse-1: the loophole does not quote the requirement; point to its exact words.']);
  });

  it('compares case-insensitively', () => {
    const result = checkCurses(REQUIREMENT, three().map((c) => ({ ...c, loophole: 'OWNER' })));
    expect(result.ok && result.warnings).toEqual([]);
  });

  it('words under 4 letters do not count', () => {
    const result = checkCurses('Only the ox can do it.', [
      curse({ loophole: 'the ox can do it' }),
      curse({ type: 'time', loophole: 'the ox can do it' }),
      curse({ type: 'money', loophole: 'the ox can do it' }),
    ]);
    expect(result.ok && result.warnings).toHaveLength(3);
  });

  it('letters are Unicode letters', () => {
    const result = checkCurses('Der Kunde bezahlt für die Bestellung.', [
      curse({ loophole: 'Bestellung' }),
      curse({ type: 'time', loophole: 'bezahlt für' }),
      curse({ type: 'money', loophole: 'KUNDE' }),
    ]);
    expect(result.ok && result.warnings).toEqual([]);
  });
});

describe('paw_check_curses over MCP', () => {
  let connected: Connected | undefined;
  afterEach(async () => {
    await connected?.close();
    connected = undefined;
  });

  async function call(args: Record<string, unknown>) {
    connected ??= await connectPaw({ mode: 'local' });
    return connected.client.callTool({ name: 'paw_check_curses', arguments: args });
  }

  it('success: text and structuredContent agree', async () => {
    const result = await call({ requirement: `  ${REQUIREMENT}  `, curses: three() });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { curses: { id: string; type: string; story: string; loophole: string }[]; warnings: string[] };
    expect(structured.curses.map((c) => c.id)).toEqual(['curse-0', 'curse-1', 'curse-2']);
    const text = textOf(result);
    expect(text.startsWith('The curses pass. 3 loopholes:')).toBe(true);
    for (const c of structured.curses) {
      expect(text).toContain(`[${c.id}] ${c.type}: ${c.story}`);
      expect(text).toContain(`  Loophole: ${c.loophole}`);
    }
    expect(structured.warnings).toEqual([]);
  });

  it('success with a JSON string and a warning: the warning is in the text and in structuredContent, not an error', async () => {
    const items = three();
    items[2] = curse({ type: 'abuse', loophole: 'zzzz' });
    const result = await call({ requirement: REQUIREMENT, curses: JSON.stringify(items) });
    expect(result.isError).toBeFalsy();
    const line = 'curse-2: the loophole does not quote the requirement; point to its exact words.';
    expect((result.structuredContent as { warnings: string[] }).warnings).toEqual([line]);
    expect(textOf(result)).toContain(line);
  });

  it('failure: isError, the heading, one problem per line, no structuredContent', async () => {
    const result = await call({ requirement: REQUIREMENT, curses: three().slice(0, 2) });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('The curses do not pass yet:\ncurses must have 3 to 5 items (got 2).');
    expect(result.structuredContent).toBeUndefined();
  });

  it('failure with several problems: every one is on its own line, at most 10', async () => {
    const items = ['bugs', 'time', 'money', 'scale', 'abuse'].map((type) => curse({ type, story: '', loophole: '' }));
    const result = await call({ requirement: REQUIREMENT, curses: items });
    const lines = textOf(result).split('\n');
    expect(lines[0]).toBe('The curses do not pass yet:');
    expect(lines).toHaveLength(11);
  });

  it('a requirement of 0 or 501 characters is an input error', async () => {
    for (const requirement of ['', 'x'.repeat(501)]) {
      const result = await call({ requirement, curses: three() });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('requirement must');
    }
  });

  it('a client that sends id and status cannot choose them', async () => {
    const items = three().map((c) => ({ ...c, id: 'x', status: 'closed' }));
    const result = await call({ requirement: REQUIREMENT, curses: items });
    const structured = result.structuredContent as { curses: { id: string; status: string }[] };
    expect(structured.curses.map((c) => [c.id, c.status])).toEqual([
      ['curse-0', 'open'],
      ['curse-1', 'open'],
      ['curse-2', 'open'],
    ]);
  });
});
