import { randomUUID } from 'crypto';
import type { Context } from 'hono';
import type { Hono } from 'hono';
import { grantWish, isFallbackGrant } from 'paw-core';
import type { Wish } from 'paw-core';
import { GrantRequestSchema, GrantResponseSchema } from '../schemas';
import type { BudgetedModelClient } from '../budget/guarded-client';
import { restingResponse } from '../budget/messages';
import { GATE_MESSAGES } from '../gate/middleware';
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
      const raw = await grantWish(wish, modelClient);

      // A failed budget save: paw-core would have hidden it behind a fallback. Fail closed, fixed 500.
      if (modelClient.persistFailure) throw modelClient.persistFailure.error;

      // Google refused the server's location: answer as the closed gate does, so the ready rounds play.
      if (modelClient.locationRefused) {
        return c.json(
          { code: 'live_region_unavailable', message: GATE_MESSAGES.live_region_unavailable },
          403,
          { 'cache-control': 'no-store' },
        );
      }

      // The guard refused a call: paw-core would hand back its fallback grant, so say so instead.
      if (modelClient.denied) {
        return restingResponse(c, modelClient.retryAfterSeconds);
      }

      // Every model failed (any status, a timeout, no response, invalid output twice): paw-core's
      // own fallback grant. It is never sent, not even with 200 (Requirement 19).
      if (isFallbackGrant(raw)) {
        return restingResponse(c, modelClient.retryAfterSeconds);
      }

      const grant = fitGrant(raw);

      // Validate response matches schema
      const response = GrantResponseSchema.safeParse({
        wish,
        grant,
      });

      if (!response.success) {
        // A grant that fails the response schema is not sent either (Requirement 19).
        return restingResponse(c, modelClient.retryAfterSeconds);
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
