import { describe, expect, it } from 'vitest';
import { decideEval } from '../../../scripts/golden-wish-eval.mjs';
import { decideReceipt } from '../../../scripts/ui-screenshot-receipt.mjs';

// Fake .env text only. The real file is never read here.
const FAKE_SECRET = 'fake-value-for-tests';

describe('decideEval', () => {
  it('skips when there is no file', () => {
    const decision = decideEval(null);
    expect(decision.run).toBe(false);
    expect('message' in decision && decision.message).toMatch(/^skipped/);
  });

  it('skips on an empty key, an empty quoted key, and other variables only', () => {
    for (const text of ['GEMINI_API_KEY=', 'GEMINI_API_KEY=""\n', "GEMINI_API_KEY = ''", '  GEMINI_API_KEY =   \n', 'OTHER=1\nPORT=3000\n', '']) {
      expect(decideEval(text).run, JSON.stringify(text)).toBe(false);
    }
  });

  it('runs on a plain, a quoted, a padded and a later-line key', () => {
    for (const text of [
      `GEMINI_API_KEY=${FAKE_SECRET}`,
      `GEMINI_API_KEY="${FAKE_SECRET}"`,
      `GEMINI_API_KEY = '${FAKE_SECRET}'  \r\n`,
      `PORT=3000\n  GEMINI_API_KEY=${FAKE_SECRET}\nOTHER=1\n`,
    ]) {
      expect(decideEval(text)).toEqual({ run: true });
    }
  });

  it('never returns the key or any part of the file', () => {
    const text = `PORT=3000\nGEMINI_API_KEY=${FAKE_SECRET}\n`;
    expect(JSON.stringify(decideEval(text))).not.toContain(FAKE_SECRET);
    const skipped = decideEval(`GEMINI_API_KEY=\nPASSWORD=${FAKE_SECRET}\n`);
    expect(JSON.stringify(skipped)).not.toContain(FAKE_SECRET);
    expect(skipped).toEqual({ run: false, message: 'skipped: no GEMINI_API_KEY in apps/api/.env' });
  });
});

describe('decideReceipt', () => {
  it('skips test files, in every spelling', () => {
    for (const filePath of [
      'apps/web/src/App.test.tsx',
      'apps/web/src/App.spec.tsx',
      '/work/repo/apps/web/src/a/b.test.ts',
      'apps/web/src/__tests__/Thing.tsx',
      'C:\\work\\repo\\apps\\web\\src\\__tests__\\Thing.tsx',
    ]) {
      const decision = decideReceipt({ filePath, hasPlaywright: true });
      expect(decision.run, filePath).toBe(false);
      expect('message' in decision && decision.message).toMatch(/^skipped/);
    }
  });

  it('skips while Playwright is not a dependency of apps/web', () => {
    const decision = decideReceipt({ filePath: 'apps/web/src/App.tsx', hasPlaywright: false });
    expect(decision.run).toBe(false);
    expect('message' in decision && decision.message).toMatch(/^skipped/);
  });

  it('runs the @receipt tests with --pass-with-no-tests for a normal file', () => {
    const decision = decideReceipt({ filePath: 'apps/web/src/components/CurseCard.tsx', hasPlaywright: true });
    expect(decision.run).toBe(true);
    if (!decision.run) return;
    expect([decision.command, ...decision.args].join(' ')).toBe(
      'pnpm --filter @monkeyspaw/web exec playwright test --grep @receipt --pass-with-no-tests',
    );
  });

  it('does not put the file path into the command, so a path with spaces or quotes cannot inject anything', () => {
    const decision = decideReceipt({ filePath: 'apps/web/src/my file "x"; rm -rf.tsx', hasPlaywright: true });
    expect(decision.run).toBe(true);
    if (!decision.run) return;
    expect(JSON.stringify(decision)).not.toContain('rm -rf');
  });
});
