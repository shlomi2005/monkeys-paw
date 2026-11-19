import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = path.resolve(API_DIR, '..', '..');
const DIST_DIR = path.join(API_DIR, 'dist'); // gitignored
const SCRIPT = path.join(API_DIR, 'scripts', 'build-server.mjs');

describe('build-server.mjs', () => {
  const distExisted = existsSync(DIST_DIR);
  let outDir = '';
  let bundle = '';

  beforeAll(() => {
    // A scratch folder of our own inside dist/, so the real dist/server.mjs is never touched.
    outDir = mkdtempSync(path.join(path.dirname(DIST_DIR), 'dist-test-'));
    execFileSync(process.execPath, [SCRIPT, '--outfile', path.join(outDir, 'server.mjs')], {
      cwd: API_DIR,
      stdio: 'pipe',
    });
    bundle = readFileSync(path.join(outDir, 'server.mjs'), 'utf8');
  }, 60_000);

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
    if (!distExisted && existsSync(DIST_DIR) && readdirSync(DIST_DIR).length === 0) rmdirSync(DIST_DIR);
  });

  it('writes one file and nothing else', () => {
    expect(readdirSync(outDir)).toEqual(['server.mjs']);
  });

  it('does not read paw-core from its gitignored dist', () => {
    expect(bundle).not.toMatch(/paw-core\/dist/);
  });

  it('contains no absolute path of this machine', () => {
    expect(bundle).not.toContain(REPO_ROOT);
    expect(bundle).not.toContain(homedir());
    expect(bundle).not.toMatch(/\/Users\/|\/home\/[a-z]|[A-Z]:\\Users\\/);
  });

  it('bundles hono and paw-core, so no package import is left', () => {
    const imports = [...bundle.matchAll(/^import .* from ["']([^"']+)["']/gm)].map((m) => m[1]);
    const bare = imports.filter((s) => !s.startsWith('node:') && !s.startsWith('.'));
    // Only Node built-ins, which some dependencies write without the node: prefix.
    expect(bare.filter((s) => !builtinModules.includes(s))).toEqual([]);
  });

  it('start runs the bundle and loads no .env file', () => {
    const pkg = JSON.parse(readFileSync(path.join(API_DIR, 'package.json'), 'utf8'));
    expect(pkg.scripts.start).toBe('node dist/server.mjs');
    expect(pkg.scripts.build).toBe('node scripts/build-server.mjs');
    expect(pkg.scripts.start).not.toMatch(/env/);
  });
});
