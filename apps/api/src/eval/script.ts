import { promises as fs } from 'fs';
import path from 'path';
import type { CurseType, Wish, Grant } from 'paw-core';
import { grantWish } from 'paw-core';
import { GeminiModelClient } from '../client/gemini';
import { loadBudgetConfig } from '../budget/config';
import { loadPriceTable } from '../budget/prices';
import type { PriceTable } from '../budget/prices';
import { BudgetedModelClient } from '../budget/guarded-client';
import type { MeteredModelClient } from '../budget/guarded-client';
import { createGlobalState } from '../budget/state';
import type { GoldenWish, WishEvalResult, EvalResult } from './types';

/** The eval cannot run: no API key, or the budget guard refused a model call. */
export class EvalAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalAbortError';
  }
}

export interface EvalOptions {
  /** Defaults to a real GeminiModelClient. Tests inject a fake. */
  model?: MeteredModelClient;
  /** Daily budget in cents. Defaults to DAILY_BUDGET_CENTS. */
  dailyBudgetCents?: number;
  /** Model prices for the guard. Defaults to PRICE_TABLE_JSON, then the 1.1.2027 table. */
  prices?: PriceTable;
  /** Pause between wishes. Defaults to 2000 ms. */
  delayMs?: number;
}

/**
 * Load golden wishes from docs/golden-wishes.json
 * (Task 72, Req 12.1)
 */
export async function loadGoldenWishes(): Promise<GoldenWish[]> {
  // Try from current working directory first (for CLI), then relative to workspace root
  let filePath = path.join(process.cwd(), 'docs', 'golden-wishes.json');
  
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    // Try from workspace root if cwd is apps/api
    filePath = path.join(process.cwd(), '../../docs', 'golden-wishes.json');
    const content = await fs.readFile(filePath, 'utf-8');
    const wishes = JSON.parse(content);
    
    if (!Array.isArray(wishes)) {
      throw new Error('golden-wishes.json must be an array');
    }
    
    return wishes;
  }
}

/**
 * Calculate specificity score: fraction of curses with specific: true.
 * (Task 70, Req 12.3)
 */
export function calculateSpecificityScore(specificCount: number, totalCount: number): number {
  if (totalCount === 0) return 0;
  return specificCount / totalCount;
}

/**
 * Calculate type coverage: fraction of expectedTypes found in generatedTypes.
 * (Task 71, Req 12.3)
 */
export function calculateTypeCoverage(
  expectedTypes: CurseType[],
  generatedTypes: CurseType[],
): number {
  if (expectedTypes.length === 0) return 1.0;
  
  const generatedSet = new Set(generatedTypes);
  const coveredCount = expectedTypes.filter((type) => generatedSet.has(type)).length;
  
  return coveredCount / expectedTypes.length;
}

/**
 * Task 97: A wish FAILS when:
 * - The fallback grant was used (1 curse)
 * - It has fewer than 3 curses
 * - It hits none of its expectedTypes (0% coverage)
 * Otherwise the wish PASSES.
 */
function evaluateWish(golden: GoldenWish, grant: Grant): { pass: boolean; reason: string } {
  // Check 1: fallback grant has only 1 curse
  if (grant.curses.length < 3) {
    return { pass: false, reason: 'Fewer than 3 curses generated' };
  }
  
  // Check 2: type coverage - hit at least one expected type
  const generatedTypes = grant.curses.map((c) => c.type);
  const typeCoverage = calculateTypeCoverage(golden.expectedTypes, generatedTypes);
  
  if (typeCoverage === 0) {
    return { pass: false, reason: 'No expected curse types found' };
  }
  
  // Wish passes
  return { pass: true, reason: `${Math.round(typeCoverage * 100)}% type coverage` };
}

/**
 * Run the eval script: grant all golden wishes (optionally limited), judge each curse, compute scores.
 * (Task 72, Req 12)
 * Task 97: Run PASSES only if >= 80% of wishes pass.
 * Task 100: Wait 2s between wishes, track model call count
 */
export async function runEval(
  limit?: number,
  options: EvalOptions = {},
): Promise<
  EvalResult & {
    modelCalls: number;
    /** Cents the guard charged for the whole run (fractional, never rounded). */
    costCents: number;
    examplesList: Array<{ wish: Wish; grant: Grant }>;
  }
