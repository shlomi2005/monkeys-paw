import type { Context } from 'hono';
import type { Hono } from 'hono';
import { fitGrant } from '../fit';
import { ExamplesResponseSchema } from '../schemas';

/** Gives the raw JSON text of the examples cache. It may throw or reject. */
export type ExamplesLoader = () => Promise<string>;

/**
 * A loader that reads a file. The `node:fs/promises` import is dynamic and inside the loader, so a
 * bundle for a runtime without a file system does not need it unless this loader runs.
 */
export function fileExamplesLoader(cacheFile: string): ExamplesLoader {
  return async () => {
    const { readFile } = await import('node:fs/promises');
    return readFile(cacheFile, 'utf-8');
  };
}

/**
 * Create the examples route handler. `source` is a loader of the cache text, or a file path (read
 * with `fileExamplesLoader`).
 * (Task 38, Req 4)
 */
export function createExamplesRoute(app: Hono, source: ExamplesLoader | string): void {
  const load = typeof source === 'string' ? fileExamplesLoader(source) : source;
  app.get('/api/examples', async (c: Context) => {
    try {
      // Read the cache (Req 4)
      const content = await load();
      const parsed = JSON.parse(content);

      // Validate against schema
      const validated = ExamplesResponseSchema.safeParse(parsed);
      if (!validated.success) {
        return c.json(
          { message: 'Examples cache is corrupted' },
          503,
        );
      }

      return c.json(
        validated.data.map((entry) => ({ ...entry, grant: fitGrant(entry.grant) })),
        200,
      );
    } catch {
      // Loader failed, file not found or parse error (Req 4.3)
      return c.json(
        { message: 'Examples cache not yet generated' },
        503,
      );
    }
  });
}
