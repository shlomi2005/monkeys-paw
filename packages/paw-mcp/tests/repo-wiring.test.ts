import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

describe('.kiro/settings/mcp.json', () => {
  const text = read('.kiro', 'settings', 'mcp.json');
  const json = JSON.parse(text) as { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> };

  it('has one server, monkeys-paw, with the documented fields', () => {
    expect(json).toEqual({
      mcpServers: {
        'monkeys-paw': {
          command: 'node',
          args: ['powers/monkeys-paw/server/paw-mcp.mjs'],
          env: { PAW_API_URL: '${PAW_API_URL}' },
        },
      },
    });
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('points at a file that exists, and holds no key and no URL', () => {
    const server = json.mcpServers['monkeys-paw']!;
    expect(existsSync(join(ROOT, server.args[0]!))).toBe(true);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/api[_-]?key|secret|token|password/i);
  });
});

describe('.kiro/steering/tone.md', () => {
  const tone = read('.kiro', 'steering', 'tone.md');
  const lines = tone.split('\n');

  it('starts with the same front matter as the other steering files, with inclusion: always', () => {
    const tech = read('.kiro', 'steering', 'tech.md').split('\n');
    expect(lines.slice(0, 3)).toEqual(tech.slice(0, 3));
    expect(lines[0]).toBe('---');
    expect(lines[1]).toBe('inclusion: always');
  });

  it('is about 40 lines and covers the voice, short sentences and good and bad lines', () => {
    expect(lines.length).toBeGreaterThanOrEqual(35);
    expect(lines.length).toBeLessThanOrEqual(50);
    for (const part of ['dry comedy-horror', 'never gory', 'PG-13', 'No real people', 'witty, not cruel', 'Short sentences', '- Good:', 'Bad:']) {
      expect(tone.toLowerCase(), part).toContain(part.toLowerCase());
    }
    expect((tone.match(/^- Good:/gm) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('has the three lines from the design', () => {
    for (const line of [
      '"The owner quits. Nobody may delete the project, ever."',
      '"A catastrophic data governance failure occurs!!"',
      '"Granted. Exactly."',
      '"Great news, your wish was granted successfully!"',
      '"The paw remembers."',
      '"Your clause is wrong."',
    ]) {
      expect(tone, line).toContain(line);
    }
  });
});

describe('tech.md and structure.md', () => {
  const tech = read('.kiro', 'steering', 'tech.md');
  const structure = read('.kiro', 'steering', 'structure.md');

  it('no longer mention paw-power as a package, or paw.curse and paw.bind', () => {
    for (const text of [tech, structure]) {
      expect(text).not.toMatch(/packages\/paw-power/);
      expect(text).not.toMatch(/paw\.curse|paw\.bind/);
    }
  });

  it('name paw-mcp, the power, the tools, the SDK and the committed bundle', () => {
    for (const text of [tech, structure]) {
      for (const part of ['packages/paw-mcp', 'powers/monkeys-paw', 'paw_curse', 'paw_bind', '@modelcontextprotocol/sdk', 'server/paw-mcp.mjs']) {
        expect(text, part).toContain(part);
      }
    }
  });

  it('name the two modes and the three local tools, and no longer call paw-mcp only a thin client of apps/api', () => {
    for (const text of [tech, structure]) {
      for (const part of ['paw_rules', 'paw_check_curses', 'paw_check_verdict', 'Local (the default)', 'Remote (`PAW_API_URL` is a usable URL)']) {
        expect(text, part).toContain(part);
      }
      expect(text).not.toMatch(/A thin client of `apps\/api`/);
      expect(text).toMatch(/no longer only a thin client of `apps\/api`/i);
    }
  });

  it('structure.md lets paw-mcp import paw-core, the SDK, zod and Node, and never the apps', () => {
    expect(structure).toMatch(/- `packages\/paw-mcp` imports `paw-core`, `@modelcontextprotocol\/sdk`, `zod` and Node APIs\. Never imports from `apps\/web` or `apps\/api`\./);
  });
});

describe('added files hold no absolute local path and no secret-shaped string', () => {
  const ROOTS = [
    'packages/paw-mcp',
    'powers/monkeys-paw',
    '.kiro/agents',
    '.kiro/hooks',
    '.kiro/settings',
    '.kiro/specs/paw-power',
    '.kiro/steering/tone.md',
    'scripts',
  ];
  const SKIP_DIRS = new Set(['node_modules', 'dist']);

  function collect(path: string, out: string[] = []): string[] {
    const full = join(ROOT, path);
    if (statSync(full).isDirectory()) {
      for (const entry of readdirSync(full)) {
        if (!SKIP_DIRS.has(entry)) collect(join(path, entry), out);
      }
    } else {
      out.push(path);
    }
    return out;
  }
  const files = ROOTS.flatMap((p) => collect(p));

  const ABSOLUTE = /\/Users\/[A-Za-z]|\/home\/[a-z]|[A-Za-z]:\\Users\\|\/private\/var\/|\/var\/folders\//;
  const SECRETS = [/AIza[0-9A-Za-z_-]{35}/, /\bsk-[A-Za-z0-9]{20,}/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bAKIA[0-9A-Z]{16}\b/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

  it('scans a sensible number of files', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files).toContain('powers/monkeys-paw/server/paw-mcp.mjs');
    expect(files).toContain('.kiro/agents/qa.json');
  });

  it('finds no absolute local path', () => {
    const hits = files.filter((f) => ABSOLUTE.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(hits.map((f) => relative('.', f))).toEqual([]);
  });

  it('finds no secret-shaped string', () => {
    const hits = files.filter((f) => SECRETS.some((re) => re.test(readFileSync(join(ROOT, f), 'utf8'))));
    expect(hits).toEqual([]);
  });
});
