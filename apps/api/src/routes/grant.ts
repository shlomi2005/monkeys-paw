import { randomUUID } from 'crypto';
import type { Context } from 'hono';
import type { Hono } from 'hono';
import { grantWish } from 'paw-core';
import type { ModelClient, Wish } from 'paw-core';
import { GrantRequestSchema, GrantResponseSchema } from '../schemas';
import type { GlobalState, IpState } from '../budget/state';
import { recordCallInGlobalState } from '../budget/record';
import { isHarmfulWish } from '../guardrail';

/**
 * Create the grant route handler.
 * (Task 25, Req 1)
 */
export function createGrantRoute(
  app: Hono,
  modelClient: ModelClient,
  globalState: GlobalState | null,
): void {
  app.post('/api/grant', async (c: Context) => {
    try {
      // Validate request
      const parsed = GrantRequestSchema.safeParse(await c.req.json());
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

      // Check budget if middleware attached it (Req 1.4)
      const budgetExceeded = c.get('budgetExceeded');
      if (budgetExceeded === true) {
        return c.json(
          {
            message:
              'The paw is resting. Browse the examples until it wakes. Visit /api/examples to see what the Paw has granted before.',
          },
          503,
        );
      }

      // Create Wish with server-generated id and timestamp (Req 1.1)
      const wish: Wish = {
        id: randomUUID(),
        text: wishInput.text,
        context: wishInput.context,
        createdAt: Date.now(),
      };

      // Call grantWish (Req 1.1)
      const grant = await grantWish(wish, modelClient);

      // Record cost if we have budget state (Req 1.7)
      if (globalState) {
        const ipState = c.get('ipState') as IpState | undefined;
        if (ipState) {
          // Estimate cost: ~0.135 cents per call for Gemini Flash
          const estimatedCostCents = 0.135;
          recordCallInGlobalState(globalState, ipState, estimatedCostCents);
        }
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
      console.error('Grant route error:', err);
      return c.json(
        { message: 'An error occurred while granting your wish' },
        500,
      );
    }
  });
}
