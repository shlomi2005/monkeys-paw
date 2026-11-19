// Builds the API into ONE file, apps/api/dist/server.mjs, that runs on Node with no node_modules.
// Same pattern as packages/paw-mcp/scripts/build-bundle.mjs: paw-core is read from its committed
// src/index.ts, never from packages/paw-core/dist (which is gitignored).
// `--outfile <path>` writes somewhere else (the build test uses it).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(PACKAGE_DIR, '..', '..');

export const SERVER_OUT = join(PACKAGE_DIR, 'dist', 'server.mjs');

export function serverOptions(outfile = SERVER_OUT) {
  return {
    absWorkingDir: PACKAGE_DIR,
    entryPoints: ['src/server.ts'],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    minify: false,
    sourcemap: false,
    legalComments: 'none',
    // Some bundled CommonJS code calls require(); give the ESM file one.
    banner: {
      js: "import { createRequire as __pawCreateRequire } from 'node:module';\nconst require = __pawCreateRequire(import.meta.url);",
    },
    alias: { 'paw-core': join(REPO_ROOT, 'packages', 'paw-core', 'src', 'index.ts') },
    metafile: true,
    logLevel: 'silent',
    outfile,
  };
}

export async function buildServer(outfile = SERVER_OUT) {
  const result = await build({ ...serverOptions(outfile), write: false });
  if (result.outputFiles.length !== 1) throw new Error('expected exactly one output file');
  const file = result.outputFiles[0];
  const dist = Object.keys(result.metafile.inputs).filter((p) => p.includes('paw-core/dist'));
  if (dist.length > 0) throw new Error('paw-core/dist is inside the bundle');
  mkdirSync(dirname(outfile), { recursive: true });
  writeFileSync(outfile, file.contents);
  return { bytes: file.contents.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf('--outfile');
  const arg = at === -1 ? undefined : process.argv[at + 1];
  const outfile = arg ? (isAbsolute(arg) ? arg : resolve(arg)) : SERVER_OUT;
  try {
    const { bytes } = await buildServer(outfile);
    process.stdout.write(`server bundle ${bytes} bytes\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
