import { afterEach, describe, expect, it } from 'vitest';
import { BIND_FOOTER, CURSE_FOOTER, buildRules } from '../src/rules';
import { connectPaw, textOf, type Connected } from './stub-api';

let connected: Connected | undefined;

afterEach(async () => {
  await connected?.close();
  connected = undefined;
});

async function callRules(kind: unknown): Promise<{ text: string; isError?: boolean; structured?: Record<string, unknown> }> {
  connected ??= await connectPaw({ mode: 'local' });
  const result = await connected.client.callTool({ name: 'paw_rules', arguments: { kind } });
  return {
    text: textOf(result),
    isError: result.isError as boolean | undefined,
    structured: result.structuredContent as Record<string, unknown> | undefined,
  };
}

describe('paw_rules kind curse', () => {
  it('returns the rules text, the sections in prompt order, the JSON Schema and the footer', async () => {
    const r = await callRules('curse');
    expect(r.isError).toBeFalsy();
    const s = r.structured!;
    expect(s.kind).toBe('curse');
    expect((s.sections as { name: string }[]).map((x) => x.name)).toEqual([
      'role',
      'curse-rules',
      'taxonomy',
      'guardrails',
      'json-shape',
      'array-rule',
    ]);
    expect(s.next).toBe(CURSE_FOOTER);
    expect(r.text.startsWith('You are the Paw, an adversary')).toBe(true);
    expect(r.text).toContain('\n\nJSON Schema:\n{');
    expect(r.text.endsWith(CURSE_FOOTER)).toBe(true);
    expect(r.text).toContain(JSON.stringify(s.jsonSchema, null, 2));
  });

  it('the footer says: write them yourself, no ids, then call paw_check_curses', () => {
    expect(CURSE_FOOTER).toContain('Write the curses yourself');
    expect(CURSE_FOOTER).toContain('no ids');
    expect(CURSE_FOOTER).toContain('paw_check_curses');
  });
});

describe('paw_rules kind bind', () => {
  it('returns the Judge rules, the EARS line, the verdict JSON Schema and the footer', async () => {
    const r = await callRules('bind');
    expect(r.isError).toBeFalsy();
    const s = r.structured!;
    expect(s.kind).toBe('bind');
    expect((s.sections as { name: string }[]).map((x) => x.name)).toEqual([
      'role',
      'json-shape',
      'verdict-rules',
      'ears-format',
    ]);
    expect(s.next).toBe(BIND_FOOTER);
    expect(r.text.startsWith('You are the Judge.')).toBe(true);
    expect(r.text).toContain('WHEN, IF, WHILE, WHERE or THE SYSTEM SHALL');
    expect(r.text.endsWith(BIND_FOOTER)).toBe(true);
  });

  it('the footer says: judge yourself, strictly, then call paw_check_verdict', () => {
    expect(BIND_FOOTER).toContain('yourself, strictly');
    expect(BIND_FOOTER).toContain('paw_check_verdict');
  });
});

describe('paw_rules input and purity', () => {
  it.each(['wish', '', 5, null])('a bad kind (%s) is an error that names the field and the two values', async (kind) => {
    const r = await callRules(kind);
    expect(r.isError).toBe(true);
    expect(r.text).toContain('kind');
    expect(r.text).toMatch(/curse|bind/);
  });

  it('a missing kind is an error', async () => {
    connected = await connectPaw({ mode: 'local' });
    const result = await connected.client.callTool({ name: 'paw_rules', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('kind');
  });

  it('keeps no state: two calls give the same answer', () => {
    expect(buildRules('curse')).toEqual(buildRules('curse'));
    expect(buildRules('bind')).toEqual(buildRules('bind'));
  });

  it('the text is the sections, the schema and the footer, joined by blank lines', () => {
    for (const kind of ['curse', 'bind'] as const) {
      const rules = buildRules(kind);
      expect(rules.text).toBe(
        [...rules.sections.map((s) => s.text), `JSON Schema:\n${JSON.stringify(rules.jsonSchema, null, 2)}`, rules.next].join(
          '\n\n',
        ),
      );
    }
  });
});
