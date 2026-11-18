import type { Context } from 'hono';
import type { Hono } from 'hono';
import { exportSpec } from 'paw-core';
import { ExportRequestSchema } from '../schemas';

/**
 * Create the export route handler.
 * (Task 34, Req 3)
 */
export function createExportRoute(app: Hono): void {
  app.post('/api/export', async (c: Context) => {
    try {
      // Validate request
      const parsed = ExportRequestSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json({ message: 'Invalid export request' }, 400);
      }

      const { wish, grant } = parsed.data;

      // Call exportSpec (pure logic, no model call) (Req 3)
      const specExport = exportSpec(wish, grant);

      return c.json(specExport, 200);
    } catch (err) {
      console.error('Export route error:', err);
      return c.json(
        { message: 'An error occurred while exporting the spec' },
        500,
      );
    }
  });
}
