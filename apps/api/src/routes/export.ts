import type { Context } from 'hono';
import type { Hono } from 'hono';
import { exportSpec } from 'paw-core';
import { ExportRequestSchema } from '../schemas';
import { logError } from '../error-log';
import { bodyTooLarge, readJsonBody } from './body';

/**
 * Create the export route handler.
 * (Task 34, Req 3)
 */
export function createExportRoute(app: Hono): void {
  app.post('/api/export', async (c: Context) => {
    try {
      // Validate request
      // An unreadable body is a bad request, not a server failure; nothing of it is logged.
      const body = await readJsonBody(c);
      if (!body.ok) return body.tooLarge ? bodyTooLarge(c) : c.json({ message: 'Invalid export request' }, 400);
      const parsed = ExportRequestSchema.safeParse(body.value);
      if (!parsed.success) {
        return c.json({ message: 'Invalid export request' }, 400);
      }

      const { wish, grant } = parsed.data;

      // Call exportSpec (pure logic, no model call) (Req 3)
      const specExport = exportSpec(wish, grant);

      return c.json(specExport, 200);
    } catch (err) {
      // Fixed code and class only: the message of a thrown value can hold the spec text.
      logError('export_failed', err);
      return c.json(
        { message: 'An error occurred while exporting the spec' },
        500,
      );
    }
  });
}
