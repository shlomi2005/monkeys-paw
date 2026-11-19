// Copies the paw assets from docs/art/paw/ to apps/web/public/paw/ and verifies each copy.
// Plain Node ESM, node: built-ins only. Usage: node copy-paw-assets.mjs [--src <dir>] [--dest <dir>]
import { createHash } from 'node:crypto';
import { copyFile as fsCopyFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED_FILES = ['paw-web.glb', 'paw-mobile.glb', 'paw-poster.jpg'];
const COPIED_EXTENSIONS = new Set(['.glb', '.jpg']);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = resolve(SCRIPT_PATH, '..');

export const DEFAULT_SRC = resolve(SCRIPT_DIR, '..', '..', '..', 'docs', 'art', 'paw');
export const DEFAULT_DEST = resolve(SCRIPT_DIR, '..', 'public', 'paw');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {{ src?: string, dest?: string, copyFile?: (from: string, to: string) => Promise<void>, log?: (line: string) => void }} [options]
 * @returns {Promise<{ ok: boolean, copied: string[], errors: string[] }>}
 */
export async function copyPawAssets(options = {}) {
  const src = options.src ?? DEFAULT_SRC;
  const dest = options.dest ?? DEFAULT_DEST;
  const copyFile = options.copyFile ?? fsCopyFile;
  const log = options.log ?? (() => {});
  const errors = [];
  const copied = [];

  let present;
  try {
    present = await readdir(src);
  } catch {
    return { ok: false, copied, errors: [`source folder not found: ${src}`] };
  }

  for (const name of EXPECTED_FILES) {
    if (!present.includes(name)) errors.push(`missing source file: ${name} (in ${src})`);
  }

  const names = [
    ...new Set([...EXPECTED_FILES.filter((n) => present.includes(n)), ...present.filter((n) => COPIED_EXTENSIONS.has(extname(n).toLowerCase()))]),
  ].sort();

  if (names.length > 0) await mkdir(dest, { recursive: true });

  for (const name of names) {
    const from = join(src, name);
    const to = join(dest, name);
    try {
      await copyFile(from, to);
      const [a, b] = await Promise.all([readFile(from), readFile(to)]);
      if (a.length !== b.length) {
        errors.push(`copy differs: ${name} (size ${a.length} vs ${b.length})`);
        continue;
      }
      if (sha256(a) !== sha256(b)) {
        errors.push(`copy differs: ${name} (SHA-256 mismatch)`);
        continue;
      }
      copied.push(name);
      log(`ok ${name} (${a.length} bytes)`);
    } catch (error) {
      errors.push(`could not copy ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { ok: errors.length === 0, copied, errors };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--src' || arg === '--dest') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a folder`);
      out[arg.slice(2)] = resolve(value);
      i += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return out;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`copy-paw-assets: ${error.message}`);
    return 1;
  }
  const result = await copyPawAssets({ ...args, log: (line) => console.log(line) });
  for (const message of result.errors) console.error(`copy-paw-assets: ${message}`);
  return result.ok ? 0 : 1;
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(SCRIPT_PATH);
  } catch {
    return basename(process.argv[1]) === basename(SCRIPT_PATH);
  }
}

if (isDirectRun()) {
  process.exitCode = await main();
}
