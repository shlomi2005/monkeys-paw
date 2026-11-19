import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Where the examples cache lives: apps/api/examples-cache.json, found from this
 * file and not from process.cwd(). The same `..` works from src/ and from a
 * bundle placed in dist/. EXAMPLES_CACHE_PATH overrides it.
 */
export function defaultExamplesCachePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.EXAMPLES_CACHE_PATH?.trim();
  if (override) return path.resolve(override);
  return fileURLToPath(new URL('../examples-cache.json', import.meta.url));
}
