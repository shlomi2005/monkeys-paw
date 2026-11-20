import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PAW_MCP_VERSION } from '../src/version';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const POWER = join(ROOT, 'powers', 'monkeys-paw');
const read = (...parts: string[]): string => readFileSync(join(POWER, ...parts), 'utf8');
const readJson = (...parts: string[]): Record<string, unknown> => JSON.parse(read(...parts)) as Record<string, unknown>;

function frontMatter(text: string): { fields: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error('no front matter');
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const at = line.indexOf(':');
    fields[line.slice(0, at)] = line.slice(at + 1).trim();
  }
  return { fields, body: match[2]! };
}

describe('plugin.json', () => {
  const plugin = readJson('plugin.json');

  it('has exactly the documented fields', () => {
    expect(Object.keys(plugin).sort()).toEqual(
      ['$schema', 'author', 'description', 'keywords', 'license', 'name', 'version'].sort(),
    );
    expect(plugin.name).toBe('monkeys-paw');
    expect(plugin.license).toBe('MIT');
    expect(plugin.author).toEqual({ name: 'Shlomicom' });
    expect(plugin.keywords).toContain('EARS');
  });

  it('has the same version as the server, and it is 0.2.0', () => {
    expect(plugin.version).toBe(PAW_MCP_VERSION);
    expect(plugin.version).toBe('0.2.0');
  });

  it('has a one-sentence description: your own Kiro agent, your own model and credits, nothing sent to a server of ours', () => {
    const description = plugin.description as string;
    expect(description).toContain('your own Kiro agent');
    expect(description).toContain('your own model and credits');
    expect(description).toContain('sends nothing to any server of ours');
    expect(description.match(/[.!?](\s|$)/g)).toHaveLength(1);
    expect(plugin).not.toHaveProperty('homepage');
    expect(plugin).not.toHaveProperty('repository');
  });
});

describe('mcp.json', () => {
  it('has exactly the documented fields', () => {
    expect(readJson('mcp.json')).toEqual({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {
        paw: {
          type: 'stdio',
          command: 'node',
          args: ['${PLUGIN_ROOT}/server/paw-mcp.mjs'],
          env: { PAW_API_URL: '${PAW_API_URL}' },
        },
      },
    });
  });
});

describe('skills', () => {
  const names = ['curse-taxonomy', 'curse-a-spec', 'spec-loophole-hook'];

  it.each(names)('%s has front matter with name and description only', (name) => {
    const { fields, body } = frontMatter(read('skills', name, 'SKILL.md'));
    expect(Object.keys(fields)).toEqual(['name', 'description']);
    expect(fields.name).toBe(name);
    expect(fields.description!.length).toBeGreaterThan(20);
    expect(body.trim().length).toBeGreaterThan(0);
  });

  it('curse-taxonomy body equals the steering file body', () => {
    const steering = readFileSync(join(ROOT, '.kiro', 'steering', 'curse-taxonomy.md'), 'utf8');
    expect(frontMatter(read('skills', 'curse-taxonomy', 'SKILL.md')).body).toBe(frontMatter(steering).body);
  });

  it('curse-a-spec gives the local flow with the three local tools, in order, and says the Judge must be strict', () => {
    const skill = read('skills', 'curse-a-spec', 'SKILL.md');
    expect(skill).toMatch(/paw_rules`[^\n]*`curse`[\s\S]*paw_check_curses[\s\S]*paw_rules`[^\n]*`bind`[\s\S]*paw_check_verdict/);
    expect(skill).toContain('`CLOSED`');
    expect(skill).toContain('own agent judging your own clause, so be strict');
    expect(skill).toContain('No Paw API is needed');
    expect(skill).not.toMatch(/paw_curse|paw_bind/);
  });

  it('spec-loophole-hook copies the reference and says: one agent loop of your credits, no Paw API call, no PAW_API_URL', () => {
    const skill = read('skills', 'spec-loophole-hook', 'SKILL.md');
    expect(skill).toContain('references/paw-reviews-requirements.json');
    expect(skill).toContain('Do not overwrite it');
    expect(skill).toContain('one agent loop of their own credits');
    expect(skill).toContain('makes no Paw API call and needs no `PAW_API_URL`');
    expect(skill).toContain('only for saves made by the agent');
    expect(skill).not.toMatch(/up to 3|paw_curse/);
  });

  it('the hook reference is byte-identical to the hook file', () => {
    const reference = readFileSync(join(POWER, 'skills', 'spec-loophole-hook', 'references', 'paw-reviews-requirements.json'));
    const hook = readFileSync(join(ROOT, '.kiro', 'hooks', 'paw-reviews-requirements.json'));
    expect(reference.equals(hook)).toBe(true);
    expect(reference.toString('utf8').endsWith('}\n')).toBe(true);
  });
});

describe('README.md', () => {
  const readme = read('README.md');

  it('says up front: your own Kiro agent, your own model and credits, nothing sent to a server of ours, PAW_API_URL optional', () => {
    const top = readme.split('\n').slice(0, 12).join('\n').replace(/\s+/g, ' ');
    expect(top).toContain('runs on your own Kiro agent, with your own model and credits');
    expect(top).toContain('sends nothing to any server of ours');
    expect(top).toContain('`PAW_API_URL` is optional');
    expect(top).toContain('switches on remote mode, with `paw_curse` and `paw_bind` against a Paw API you run');
  });

  it('says how to install, names the three local tools and the two remote ones', () => {
    for (const phrase of ['Import power from a folder', 'paw_rules', 'paw_check_curses', 'paw_check_verdict', 'paw_curse', 'paw_bind']) {
      expect(readme, phrase).toContain(phrase);
    }
    expect(readme.split('\n').length).toBeLessThan(60);
  });

  it('keeps the fine print: strict local Judge, agent saves only, one agent loop per review, nothing on disk', () => {
    const text = readme.replace(/\s+/g, ' ');
    expect(text).toContain('the Judge is your own agent judging your own clause, so it must be strict');
    expect(text).toContain('File hooks fire only for saves made by the agent');
    expect(text).toContain('one agent loop of your credits');
    expect(text).toContain('writes nothing to disk');
  });

  it('has no placeholder URL, no API-call cost line and no old default-URL paragraph', () => {
    expect(readme).not.toContain('paw-api.invalid');
    expect(readme).not.toContain('Set the API address');
    expect(readme).not.toMatch(/up to 3 API calls|Cannot reach/);
  });

  it('holds no absolute local path', () => {
    expect(readme).not.toMatch(/\/(Users|home)\/|[A-Z]:\\/);
  });
});
