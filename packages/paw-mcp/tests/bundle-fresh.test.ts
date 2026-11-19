import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { BUNDLE_OUT, bundleOptions, listPackages, readLicenseText } from '../scripts/build-bundle.mjs';

const POWER_SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'powers', 'monkeys-paw', 'server');

describe('committed bundle', () => {
  it('lives at powers/monkeys-paw/server/paw-mcp.mjs', () => {
    expect(BUNDLE_OUT).toBe(join(POWER_SERVER, 'paw-mcp.mjs'));
  });

  it('equals a fresh in-memory build, byte for byte', async () => {
    const result = await build({ ...bundleOptions(), write: false });
    expect(result.outputFiles).toHaveLength(1);
    const fresh = Buffer.from(result.outputFiles![0]!.contents);
    const committed = readFileSync(BUNDLE_OUT);
    expect(fresh.equals(committed), 'run `pnpm bundle` in packages/paw-mcp and commit the result').toBe(true);
  });

  it('builds from paw-core/src, never from dist, and keeps HTTP transports out', async () => {
    const result = await build({ ...bundleOptions(), write: false });
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.some((p) => p.includes('paw-core/dist'))).toBe(false);
    expect(inputs.some((p) => p.endsWith('paw-core/src/index.ts'))).toBe(true);
    expect(inputs.some((p) => /sdk\/dist\/esm\/server\/(sse|streamableHttp)\.js$/.test(p))).toBe(false);
  });

  it('is under 1 MB and minify matches the size rule', async () => {
    const result = await build({ ...bundleOptions(), write: false });
    const options = bundleOptions();
    expect(options.minify).toBe(false);
    expect(result.outputFiles![0]!.contents.length).toBeLessThan(1024 * 1024);
  });

  it('NOTICE.md names every bundled third-party package with its version', async () => {
    const result = await build({ ...bundleOptions(), write: false });
    const packages = listPackages(result.metafile);
    expect(packages.length).toBeGreaterThan(0);
    const notice = readFileSync(join(POWER_SERVER, 'NOTICE.md'), 'utf8');
    for (const pkg of packages) {
      expect(notice, pkg.name).toContain(`| ${pkg.name} | ${pkg.version} | ${pkg.license} |`);
    }
    expect(packages.map((p) => p.name)).not.toContain('paw-core');
  });

  it('NOTICE.md carries the full licence text of every bundled package under its own ### section', async () => {
    const result = await build({ ...bundleOptions(), write: false });
    const notice = readFileSync(join(POWER_SERVER, 'NOTICE.md'), 'utf8').replace(/\r\n/g, '\n');
    for (const pkg of listPackages(result.metafile)) {
      expect(notice, `${pkg.name} has no ### section`).toContain(`### ${pkg.name} ${pkg.version} (${pkg.license})\n`);
      const text = readLicenseText(pkg.dir);
      expect(text, `${pkg.name} has no LICENSE file`).not.toBeNull();
      expect(notice, `${pkg.name}: LICENSE text is not in NOTICE.md`).toContain(text!.replace(/\r\n/g, '\n').trimEnd());
    }
  });
});
