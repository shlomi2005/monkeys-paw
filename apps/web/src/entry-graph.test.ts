// The 3D chunk stays out of the initial bundle: following static imports from main.tsx must never reach three,
// @react-three/fiber, @react-three/drei or the scene files that import them. Only `import()` may cross that line.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));
const HEAVY = /^(three|@react-three\/)/;
const LAZY_SCENE_FILES = ['PawScene', 'PawCanvas', 'PawLights', 'PawModel', 'use-paw-gltf', 'use-paw-material'];
// The sound player is its own lazy chunk: only a dynamic import in the sound controller may reach it.
const LAZY_AUDIO_FILES = ['sound-player'];

/** Static `import ... from 'x'`, `import 'x'` and `export ... from 'x'`. Type-only imports are erased, so skipped. */
function staticSpecifiers(source: string): string[] {
  const found: string[] = [];
  const pattern = /^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) {
    if (match[1] === undefined && match[2] !== undefined) found.push(match[2]);
  }
  return found;
}

function resolveLocal(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null; // css, json and the like
}

function entryGraph(entry: string): { files: Set<string>; packages: Map<string, string> } {
  const files = new Set<string>();
  const packages = new Map<string, string>(); // package specifier -> first file that imports it
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of staticSpecifiers(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) {
        const target = resolveLocal(file, specifier);
        if (target !== null) queue.push(target);
      } else if (!packages.has(specifier)) {
        packages.set(specifier, file);
      }
    }
  }
  return { files, packages };
}

describe('initial bundle', () => {
  const { files, packages } = entryGraph(resolve(SRC, 'main.tsx'));

  it('walks the app: the graph includes App and PawStage', () => {
    const names = [...files].map((f) => f.slice(SRC.length));
    expect(names).toContain('App.tsx');
    expect(names).toContain('scene/PawStage.tsx');
  });

  it('never statically imports three, @react-three/fiber or @react-three/drei', () => {
    const heavy = [...packages].filter(([specifier]) => HEAVY.test(specifier));
    expect(heavy).toEqual([]);
  });

  it('never statically imports the scene files', () => {
    const names = [...files].map((f) => f.slice(SRC.length).replace(/\.(ts|tsx)$/, ''));
    for (const name of LAZY_SCENE_FILES) expect(names).not.toContain(`scene/${name}`);
  });

  it('reaches the scene only through a dynamic import in PawStage', () => {
    const stage = readFileSync(resolve(SRC, 'scene/PawStage.tsx'), 'utf8');
    expect(stage).toMatch(/lazy\(\(\) => import\('\.\/PawScene'\)\)/);
  });

  it('never statically imports the sound player', () => {
    const names = [...files].map((f) => f.slice(SRC.length).replace(/\.(ts|tsx)$/, ''));
    for (const name of LAZY_AUDIO_FILES) expect(names).not.toContain(`audio/${name}`);
    expect(names).toContain('audio/sound-controller'); // the graph does reach the controller that loads it
  });

  it('reaches the sound player only through a dynamic import in the sound controller', () => {
    const controller = readFileSync(resolve(SRC, 'audio/sound-controller.ts'), 'utf8');
    expect(controller).toMatch(/import\('\.\/sound-player'\)/);
    expect(staticSpecifiers(controller).filter((s) => s.includes('sound-player'))).toEqual([]);
    // No other file in the entry graph names the player at all (a type-only import is erased, so the controller may).
    for (const file of files) {
      if (file.endsWith('audio/sound-controller.ts')) continue;
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/sound-player/);
    }
  });

  it('the self-test finds a static import and skips dynamic and type-only ones', () => {
    const source = [
      "import { a } from 'three';",
      "import type { B } from '@react-three/fiber';",
      "const C = lazy(() => import('@react-three/drei'));",
      "export { d } from './d';",
      "import './x.css';",
    ].join('\n');
    expect(staticSpecifiers(source)).toEqual(['three', './d', './x.css']);
  });
});
