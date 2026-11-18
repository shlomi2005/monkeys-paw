import type { Context } from 'hono';
import type { Hono } from 'hono';
import { judgeBinding, proposeBinding } from 'paw-core';
import type { ModelClient, Curse } from 'paw-core';
import { BindRequestSchema, BindResponseSchema } from '../schemas';
import type { GlobalState, IpState } from '../budget/state';
import { recordCallInGlobalState } from '../budget/record';

/**
 * Create the bind route handler.
 * (Task 30, Req 2)
 */
export function createBindRoute(
  app: Hono,
  modelClient: ModelClient,
  globalState: GlobalState | null,
): void {
  app.post('/api/bind', async (c: Context) => {
    try {
      // Validate request
      const parsed = BindRequestSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json({ message: 'Invalid bind request' }, 400);
      }

      const { grant, curseId, kind, clause } = parsed.data;

      // Find the curse (Req 2.3)
      const curse = grant.curses.find((c) => c.id === curseId);
      if (!curse) {
        return c.json(
          { message: 'The paw has no memory of this curse.' },
          404,
        );
      }

      // Check budget (Req 2)
      const budgetExceeded = c.get('budgetExceeded');
      if (budgetExceeded === true) {
        return c.json(
          {
            message:
              'The paw is resting. Browse the examples until it wakes.',
          },
          503,
        );
      }

      // Propose binding (Req 2)
      const binding = proposeBinding(curse, clause, kind);

      // Judge the binding (Req 2)
      const verdict = await judgeBinding(curse, binding, modelClient);

      // Record cost (Req 2.6)
      if (globalState) {
        const ipState = c.get('ipState') as IpState | undefined;
        if (ipState) {
          const estimatedCostCents = 0.135;
          recordCallInGlobalState(globalState, ipState, estimatedCostCents);
        }
      }

      // Update curse status if closed (Req 2)
      const updatedCurse: Curse = {
        ...curse,
        status: verdict.closed ? 'closed' : 'open',
        binding,
        verdict,
      };

      // Update grant with the closed curse
      const updatedGrant = {
        ...grant,
        curses: grant.curses.map((c) => (c.id === curseId ? updatedCurse : c)),
      };

      // Validate response (Req 2.5)
      const response = BindResponseSchema.safeParse({
        grant: updatedGrant,
        verdict,
      });

      if (!response.success) {
        // Fallback: return with closed: false (Req 2.5)
        return c.json(
          {
            grant: updatedGrant,
            verdict: {
              ...verdict,
              closed: false,
              reason:
                'The Judge could not be roused; the loophole remains open.',
            },
          },
          200,
        );
      }

      return c.json(response.data, 200);
    } catch (err) {
      console.error('Bind route error:', err);
      return c.json(
        { message: 'An error occurred while binding the curse' },
        500,
      );
    }
  });
}
