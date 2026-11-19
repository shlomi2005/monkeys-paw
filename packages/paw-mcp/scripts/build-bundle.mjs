// Builds the single-file MCP server that the power ships.
// `bundle-fresh.test.ts` imports `bundleOptions` and runs the same call with `write: false`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(PACKAGE_DIR, '..', '..');

export const BUNDLE_OUT = join(REPO_ROOT, 'powers', 'monkeys-paw', 'server', 'paw-mcp.mjs');

/** Size rule (design.md "The bundle"): minify only if the unminified bundle is over 1 MB. */
export const MINIFY = false;

export function bundleOptions() {
  return {
    absWorkingDir: PACKAGE_DIR,
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    minify: MINIFY,
    legalComments: 'none',
    banner: {
      js: "import { createRequire as __pawCreateRequire } from 'node:module';\nconst require = __pawCreateRequire(import.meta.url);",
    },
    // The committed source, never `packages/paw-core/dist/`.
    alias: { 'paw-core': join(REPO_ROOT, 'packages', 'paw-core', 'src', 'index.ts') },
    metafile: true,
    logLevel: 'silent',
    outfile: BUNDLE_OUT,
  };
}

/** Name of the npm package that owns a node_modules path, or null for our own source. */
export function packageNameOf(inputPath) {
  const marker = 'node_modules/';
  const at = inputPath.lastIndexOf(marker);
  if (at === -1) return null;
  const rest = inputPath.slice(at + marker.length).split('/');
  return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
}

/** Third-party packages inside the bundle: name, version, licence, author, copyright line. */
export function listPackages(metafile) {
  const dirs = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const name = packageNameOf(input);
    if (!name) continue;
    const at = input.lastIndexOf('node_modules/');
    dirs.set(name, join(PACKAGE_DIR, input.slice(0, at + 'node_modules/'.length), name));
  }
  return [...dirs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, dir]) => {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      let copyright = '';
      for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license']) {
        try {
          copyright = readFileSync(join(dir, file), 'utf8')
            .split('\n')
            .find((line) => /copyright/i.test(line))
            ?.trim() ?? '';
          if (copyright) break;
        } catch {
          // try the next file name
        }
      }
      const author = typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name ?? '');
      return { name, version: pkg.version, license: pkg.license ?? '', author, copyright };
    });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(dirname(BUNDLE_OUT), { recursive: true });
  const result = await build({ ...bundleOptions(), write: false });
  const file = result.outputFiles[0];
  writeFileSync(BUNDLE_OUT, file.contents);
  const packages = listPackages(result.metafile);
  const dist = Object.keys(result.metafile.inputs).filter((p) => p.includes('paw-core/dist'));
  process.stdout.write(`bundle ${file.contents.length} bytes, minify=${MINIFY}, packages=${packages.length}\n`);
  if (dist.length > 0) {
    process.stderr.write('paw-core/dist is inside the bundle\n');
    process.exit(1);
  }
  if (process.argv.includes('--packages')) process.stdout.write(`${JSON.stringify(packages, null, 2)}\n`);
}
