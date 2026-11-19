// Hook script for .kiro/hooks/golden-wish-eval.json.
// Runs the golden-wish eval only when apps/api/.env has a non-empty GEMINI_API_KEY.
// It never prints the file or the key.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY_LINE = /^\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$/;
const SKIP_MESSAGE = 'skipped: no GEMINI_API_KEY in apps/api/.env';

/** Decides from the text of apps/api/.env (or null when the file is missing). Returns no part of the text. */
export function decideEval(envText) {
  for (const line of String(envText ?? '').split(/\r?\n/)) {
    const match = KEY_LINE.exec(line);
    if (!match) continue;
    const value = match[1].replace(/^(["'])(.*)\1$/, '$2').trim();
    if (value !== '') return { run: true };
  }
  return { run: false, message: SKIP_MESSAGE };
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  let envText = null;
  try {
    envText = readFileSync(join(root, 'apps', 'api', '.env'), 'utf8');
  } catch {
    // a missing file means no key
  }
  const decision = decideEval(envText);
  if (!decision.run) {
    process.stdout.write(`${decision.message}\n`);
    return 0;
  }
  const result = spawnSync('pnpm', ['--filter', '@monkeyspaw/api', 'eval'], { cwd: root, stdio: 'inherit' });
  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
