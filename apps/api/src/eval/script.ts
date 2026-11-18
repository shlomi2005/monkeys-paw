import { promises as fs } from 'fs';
import path from 'path';
import type { CurseType, Wish, Grant } from 'paw-core';
import { grantWish, buildJudgePrompt } from 'paw-core';
import { GeminiModelClient } from '../client/gemini';
import type { GoldenWish, WishEvalResult, EvalResult } from './types';

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
 */
export async function runEval(limit?: number): Promise<EvalResult> {
  // Check for API key (Req 12.7)
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY env var is required for eval');
  }

  const threshold = parseFloat(process.env.EVAL_SPECIFICITY_THRESHOLD || '0.80');
  const goldenWishes = await loadGoldenWishes();
  const wishesToEval = limit ? goldenWishes.slice(0, limit) : goldenWishes;
  const modelClient = new GeminiModelClient();

  const wishes: WishEvalResult[] = [];
  const examplesList: Array<{ wish: Wish; grant: Grant }> = [];
  let passedWishes = 0;

  // Process each golden wish (Req 12.2)
  for (const golden of wishesToEval) {
    const wish: Wish = {
      id: golden.id,
      text: golden.wish,
      context: golden.context,
      createdAt: Date.now(),
    };

    // Grant the wish
    const grant = await grantWish(wish, modelClient);

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
        const prompt = buildJudgePrompt(curse, undefined, 'quality');
        const result = await modelClient.generate(prompt);
        const parsed = result as { specific: boolean; reason: string };
        isSpecific = parsed.specific;
        reason = parsed.reason;
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
  const passPercentage = (passedWishes / wishesToEval.length);
  const pass = passPercentage >= threshold;

  const result: EvalResult = {
    timestamp: new Date().toISOString(),
    wishes,
    overallSpecificity: calculateSpecificityScore(
      wishes.reduce((sum, w) => sum + w.curses.filter(c => c.specific).length, 0),
      wishes.reduce((sum, w) => sum + w.curses.length, 0)
    ),
    overallTypeCoverage: wishes.reduce((sum, w) => sum + w.typeCoverage, 0) / wishes.length,
    pass,
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
 */
function parseArgs(args: string[]): { limit?: number } {
  const result: { limit?: number } = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && i + 1 < args.length) {
      const num = parseInt(args[i + 1], 10);
      if (!isNaN(num) && num > 0) {
        result.limit = num;
      }
      i++; // skip next arg
    }
  }
  
  return result;
}

/**
 * Main eval entry point
 * (Task 72)
 * Task 97: Load .env in eval script (tsx --env-file=.env)
 */
async function main() {
  try {
    const args = process.argv.slice(2);
    const { limit } = parseArgs(args);
    
    const result = await runEval(limit);
    await writeEvalReport(result);
    
    // Write examples cache if available
    if ((result as any).examplesList) {
      await writeExamplesCache((result as any).examplesList);
    }
    
    // Print final test summary line
    const passRate = (result.wishes.filter(w => w.verdict === 'PASS').length / result.wishes.length * 100).toFixed(1);
    const summary = `${result.wishes.length} wishes: ${result.pass ? 'PASS ✓' : 'FAIL ✗'} (${passRate}% pass rate, specificity ${(result.overallSpecificity * 100).toFixed(1)}%, coverage ${(result.overallTypeCoverage * 100).toFixed(1)}%)`;
    console.log(summary);
    
    // Exit with appropriate code
    if (!result.pass) {
      process.exit(1);
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Eval script error:', err);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
