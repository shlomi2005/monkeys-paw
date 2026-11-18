import type { Context } from 'hono';
import type { Hono } from 'hono';
import { promises as fs } from 'fs';
import { ExamplesResponseSchema } from '../schemas';

/**
 * Create the examples route handler.
 * (Task 38, Req 4)
 */
export function createExamplesRoute(app: Hono, cacheFile: string): void {
  app.get('/api/examples', async (c: Context) => {
    try {
      // Read cache file (Req 4)
      const content = await fs.readFile(cacheFile, 'utf-8');
      const parsed = JSON.parse(content);

      // Validate against schema
      const validated = ExamplesResponseSchema.safeParse(parsed);
      if (!validated.success) {
        return c.json(
          { message: 'Examples cache is corrupted' },
          503,
        );
      }

      return c.json(validated.data, 200);
    } catch {
      // File not found or parse error (Req 4.3)
      return c.json(
        { message: 'Examples cache not yet generated' },
        503,
      );
    }
  });
}
