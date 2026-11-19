import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const dockerfile = readFileSync(path.join(REPO_ROOT, 'apps', 'api', 'Dockerfile'), 'utf8');
const dockerignore = readFileSync(path.join(REPO_ROOT, '.dockerignore'), 'utf8');

/** Dockerfile instructions without comments and blank lines, with line continuations joined. */
const instructions = dockerfile
  .replace(/\\\r?\n/g, ' ')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
const ignoreLines = dockerignore
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

describe('apps/api/Dockerfile', () => {
  it('uses Node 24 for the build and the runtime stage', () => {
    const from = instructions.filter((line) => /^FROM\s/.test(line));
    expect(from).toHaveLength(2);
    for (const line of from) expect(line).toMatch(/^FROM node:24-slim\b/);
  });

  it('installs with a frozen lockfile, filtered to the api', () => {
    expect(dockerfile).toMatch(/pnpm install --frozen-lockfile --filter @monkeyspaw\/api\.\.\./);
  });

  it('builds with the package script', () => {
    expect(dockerfile).toMatch(/pnpm -C apps\/api build/);
  });

  it('starts the bundle, as the node user, on port 8787', () => {
    expect(instructions).toContain('CMD ["node", "dist/server.mjs"]');
    expect(instructions).toContain('USER node');
    expect(instructions).toContain('EXPOSE 8787');
    expect(instructions).toContain('ENV NODE_ENV=production');
  });

  it('copies only the bundle and the examples cache into the runtime stage', () => {
    const copies = instructions.filter((line) => line.startsWith('COPY --from=build'));
    expect(copies).toHaveLength(2);
    expect(copies[0]).toContain('/repo/apps/api/dist/server.mjs dist/server.mjs');
    expect(copies[1]).toContain('/repo/apps/api/examples-cache.json examples-cache.json');
  });

  it('carries no key, no ARG and no .env', () => {
    expect(dockerfile).not.toMatch(/GEMINI/i);
    expect(dockerfile).not.toMatch(/API_KEY|SECRET|TOKEN/i);
    expect(instructions.filter((line) => /^ARG\s/.test(line))).toEqual([]);
    expect(instructions.filter((line) => /^ENV\s/.test(line))).toEqual(['ENV NODE_ENV=production']);
    expect(instructions.join('\n')).not.toMatch(/\.env\b/);
  });
});

describe('.dockerignore', () => {
  it('keeps dependencies, build output and VCS data out of the context', () => {
    for (const entry of ['node_modules', '**/node_modules', 'dist', '**/dist', '.git', 'apps/web', 'coverage', 'test-results']) {
      expect(ignoreLines).toContain(entry);
    }
  });

  it('ignores .env and .env.*, but not .env.example', () => {
    expect(ignoreLines).toContain('.env');
    expect(ignoreLines).toContain('.env.*');
    expect(ignoreLines).toContain('!.env.example');
    expect(ignoreLines.indexOf('!.env.example')).toBeGreaterThan(ignoreLines.indexOf('.env.*'));
  });
});
