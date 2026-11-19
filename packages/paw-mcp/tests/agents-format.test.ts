import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const AGENTS = join(ROOT, '.kiro', 'agents');
const NAMES = ['genie', 'judge', 'legal', 'paw', 'qa'];

interface Rule {
  capability: string;
  match: string[];
  effect: string;
}
interface Agent {
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  includeMcpJson: boolean;
  resources: string[];
  permissions: { rules: Rule[] };
  welcomeMessage?: string;
}
const text = (name: string): string => readFileSync(join(AGENTS, `${name}.json`), 'utf8');
const load = (name: string): Agent => JSON.parse(text(name)) as Agent;

const EXPECTED: Record<string, { tools: string[]; mcp: boolean; resources: string[] }> = {
  paw: { tools: ['read', '@monkeys-paw/paw_curse'], mcp: true, resources: ['curse-taxonomy.md', 'tone.md', 'product.md'] },
  genie: { tools: ['read'], mcp: false, resources: ['tone.md', 'product.md'] },
  judge: { tools: ['read', '@monkeys-paw/paw_bind'], mcp: true, resources: ['curse-taxonomy.md', 'tone.md', 'iron-rules.md'] },
  qa: { tools: ['read', 'shell'], mcp: false, resources: ['tech.md', 'structure.md', 'iron-rules.md'] },
  legal: { tools: ['read'], mcp: false, resources: ['iron-rules.md', 'product.md', 'tone.md'] },
};

describe('.kiro/agents', () => {
  it('holds the five JSON agents and no Markdown file', () => {
    expect(readdirSync(AGENTS).sort()).toEqual(NAMES.map((n) => `${n}.json`));
  });

  for (const name of NAMES) {
    describe(name, () => {
      const agent = load(name);

      it('has exactly the documented fields, and none of the legacy ones', () => {
        expect(Object.keys(agent).sort()).toEqual(
          ['description', 'includeMcpJson', 'name', 'permissions', 'prompt', 'resources', 'tools', 'welcomeMessage'],
        );
        for (const legacy of ['allowedTools', 'toolsSettings', 'toolAliases', 'hooks', 'model']) {
          expect(agent, legacy).not.toHaveProperty(legacy);
        }
        expect(agent.name).toBe(name);
        expect(agent.description.length).toBeGreaterThan(10);
        expect(text(name)).toBe(`${JSON.stringify(agent, null, 2)}\n`);
      });

      it('has the right tools, includeMcpJson and resources, and the resources exist', () => {
        const expected = EXPECTED[name]!;
        expect(agent.tools).toEqual(expected.tools);
        expect(agent.includeMcpJson).toBe(expected.mcp);
        expect(agent.resources).toEqual(expected.resources.map((f) => `file://.kiro/steering/${f}`));
        for (const resource of agent.resources) {
          expect(resource.startsWith('file://.kiro/steering/')).toBe(true);
          expect(existsSync(join(ROOT, resource.slice('file://'.length))), resource).toBe(true);
        }
      });

      it('is read-only: no write tool and a deny on fs_write for **', () => {
        expect(agent.tools).not.toContain('write');
        expect(agent.permissions.rules).toContainEqual({ capability: 'fs_write', match: ['**'], effect: 'deny' });
        for (const rule of agent.permissions.rules) {
          expect(['allow', 'deny']).toContain(rule.effect);
          expect(rule.match.length).toBeGreaterThan(0);
        }
      });

      it('has an inline prompt of 5 to 12 lines that states its limits first and is plain text', () => {
        const lines = agent.prompt.split('\n');
        expect(lines.length).toBeGreaterThanOrEqual(5);
        expect(lines.length).toBeLessThanOrEqual(12);
        expect(lines[0]).toMatch(/^You are /);
        expect(lines[0]).toMatch(/never|only/i);
        expect(lines.every((l) => l.trim() !== '')).toBe(true);
        expect(agent.prompt).not.toMatch(/[!]|[\u{1F300}-\u{1FAFF}]/u);
      });
    });
  }

  it('qa denies writes, git push, git commit, rm and redirects, and allows only the pnpm forms', () => {
    const rules = load('qa').permissions.rules;
    const shellDeny = rules.filter((r) => r.capability === 'shell' && r.effect === 'deny').flatMap((r) => r.match);
    expect(shellDeny).toEqual(['git push*', 'git commit*', 'rm *', '*>*']);
    const shellAllow = rules.filter((r) => r.capability === 'shell' && r.effect === 'allow').flatMap((r) => r.match);
    expect(shellAllow.length).toBeGreaterThan(0);
    for (const pattern of shellAllow) expect(pattern.startsWith('pnpm -C ') || pattern.startsWith('pnpm -r ')).toBe(true);
    expect(rules.find((r) => r.capability === 'fs_write')).toEqual({ capability: 'fs_write', match: ['**'], effect: 'deny' });
  });

  it('qa prompt says every package command is pnpm -C <package dir> ... and forbids writes and state-changing git', () => {
    const { prompt } = load('qa');
    expect(prompt).toContain('every package command as pnpm -C <package dir>');
    expect(prompt).toContain('pnpm -r test, pnpm -r typecheck and pnpm -r build');
    expect(prompt).toContain('never redirect output into a file');
    expect(prompt).toContain('Never run git commands that change state');
  });

  it('the veto agents end their prompt with both verdict lines named', () => {
    for (const name of ['qa', 'legal']) {
      const { prompt } = load(name);
      expect(prompt, name).toContain('VERDICT: PASS');
      expect(prompt, name).toContain('VERDICT: VETO');
      expect(prompt.split('\n').at(-1), name).toMatch(/exactly one last line: VERDICT: PASS or VERDICT: VETO/);
    }
  });

  it('paw, genie and judge follow tone.md; judge answers JSON only with both shapes; genie stays under 25 words', () => {
    for (const name of ['paw', 'genie', 'judge']) expect(load(name).prompt, name).toContain('tone.md');
    const judge = load('judge').prompt;
    expect(judge).toMatch(/one JSON object and nothing else/);
    expect(judge).toContain('"closed"');
    expect(judge).toContain('"reason"');
    expect(judge).toContain('"property"');
    expect(judge).toContain('"specific"');
    expect(load('genie').prompt).toContain('at most 25 words');
    expect(load('paw').prompt).toContain('paw_curse');
  });
});
