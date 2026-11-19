// Hook script for .kiro/hooks/ui-screenshot-receipt.json.
// Refreshes the @receipt screenshots when a web source file changes. The saved file path is process.argv[2].
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_FILE = /\.(test|spec)\.tsx?$/;
const RECEIPT_COMMAND = ['pnpm', '--filter', '@monkeyspaw/web', 'exec', 'playwright', 'test', '--grep', '@receipt', '--pass-with-no-tests'];

/** Decides what to do for a saved file. Returns { run: false, message } or { run: true, command, args }. */
export function decideReceipt({ filePath, hasPlaywright }) {
  const path = String(filePath ?? '').replace(/\\/g, '/');
  if (TEST_FILE.test(path) || path.includes('/__tests__/')) {
    return { run: false, message: 'skipped: the saved file is a test file' };
  }
  if (!hasPlaywright) {
    return { run: false, message: 'skipped: @playwright/test is not a dependency of apps/web yet' };
  }
  return { run: true, command: RECEIPT_COMMAND[0], args: RECEIPT_COMMAND.slice(1) };
}

function webHasPlaywright(root) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'apps', 'web', 'package.json'), 'utf8'));
    return Boolean(pkg.dependencies?.['@playwright/test'] || pkg.devDependencies?.['@playwright/test']);
  } catch {
    return false;
  }
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const decision = decideReceipt({ filePath: process.argv[2] ?? '', hasPlaywright: webHasPlaywright(root) });
  if (!decision.run) {
    process.stdout.write(`${decision.message}\n`);
    return 0;
  }
  const result = spawnSync(decision.command, decision.args, { cwd: root, stdio: 'inherit' });
  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