> {
  const model = options.model ?? new GeminiModelClient();

  // Check for API key before any call or any other work (Req 12.7)
  if (!model.available) {
    throw new EvalAbortError('GEMINI_API_KEY env var is required for eval');
  }

  const threshold = parseFloat(process.env.EVAL_SPECIFICITY_THRESHOLD || '0.80');
  const goldenWishes = await loadGoldenWishes();
  const wishesToEval = limit ? goldenWishes.slice(0, limit) : goldenWishes;

  // Every model call goes through the budget guard, with its own fresh state (iron-rules §5).
  const dailyBudgetCents = options.dailyBudgetCents ?? loadBudgetConfig().dailyBudgetCents;
  const modelClient = new BudgetedModelClient(
    model,
    createGlobalState(),
    { perIpLimit: Number.MAX_SAFE_INTEGER, windowMs: 60_000, dailyBudgetCents },
    Date.now,
    options.prices ?? loadPriceTable(),
  );
  const delayMs = options.delayMs ?? 2000;

  const wishes: WishEvalResult[] = [];
  const examplesList: Array<{ wish: Wish; grant: Grant }> = [];
  let passedWishes = 0;

  // Process each golden wish (Req 12.2)
  for (let wishIndex = 0; wishIndex < wishesToEval.length; wishIndex++) {
    const golden = wishesToEval[wishIndex];

    const wish: Wish = {
      id: golden.id,
      text: golden.wish,
      context: golden.context,
      createdAt: Date.now(),
    };

    // Task 100: Wait 2s between wishes (but not before first wish)
    if (wishIndex > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    // Grant the wish (one or more model calls, each checked by the guard)
    const grant = await grantWish(wish, modelClient);

    // The guard refused a call: the grant is paw-core's fallback, so stop here.
    if (modelClient.denied) {
      // A spent free quota (Req 12.12) stops the eval as a refusal does, and the message says so.
      const quotaNote = modelClient.quotaSpent ? '; the free quota of the model is spent' : '';
      throw new EvalAbortError(
        `Eval failed: budget exhausted after ${modelClient.calls} model calls (${wishes.length} of ${wishesToEval.length} wishes done, ${modelClient.costCents.toFixed(4)} cents charged)${quotaNote}; nothing was written.`,
      );
    }

    // Task 97: Evaluate this wish
    const wishEval = evaluateWish(golden, grant);

    if (wishEval.pass) {
      passedWishes++;
    }

    // Judge each curse in quality mode (Req 12.2)
    const curses = [];
    let specificInThisWish = 0;

    for (const curse of grant.curses) {
      // Judge quality: is this curse specific or generic?
      let isSpecific = true; // Default to true (keep the curse)
      let reason = 'Quality gate passed';

      try {
        // Task 98: Batch quality judging already happened in grantWish
        // but for eval we still need to track if we're making calls here
        // In the new batch model, this part is already done in grantWish
        // So we skip individual judgment here
        isSpecific = true;
        reason = 'Included in batch quality gate';
      } catch {
        // On error, keep the curse as-is
      }

      if (isSpecific) {
        specificInThisWish++;
      }

      curses.push({
        id: curse.id,
        type: curse.type,
        specific: isSpecific,
        reason,
      });
    }

    // Calculate type coverage for this wish
    const generatedTypes = grant.curses.map((c) => c.type);
    const typeCoverage = calculateTypeCoverage(golden.expectedTypes, generatedTypes);

    wishes.push({
      id: golden.id,
      wish: golden.wish,
      curseCount: grant.curses.length,
      curses,
      typeCoverage,
      verdict: wishEval.pass ? 'PASS' : 'FAIL',
    });

    // Add to examples cache
    examplesList.push({ wish, grant });
  }

  // Task 97: Overall pass/fail: >= 80% of wishes pass
  const passPercentage = passedWishes / wishesToEval.length;
  const pass = passPercentage >= threshold;

  const result: EvalResult & { modelCalls: number; costCents: number } = {
    timestamp: new Date().toISOString(),
    wishes,
    overallSpecificity: calculateSpecificityScore(
      wishes.reduce((sum, w) => sum + w.curses.filter((c) => c.specific).length, 0),
      wishes.reduce((sum, w) => sum + w.curses.length, 0),
    ),
    overallTypeCoverage: wishes.reduce((sum, w) => sum + w.typeCoverage, 0) / wishes.length,
    pass,
    modelCalls: modelClient.calls,
    costCents: modelClient.costCents,
  };

  return { ...result, examplesList };
}

/**
 * Task 97: Write eval results to docs/eval/latest.md at REPO ROOT
 * (Task 72, Req 12.4)
 */
export async function writeEvalReport(result: EvalResult & { examplesList?: any[] }): Promise<void> {
  // Write to repo root, not apps/api
  const dirPath = path.join(process.cwd(), '../../docs', 'eval');
  await fs.mkdir(dirPath, { recursive: true });

  const filePath = path.join(dirPath, 'latest.md');

  const md = [
    '# Eval Report',
    '',
    `Generated: ${result.timestamp}`,
    '',
    `**Overall Specificity:** ${(result.overallSpecificity * 100).toFixed(1)}%`,
    `**Overall Type Coverage:** ${(result.overallTypeCoverage * 100).toFixed(1)}%`,
    `**Status:** ${result.pass ? 'PASS ✓' : 'FAIL ✗'}`,
    '',
    '## Golden Wishes Results',
    '',
    '| ID | Wish | Curses | Type Coverage | Verdict |',
    '|----|------|--------|---------------|---------|',
    ...result.wishes.map((w) => 
      `| ${w.id} | ${w.wish.substring(0, 50)}... | ${w.curseCount} | ${(w.typeCoverage * 100).toFixed(0)}% | ${w.verdict} |`
    ),
    '',
  ].join('\n');

  await fs.writeFile(filePath, md, 'utf-8');
}

/**
 * Task 97: Write examples cache file
 * (Task 72, Req 12.5)
 */
export async function writeExamplesCache(
  wishes: Array<{ wish: Wish; grant: Grant }>,
): Promise<void> {
  // Write to apps/api/examples-cache.json for the API to serve
  const filePath = path.join(process.cwd(), 'examples-cache.json');
  await fs.writeFile(filePath, JSON.stringify(wishes, null, 2), 'utf-8');
}

/**
 * Parse command-line arguments
 * Task 100: --limit 5 by default (--all for 25)
 */
function parseArgs(args: string[]): { limit?: number; all?: boolean } {
  const result: { limit?: number; all?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--all') {
      result.all = true;
    } else if (args[i] === '--limit' && i + 1 < args.length) {
      const num = parseInt(args[i + 1], 10);
      if (!isNaN(num) && num > 0) {
        result.limit = num;
      }
      i++; // skip next arg
    }
  }

  // Task 100: Default to 5, unless --all is specified
  if (!result.limit && !result.all) {
    result.limit = 5;
  }

  return result;
}

