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

  it('has the same version as the server', () => {
    expect(plugin.version).toBe(PAW_MCP_VERSION);
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

  it('the two workflow skills name the tools they use', () => {
    expect(read('skills', 'curse-a-spec', 'SKILL.md')).toMatch(/paw_curse[\s\S]*paw_bind/);
    expect(read('skills', 'spec-loophole-hook', 'SKILL.md')).toContain('references/paw-reviews-requirements.json');
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

  it('says how to install, configure and what it costs', () => {
    for (const phrase of ['Import power from a folder', 'PAW_API_URL', 'paw_curse', 'paw_bind', 'up to 3 API calls']) {
      expect(readme, phrase).toContain(phrase);
    }
    expect(readme.split('\n').length).toBeLessThan(60);
  });

  it('holds no absolute local path', () => {
    expect(readme).not.toMatch(/\/(Users|home)\/|[A-Z]:\\/);
  });
});
