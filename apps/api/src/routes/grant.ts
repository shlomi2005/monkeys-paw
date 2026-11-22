import { randomUUID } from 'crypto';
import type { Context } from 'hono';
import type { Hono } from 'hono';
import { grantWish } from 'paw-core';
import type { Wish } from 'paw-core';
import { GrantRequestSchema, GrantResponseSchema } from '../schemas';
import type { BudgetedModelClient } from '../budget/guarded-client';
import { RESTING_MESSAGE } from '../budget/messages';
import { fitGrant } from '../fit';
import { isHarmfulWish } from '../guardrail';
import { logError } from '../error-log';
import { bodyTooLarge, readJsonBody } from './body';

/**
 * Create the grant route handler.
 * `createClient` returns a fresh budget-guarded model client for each request;
 * the guard charges every model call to the daily budget (iron-rules §5).
 * (Task 25, Req 1)
 */
export function createGrantRoute(app: Hono, createClient: () => BudgetedModelClient): void {
  app.post('/api/grant', async (c: Context) => {
    try {
      // Validate request
      // An unreadable body is a bad wish, not a server failure; nothing of it is logged.
      const body = await readJsonBody(c);
      if (!body.ok) return body.tooLarge ? bodyTooLarge(c) : c.json({ message: 'Invalid wish format' }, 400);
      const parsed = GrantRequestSchema.safeParse(body.value);
      if (!parsed.success) {
        return c.json({ message: 'Invalid wish format' }, 400);
      }

      const { wish: wishInput } = parsed.data;

      // Check for harmful content (Req 1.3)
      if (isHarmfulWish(wishInput.text, wishInput.context)) {
        return c.json(
          {
            message:
              'The paw trembles and refuses. Such wishes are beyond its power — and its mercy.',
          },
          400,
        );
      }

      // Create Wish with server-generated id and timestamp (Req 1.1)
      const wish: Wish = {
        id: randomUUID(),
        text: wishInput.text,
        context: wishInput.context,
        createdAt: Date.now(),
      };

      // Call grantWish (Req 1.1). Every model call goes through the budget guard.
      const modelClient = createClient();
      const grant = fitGrant(await grantWish(wish, modelClient));

      // The guard refused a call: paw-core would hand back its fallback grant, so say so instead.
      if (modelClient.denied) {
        return c.json({ message: RESTING_MESSAGE }, 503);
      }

      // Validate response matches schema (Req 1.6)
      const response = GrantResponseSchema.safeParse({
        wish,
        grant,
      });

      if (!response.success) {
        // Fallback: return the grant as-is with 200 (Req 1.6)
        return c.json({ wish, grant }, 200);
      }

      return c.json(response.data, 200);
    } catch (err) {
      // Fixed code and class only: the message of a thrown value can hold the wish.
      logError('grant_failed', err);
      return c.json(
        { message: 'An error occurred while granting your wish' },
        500,
      );
    }
  });
}