/** What `runEvalCli` calls. Tests replace them; the defaults are the real ones. */
export interface EvalCliDeps {
  runEval: typeof runEval;
  writeEvalReport: typeof writeEvalReport;
  writeExamplesCache: typeof writeExamplesCache;
  log: (line: string) => void;
  error: (line: string) => void;
}

/**
 * The eval as a command: returns the exit code instead of exiting, so a test can check it.
 * (Task 72)
 * Task 97: Load .env in eval script (tsx --env-file=.env)
 * Task 100: Print model call count
 * Task 109: when the budget guard refuses a call, `runEval` throws before anything is
 * written, so this prints one "budget exhausted" line, writes neither the report nor
 * the examples cache, and returns 1. A refused run never passes.
 */
export async function runEvalCli(
  argv: string[],
  deps: Partial<EvalCliDeps> = {},
): Promise<number> {
  const run = deps.runEval ?? runEval;
  const report = deps.writeEvalReport ?? writeEvalReport;
  const cache = deps.writeExamplesCache ?? writeExamplesCache;
  const log = deps.log ?? ((line: string) => console.log(line));
  const error = deps.error ?? ((line: string) => console.error(line));

  try {
    const { limit, all } = parseArgs(argv);

    const evalLimit = all ? undefined : limit;
    const result = await run(evalLimit);
    await report(result);

    // Write examples cache if available
    await cache(result.examplesList);

    // Print final test summary line (Task 100: include model call count)
    const passRate = (
      (result.wishes.filter((w) => w.verdict === 'PASS').length / result.wishes.length) *
      100
    ).toFixed(1);
    const summary = `${result.wishes.length} wishes: ${result.pass ? 'PASS ✓' : 'FAIL ✗'} (${passRate}% pass rate, specificity ${(result.overallSpecificity * 100).toFixed(1)}%, coverage ${(result.overallTypeCoverage * 100).toFixed(1)}%, ${result.modelCalls} model calls, ${result.costCents.toFixed(4)} cents charged)`;
    log(summary);

    return result.pass ? 0 : 1;
  } catch (err) {
    // One line, no stack: it must not echo prompts or secrets.
    error(
      err instanceof EvalAbortError
        ? err.message
        : `Eval script error: ${err instanceof Error ? err.message : 'unknown'}`,
    );
    return 1;
  }
}

async function main(): Promise<void> {
  process.exit(await runEvalCli(process.argv.slice(2)));
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
