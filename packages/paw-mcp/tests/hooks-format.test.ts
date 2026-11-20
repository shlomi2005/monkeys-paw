import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOOKS = join(ROOT, '.kiro', 'hooks');

interface Hook {
  name: string;
  description: string;
  trigger: string;
  matcher: string;
  action: { type: string; prompt?: string; command?: string };
  timeout?: number;
}
const load = (file: string): { text: string; json: { version: string; hooks: Hook[] } } => {
  const text = readFileSync(join(HOOKS, file), 'utf8');
  return { text, json: JSON.parse(text) };
};

const EXAMPLES: Record<string, { accept: string[]; reject: string[] }> = {
  'paw-reviews-requirements': {
    accept: ['.kiro/specs/paw-power/requirements.md', '/work/repo/.kiro/specs/x/requirements.md'],
    reject: [
      '.kiro/specs/x/design.md',
      '.kiro/specs/requirements.md',
      'docs/requirements.md',
      '.kiro/specs/x/requirements.md.bak',
    ],
  },
  'golden-wish-eval': {
    accept: [
      'packages/paw-core/src/prompts.ts',
      '/work/repo/packages/paw-core/src/prompts.ts',
      '.kiro/steering/curse-taxonomy.md',
      '/work/repo/.kiro/steering/curse-taxonomy.md',
      'powers/monkeys-paw/skills/curse-taxonomy/SKILL.md',
      '/work/repo/powers/monkeys-paw/skills/curse-taxonomy/SKILL.md',
    ],
    reject: [
      'packages/paw-core/src/prompts.test.ts',
      'packages/paw-core/src/grant.ts',
      '.kiro/steering/tone.md',
      'xpackages/paw-core/src/prompts.ts',
      'powers/monkeys-paw/skills/curse-a-spec/SKILL.md',
    ],
  },
  'ui-screenshot-receipt': {
    accept: [
      'apps/web/src/App.tsx',
      '/work/repo/apps/web/src/components/CurseCard.tsx',
      'apps/web/src/styles/paw.css',
      '/work/repo/apps/web/src/deep/er/Thing.module.css',
    ],
    reject: ['apps/web/src/main.ts', 'apps/api/src/x.tsx', 'apps/web/public/x.css', 'apps/web/src/App.tsx.bak', 'apps/web/App.tsx'],
  },
};

const files = readdirSync(HOOKS).filter((f) => f.endsWith('.json')).sort();

describe('.kiro/hooks', () => {
  it('holds exactly the three hooks, and no old .kiro.hook files', () => {
    expect(files).toEqual(['golden-wish-eval.json', 'paw-reviews-requirements.json', 'ui-screenshot-receipt.json']);
    expect(readdirSync(HOOKS).filter((f) => f.endsWith('.kiro.hook'))).toEqual([]);
  });

  for (const file of files) {
    describe(file, () => {
      const { text, json } = load(file);
      const hook = json.hooks[0]!;

      it('is v1 with one hook named like the file, pretty-printed with a trailing newline', () => {
        expect(json.version).toBe('v1');
        expect(Object.keys(json).sort()).toEqual(['hooks', 'version']);
        expect(json.hooks).toHaveLength(1);
        expect(hook.name).toBe(file.replace(/\.json$/, ''));
        expect(hook.description.length).toBeGreaterThan(20);
        expect(text).toBe(`${JSON.stringify(json, null, 2)}\n`);
      });

      it('has a PascalCase trigger and none of the old .kiro.hook fields', () => {
        expect(hook.trigger).toMatch(/^[A-Z][A-Za-z]+$/);
        expect(hook.trigger).toBe('PostFileSave');
        expect(hook).not.toHaveProperty('when');
        expect(hook).not.toHaveProperty('then');
      });

      it('has a matcher that compiles, accepts its examples and rejects other paths', () => {
        const matcher = new RegExp(hook.matcher);
        expect(hook.matcher.startsWith('(^|/)')).toBe(true);
        expect(hook.matcher).not.toMatch(/\(\?[=!<]/);
        const examples = EXAMPLES[hook.name]!;
        for (const path of examples.accept) expect(matcher.test(path), `accept ${path}`).toBe(true);
        for (const path of examples.reject) expect(matcher.test(path), `reject ${path}`).toBe(false);
      });

      it('has an action of the right shape', () => {
        if (hook.action.type === 'agent') {
          expect(Object.keys(hook.action).sort()).toEqual(['prompt', 'type']);
          expect(hook.action.prompt!.length).toBeGreaterThan(50);
        } else {
          expect(hook.action.type).toBe('command');
          expect(Object.keys(hook.action).sort()).toEqual(['command', 'type']);
          expect(hook.timeout).toBeTypeOf('number');
        }
      });
    });
  }

  it('paw-reviews-requirements runs in local mode: limits 3, 1 and 6, one retry, no file changes, a missing tool stops it', () => {
    const hook = load('paw-reviews-requirements.json').json.hooks[0]!;
    const prompt = hook.action.prompt!;
    expect(hook.action.type).toBe('agent');
    expect(prompt).toContain('the tool paw_rules once, with kind "curse"');
    expect(prompt).toContain('the tool paw_check_curses');
    expect(prompt).toContain('at most 3 requirements');
    expect(prompt).toContain('condensed to at most 500 characters');
    expect(prompt).toContain('call paw_check_curses once more');
    expect(prompt).toContain('If it fails again, skip that requirement and say so in one line');
    expect(prompt).toContain('Never edit, create or delete any file');
    expect(prompt).toContain('If the paw tools are missing, say so in one line and stop');
    expect(prompt).not.toContain('paw_curse');
    expect(prompt).not.toContain('paw_bind');
    expect(prompt).not.toContain('PAW_API_URL');
    // 1 paw_rules call, and 3 requirements x (1 check + 1 retry) = 6 paw_check_curses calls at most.
    expect(prompt.match(/paw_rules/g)).toHaveLength(1);
    expect(hook.timeout).toBeUndefined();
  });

  it('paw-reviews-requirements description says your own Kiro agent and no server of ours, and never mentions API calls', () => {
    const { description } = load('paw-reviews-requirements.json').json.hooks[0]!;
    expect(description).toContain('Runs on your own Kiro agent');
    expect(description).toContain('one agent loop per save, on your credits');
    expect(description).toContain('Sends nothing to any server of ours');
    expect(description).not.toMatch(/API call|Paw API/i);
  });

  it('paw-reviews-requirements is byte-identical to the power reference copy', () => {
    const reference = readFileSync(
      join(ROOT, 'powers', 'monkeys-paw', 'skills', 'spec-loophole-hook', 'references', 'paw-reviews-requirements.json'),
    );
    expect(readFileSync(join(HOOKS, 'paw-reviews-requirements.json')).equals(reference)).toBe(true);
  });

  it('golden-wish-eval runs the script with a 900 s timeout and mentions the cost', () => {
    const hook = load('golden-wish-eval.json').json.hooks[0]!;
    expect(hook.action).toEqual({ type: 'command', command: 'node scripts/golden-wish-eval.mjs' });
    expect(hook.timeout).toBe(900);
    expect(hook.description).toContain('about 25 model calls');
  });

  it('ui-screenshot-receipt quotes the file path and has a 300 s timeout', () => {
    const hook = load('ui-screenshot-receipt.json').json.hooks[0]!;
    expect(hook.action).toEqual({ type: 'command', command: 'node scripts/ui-screenshot-receipt.mjs "{{filePath}}"' });
    expect(hook.timeout).toBe(300);
  });
});
