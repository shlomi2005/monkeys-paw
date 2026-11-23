// Builds apps/api/examples-cache.json from the three ready rounds of the web app (READY_ROUNDS).
// No model call, no network and no env file: the rounds are plain data, checked with paw-core's
// ExamplesResponseSchema. Run it with `pnpm -C apps/api examples:ready` (tsx runs this file).
// The eval (`pnpm -C apps/api eval --all`) replaces the file with real grants when the owner runs it.
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ExamplesResponseSchema } from 'paw-core';
import { READY_ROUNDS } from '../../web/src/state/ready-rounds.ts';

/** The cache file, found from this file and never from the working directory. */
export const CACHE_FILE = fileURLToPath(new URL('../examples-cache.json', import.meta.url));

/** The exact text of the cache: the ready rounds as JSON, two-space indent, one final newline. */
export function readyExamplesText() {
  const checked = ExamplesResponseSchema.safeParse(READY_ROUNDS);
  if (!checked.success) {
    throw new Error(`The ready rounds do not match ExamplesResponseSchema: ${checked.error.message}`);
  }
  return JSON.stringify(READY_ROUNDS, null, 2) + '\n';
}

// Only when run as the main module. Importing this file writes nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(CACHE_FILE, readyExamplesText(), 'utf-8');
  console.log(`Wrote ${READY_ROUNDS.length} ready rounds to apps/api/examples-cache.json`);
}
