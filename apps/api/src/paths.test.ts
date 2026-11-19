import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defaultExamplesCachePath } from './paths';

describe('defaultExamplesCachePath', () => {
  const srcDir = path.dirname(fileURLToPath(import.meta.url));
  const expected = path.resolve(srcDir, '..', 'examples-cache.json');

  it('resolves to apps/api/examples-cache.json from the package, not from process.cwd()', () => {
    const resolved = defaultExamplesCachePath({});
    expect(resolved).toBe(expected);
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(path.basename(path.dirname(resolved))).toBe('api');
    expect(existsSync(resolved)).toBe(true);
  });

  it('gives the same file from a bundle placed in apps/api/dist', () => {
    expect(path.resolve(srcDir, '..', 'dist', '..', 'examples-cache.json')).toBe(expected);
  });

  it('EXAMPLES_CACHE_PATH overrides it', () => {
    expect(defaultExamplesCachePath({ EXAMPLES_CACHE_PATH: 'custom/cache.json' })).toBe(
      path.resolve('custom/cache.json'),
    );
  });

  it('ignores a blank override', () => {
    expect(defaultExamplesCachePath({ EXAMPLES_CACHE_PATH: '  ' })).toBe(expected);
  });
});
