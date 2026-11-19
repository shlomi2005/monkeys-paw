// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without type declarations
import { copyPawAssets } from './copy-paw-assets.mjs';

const SCRIPT = fileURLToPath(new URL('./copy-paw-assets.mjs', import.meta.url));

let root: string;
let src: string;
let dest: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'paw-assets-'));
  src = join(root, 'src');
  dest = join(root, 'dest', 'paw');
  await mkdir(src, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeSources(names: string[]) {
  for (const name of names) {
    await writeFile(join(src, name), Buffer.from(`fake bytes for ${name}`));
  }
}

describe('copy-paw-assets', () => {
  it('copies the expected files and extra .glb/.jpg files, skips .json and .md, byte for byte', async () => {
    await writeSources(['paw-web.glb', 'paw-mobile.glb', 'paw-poster.jpg', 'extra.jpg', 'runtime-controls.json', 'PAW-ASSET.md']);

    const result = await copyPawAssets({ src, dest });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    const copied = (await readdir(dest)).sort();
    expect(copied).toEqual(['extra.jpg', 'paw-mobile.glb', 'paw-poster.jpg', 'paw-web.glb']);
    for (const name of copied) {
      expect(Buffer.compare(await readFile(join(dest, name)), await readFile(join(src, name)))).toBe(0);
    }
  });

  it('exits non-zero from the CLI when an expected source file is missing', async () => {
    await writeSources(['paw-web.glb', 'paw-poster.jpg']);

    const run = spawnSync(process.execPath, [SCRIPT, '--src', src, '--dest', dest], { encoding: 'utf8' });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('paw-mobile.glb');
  });

  it('exits zero from the CLI when all expected files exist', async () => {
    await writeSources(['paw-web.glb', 'paw-mobile.glb', 'paw-poster.jpg']);

    const run = spawnSync(process.execPath, [SCRIPT, '--src', src, '--dest', dest], { encoding: 'utf8' });

    expect(run.status).toBe(0);
    expect(run.stdout.trim().split('\n')).toHaveLength(3);
  });

  it('reports failure when a copy differs from its source', async () => {
    await writeSources(['paw-web.glb', 'paw-mobile.glb', 'paw-poster.jpg']);
    const corruptingCopy = async (_from: string, to: string) => {
      await writeFile(to, Buffer.from('different bytes'));
    };

    const result = await copyPawAssets({ src, dest, copyFile: corruptingCopy });

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0]).toContain('copy differs');
  });

  it('detects a same-length corruption through the SHA-256 check', async () => {
    await writeSources(['paw-web.glb', 'paw-mobile.glb', 'paw-poster.jpg']);
    const corruptingCopy = async (from: string, to: string) => {
      const bytes = await readFile(from);
      bytes[0] = bytes[0] ^ 0xff;
      await writeFile(to, bytes);
    };

    const result = await copyPawAssets({ src, dest, copyFile: corruptingCopy });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('SHA-256');
  });
});
