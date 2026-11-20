// The pure parts of scripts/check-bundle-budget.mjs, on a small fake manifest. No files are read.
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without type declarations
import { BUDGETS, collectSets, evaluate, formatTable, measureSets, sumSizes } from './check-bundle-budget.mjs';

const MANIFEST = {
  'index.html': {
    file: 'assets/index-a.js',
    isEntry: true,
    imports: ['_vendor.js'],
    dynamicImports: ['src/scene/PawScene.tsx', 'src/audio/sound-player.ts'],
    css: ['assets/index-a.css'],
    assets: ['assets/font-a.woff2'],
  },
  '_vendor.js': { file: 'assets/vendor-b.js', css: ['assets/vendor-b.css'] },
  'src/scene/PawScene.tsx': {
    file: 'assets/PawScene-c.js',
    isDynamicEntry: true,
    // Imports the entry (already initial) and a chunk of its own.
    imports: ['index.html', '_three.js'],
  },
  '_three.js': { file: 'assets/three-d.js', imports: ['_vendor.js'] },
  'src/audio/sound-player.ts': { file: 'assets/sound-player-e.js', isDynamicEntry: true },
  'src/styles/fonts/font-b.woff2': { file: 'assets/font-b.woff2' },
};

describe('collectSets', () => {
  const sets = collectSets(MANIFEST);

  it('takes the entry and its static imports as the initial set, with their CSS', () => {
    expect(sets.initialJs).toEqual(['assets/index-a.js', 'assets/vendor-b.js']);
    expect(sets.initialCss).toEqual(['assets/index-a.css', 'assets/vendor-b.css']);
  });

  it('takes the 3D import and its own static imports, without what the initial set already holds', () => {
    expect(sets.threeDJs).toEqual(['assets/PawScene-c.js', 'assets/three-d.js']);
    expect(sets.threeDCss).toEqual([]);
  });

  it('lists every font once, from chunk assets and from entries of their own', () => {
    expect([...sets.fonts].sort()).toEqual(['assets/font-a.woff2', 'assets/font-b.woff2']);
  });

  it('keeps other dynamic imports out of the 3D set and reports them', () => {
    expect(sets.threeDJs).not.toContain('assets/sound-player-e.js');
    expect(sets.otherLazy).toEqual(['assets/sound-player-e.js']);
  });

  it('throws when there is no entry or no 3D import', () => {
    expect(() => collectSets({ 'a.js': { file: 'a.js' } })).toThrow(/no entry chunk/);
    const flat = { 'index.html': { file: 'i.js', isEntry: true } };
    expect(() => collectSets(flat)).toThrow(/no 3D chunk/);
  });

  it('throws on an import that is not in the manifest', () => {
    const broken = { 'index.html': { file: 'i.js', isEntry: true, imports: ['_missing.js'] } };
    expect(() => collectSets(broken)).toThrow(/_missing\.js/);
  });
});

describe('sumSizes', () => {
  it('adds up the size of each file', () => {
    expect(sumSizes(['a', 'b', 'c'], (file: string) => ({ a: 1, b: 20, c: 300 })[file] ?? 0)).toBe(321);
    expect(sumSizes([], () => 5)).toBe(0);
  });
});

describe('measureSets and evaluate', () => {
  const sets = collectSets(MANIFEST);
  const sizes = { gzSize: (file: string) => (file.endsWith('.css') ? 100 : 1000), rawSize: () => 10 };

  it('measures gzipped files for JS and CSS, raw files for fonts and audio', () => {
    expect(measureSets(sets, ['sfx.mp3'], sizes)).toEqual({
      'initial-js': 2000,
      'initial-css': 200,
      'three-d': 2000,
      fonts: 20,
      audio: 10,
    });
  });

  it('passes at the limit and fails one byte above it, with one line per failed budget', () => {
    const at = Object.fromEntries(BUDGETS.map((budget: { id: string; limit: number }) => [budget.id, budget.limit]));
    expect(evaluate(at).failures).toEqual([]);
    const over = { ...at, 'initial-js': 200_001, fonts: 140_001 };
    const { failures, rows } = evaluate(over);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatch(/^FAIL Initial JS: 200\.0 KB gz is over the budget of 200\.0 KB gz$/);
    expect(failures[1]).toMatch(/^FAIL Fonts: /);
    expect(rows.filter((row: { ok: boolean }) => !row.ok).map((row: { id: string }) => row.id)).toEqual(['initial-js', 'fonts']);
  });

  it('prints one table row per budget', () => {
    const table = formatTable(evaluate({ 'initial-js': 103_440 }).rows, ['assets/sound-player-e.js']);
    expect(table).toContain('Initial JS');
    expect(table).toContain('103.4 KB gz');
    expect(table.split('\n').filter((line: string) => /\b(ok|OVER)$/.test(line))).toHaveLength(BUDGETS.length);
    expect(table).toContain('Lazy, not budgeted: assets/sound-player-e.js');
  });
});
