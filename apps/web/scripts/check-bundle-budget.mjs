// Bundle budget check (paw-web task 50, design.md section 8). Run it after `pnpm build`.
// Reads dist/.vite/manifest.json, walks the static imports of the entry (the initial set) and the dynamic import of
// the 3D scene (the 3D set), gzips each file at level 9 and exits 1 when a budget is exceeded.
// Plain Node ESM, node: built-ins only. Usage: node check-bundle-budget.mjs [--dist <dir>]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** 1 KB is 1000 bytes, the same unit `vite build` prints. */
const KB = 1000;

/** The budgets. `gz` budgets are measured on gzipped bytes (level 9), the others on raw bytes (fonts and audio are already compressed). */
export const BUDGETS = [
  { id: 'initial-js', label: 'Initial JS', unit: 'gz', limit: 200 * KB },
  { id: 'initial-css', label: 'Initial CSS', unit: 'gz', limit: 30 * KB },
  { id: 'three-d', label: '3D chunk', unit: 'gz', limit: 330 * KB },
  { id: 'fonts', label: 'Fonts', unit: 'raw', limit: 140 * KB },
  { id: 'audio', label: 'Audio', unit: 'raw', limit: 500 * KB },
];

/** The dynamic import that holds the 3D stack (three, r3f, drei, the scene code). */
export const THREE_D_ENTRY = /(^|\/)scene\/PawScene\.[jt]sx?$/;
const FONT_EXTENSIONS = new Set(['.woff2', '.woff', '.ttf', '.otf']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.oga', '.opus', '.wav', '.m4a', '.aac', '.flac', '.weba']);

/** Follows `imports` from `starts` and returns the manifest keys reached, `starts` included, in visit order. */
function walkStatic(manifest, starts) {
  const seen = new Set();
  const queue = [...starts];
  while (queue.length > 0) {
    const key = queue.shift();
    if (seen.has(key)) continue;
    const chunk = manifest[key];
    if (chunk === undefined) throw new Error(`The manifest has no entry "${key}"`);
    seen.add(key);
    queue.push(...(chunk.imports ?? []));
  }
  return [...seen];
}

const unique = (items) => [...new Set(items)];

/**
 * Pure: splits a Vite manifest into the file sets the budgets are about. Paths are relative to dist/.
 * - `initialJs`, `initialCss`: the entry chunk and everything it imports statically, and their CSS.
 * - `threeDJs`, `threeDCss`: the dynamic import matching `threeDEntry`, its static imports, minus what the initial
 *   set already holds (shared chunks cost nothing extra when the 3D set loads).
 * - `fonts`: every font file the manifest lists, as an asset of a chunk or as an entry of its own.
 * - `otherLazy`: the other dynamic imports (the sound player). Reported, not budgeted.
 * @param {Record<string, { file: string, isEntry?: boolean, imports?: string[], dynamicImports?: string[], css?: string[], assets?: string[] }>} manifest
 * @param {{ threeDEntry?: RegExp }} [options]
 */
export function collectSets(manifest, options = {}) {
  const threeDEntry = options.threeDEntry ?? THREE_D_ENTRY;
  const entries = Object.keys(manifest).filter((key) => manifest[key].isEntry === true);
  if (entries.length === 0) throw new Error('The manifest has no entry chunk (isEntry)');

  const initialKeys = walkStatic(manifest, entries);
  const initialJs = unique(initialKeys.map((key) => manifest[key].file));
  const initialCss = unique(initialKeys.flatMap((key) => manifest[key].css ?? []));

  const dynamicKeys = unique(initialKeys.flatMap((key) => manifest[key].dynamicImports ?? []));
  const threeDStarts = dynamicKeys.filter((key) => threeDEntry.test(key));
  if (threeDStarts.length === 0) throw new Error(`No dynamic import matches ${String(threeDEntry)}, so there is no 3D chunk`);
  const threeDKeys = walkStatic(manifest, threeDStarts).filter((key) => !initialKeys.includes(key));
  const threeDJs = unique(threeDKeys.map((key) => manifest[key].file)).filter((file) => !initialJs.includes(file));
  const threeDCss = unique(threeDKeys.flatMap((key) => manifest[key].css ?? [])).filter((file) => !initialCss.includes(file));

  const everyKey = Object.keys(manifest);
  const fonts = unique([
    ...everyKey.flatMap((key) => manifest[key].assets ?? []),
    ...everyKey.map((key) => manifest[key].file),
  ]).filter((file) => FONT_EXTENSIONS.has(extname(file).toLowerCase()));

  const otherLazyKeys = walkStatic(manifest, dynamicKeys.filter((key) => !threeDStarts.includes(key))).filter(
    (key) => !initialKeys.includes(key) && !threeDKeys.includes(key),
  );
  const otherLazy = unique(otherLazyKeys.map((key) => manifest[key].file));

  return { initialJs, initialCss, threeDJs, threeDCss, fonts, otherLazy };
}

/** Pure: adds up `sizeOf(file)` over `files`. */
export function sumSizes(files, sizeOf) {
  return files.reduce((total, file) => total + sizeOf(file), 0);
}

/**
 * Pure: compares measured byte counts with the budgets.
 * @param {Record<string, number>} measured bytes by budget id
 * @returns {{ rows: { id: string, label: string, unit: string, bytes: number, limit: number, ok: boolean }[], failures: string[] }}
 */
export function evaluate(measured, budgets = BUDGETS) {
  const rows = budgets.map((budget) => {
    const bytes = measured[budget.id] ?? 0;
    return { id: budget.id, label: budget.label, unit: budget.unit, bytes, limit: budget.limit, ok: bytes <= budget.limit };
  });
  const failures = rows
    .filter((row) => !row.ok)
    .map((row) => `FAIL ${row.label}: ${formatKb(row.bytes)} ${row.unit} is over the budget of ${formatKb(row.limit)} ${row.unit}`);
  return { rows, failures };
}

/** Pure: the byte counts by budget id for a set of files, given a gzip size and a raw size function. */
export function measureSets(sets, audioFiles, { gzSize, rawSize }) {
  return {
    'initial-js': sumSizes(sets.initialJs, gzSize),
    'initial-css': sumSizes(sets.initialCss, gzSize),
    'three-d': sumSizes([...sets.threeDJs, ...sets.threeDCss], gzSize),
    fonts: sumSizes(sets.fonts, rawSize),
    audio: sumSizes(audioFiles, rawSize),
  };
}

export function formatKb(bytes) {
  return `${(bytes / KB).toFixed(1)} KB`;
}

/** Pure: the table printed to the terminal. */
export function formatTable(rows, otherLazy = []) {
  const header = ['Budget', 'Measured', 'Limit', 'Status'];
  const body = rows.map((row) => [row.label, `${formatKb(row.bytes)} ${row.unit}`, `${formatKb(row.limit)} ${row.unit}`, row.ok ? 'ok' : 'OVER']);
  const widths = header.map((_, column) => Math.max(header[column].length, ...body.map((line) => line[column].length)));
  const line = (cells) => cells.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd();
  const out = [line(header), line(widths.map((width) => '-'.repeat(width))), ...body.map(line)];
  if (otherLazy.length > 0) out.push('', `Lazy, not budgeted: ${otherLazy.join(', ')}`);
  return out.join('\n');
}

function filesUnder(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

/** Reads the build in `dist` and returns the evaluation. Throws when the build is missing. */
export function checkDist(dist) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read dist/.vite/manifest.json. Run \`pnpm build\` first (build.manifest must be on). ${error.message}`);
  }
  const sets = collectSets(manifest);
  const audioFiles = filesUnder(dist)
    .filter((path) => AUDIO_EXTENSIONS.has(extname(path).toLowerCase()))
    .map((path) => relative(dist, path));
  const rawSize = (file) => statSync(join(dist, file)).size;
  const gzSize = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length;
  const result = evaluate(measureSets(sets, audioFiles, { gzSize, rawSize }));
  return { ...result, sets };
}

function main() {
  const flag = process.argv.indexOf('--dist');
  const dist = resolve(flag >= 0 ? process.argv[flag + 1] : join(fileURLToPath(import.meta.url), '..', '..', 'dist'));
  let result;
  try {
    result = checkDist(dist);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
  process.stdout.write(`${formatTable(result.rows, result.sets.otherLazy)}\n`);
  for (const failure of result.failures) process.stderr.write(`${failure}\n`);
  return result.failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main());
}
