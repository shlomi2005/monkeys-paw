import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CI_EVAL_WISHES, computeWorstCase } from '../src/budget/worst-case';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const text = readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'prompt-eval.yml'), 'utf8');
const lines = text.split(/\r?\n/);

const SECRET = '${{ secrets.GEMINI_API_KEY }}';
const GATE = "steps.key.outputs.present == 'true'";

/** Each step is the text from its `      - ` line to the next one. */
function steps(): string[] {
  const start = lines.findIndex((line) => line === '    steps:');
  expect(start).toBeGreaterThan(-1);
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('      - ')) out.push(line);
    else if (out.length > 0) out[out.length - 1] += `\n${line}`;
  }
  return out;
}

describe('.github/workflows/prompt-eval.yml', () => {
  it('runs on pull_request, never pull_request_target, and by hand', () => {
    expect(text).toMatch(/^on:\n {2}pull_request:$/m);
    expect(text).not.toMatch(/pull_request_target/);
    expect(text).toMatch(/^ {2}workflow_dispatch:/m);
  });

  it('watches the prompts, the curse taxonomy and the model client', () => {
    expect(text).toContain('- packages/paw-core/src/prompts.ts');
    expect(text).toContain('- .kiro/steering/curse-taxonomy.md');
    expect(text).toContain('- apps/api/src/client/gemini.ts');
  });

  it('has read-only permissions and a timeout', () => {
    expect(text).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(text).toMatch(/^ {4}timeout-minutes: \d+$/m);
  });

  it('exposes the secret only in step-level env of the check step and the eval step', () => {
    const all = steps();
    const withSecret = all.filter((step) => step.includes('secrets.'));
    expect(withSecret).toHaveLength(2);
    expect(withSecret[0]).toContain('id: key');
    expect(withSecret[1]).toContain('pnpm -C apps/api eval');
    for (const step of withSecret) {
      expect(step).toMatch(/^ {8}env:\n(?: {10}.*\n)*? {10}GEMINI_API_KEY: \$\{\{ secrets\.GEMINI_API_KEY \}\}$/m);
    }
    // Nowhere else: not in job-level or workflow-level env, not in `with`.
    expect(text.split(SECRET)).toHaveLength(3);
    expect(text.match(/secrets\./g)).toHaveLength(2);
    const head = lines.slice(0, lines.findIndex((line) => line === '    steps:')).join('\n');
    expect(head).not.toMatch(/secrets\.|^\s*env:/m);
  });

  it('never prints the key', () => {
    const printing = lines.filter((line) => /\b(echo|printf|cat|env|printenv)\b/.test(line) && /GEMINI_API_KEY/.test(line));
    expect(printing).toEqual([]);
    expect(text).not.toMatch(/echo[^\n]*\$\{?GEMINI/);
    expect(text).not.toMatch(/set -x|ACTIONS_STEP_DEBUG/);
  });

  it('writes present=true or present=false to GITHUB_OUTPUT and prints a notice when missing', () => {
    const check = steps()[0];
    expect(check).toContain('id: key');
    expect(check).toContain('echo "present=true" >> "$GITHUB_OUTPUT"');
    expect(check).toContain('echo "present=false" >> "$GITHUB_OUTPUT"');
    expect(check).toContain('::notice::');
    expect(check).toMatch(/skipped/);
  });

  it('gates every step after the check on present == true', () => {
    const [, ...rest] = steps();
    expect(rest.length).toBeGreaterThanOrEqual(6);
    for (const step of rest) expect(step).toContain(GATE);
  });

  it('runs the eval with a hard CI budget and uploads the report even when the eval fails', () => {
    const all = steps();
    const evalStep = all.find((step) => step.includes('pnpm -C apps/api eval'));
    // ceil(5 x the worst case per grant): the worst case of the default 5-wish eval.
    const cap = Math.ceil(CI_EVAL_WISHES * computeWorstCase().grantCents);
    expect(CI_EVAL_WISHES).toBe(5);
    expect(evalStep).toContain(`DAILY_BUDGET_CENTS: '${cap}'`);
    expect(evalStep).toContain('ceil(5 x ');
    const readme = readFileSync(path.join(REPO_ROOT, 'apps', 'api', 'README.md'), 'utf8');
    expect(readme).toContain(`DAILY_BUDGET_CENTS=${cap}`);
    expect(evalStep).not.toContain('continue-on-error');
    expect(text).not.toMatch(/continue-on-error/);
    const upload = all.find((step) => step.includes('upload-artifact'));
    expect(upload).toMatch(/if: always\(\) && steps\.key\.outputs\.present == 'true'/);
    expect(upload).toContain('path: docs/eval/latest.md');
  });

  it('installs from the lockfile, builds paw-core, and reads Node and pnpm from the repo', () => {
    expect(text).toContain('pnpm install --frozen-lockfile');
    expect(text).toContain('pnpm -C packages/paw-core build');
    expect(text).toContain('node-version-file: .nvmrc');
    expect(text).toContain('cache: pnpm');
    // pnpm/action-setup reads packageManager when no version is given.
    expect(text).not.toMatch(/^\s+version:/m);
  });

  it('pins every action to a major tag', () => {
    const uses = [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBe(4);
    for (const use of uses) expect(use).toMatch(/@v\d+$/);
  });
});
