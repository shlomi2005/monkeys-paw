import type { Context } from 'hono';
import type { Hono } from 'hono';
import { judgeBinding, proposeBinding } from 'paw-core';
import type { Curse } from 'paw-core';
import { BindRequestSchema, BindResponseSchema } from '../schemas';
import type { BudgetedModelClient } from '../budget/guarded-client';
import { RESTING_MESSAGE } from '../budget/messages';
import { GATE_MESSAGES } from '../gate/middleware';
import { fitVerdict } from '../fit';
import { logError } from '../error-log';
import { bodyTooLarge, readJsonBody } from './body';

/**
 * Create the bind route handler.
 * `createClient` returns a fresh budget-guarded model client for each request;
 * the guard charges every model call to the daily budget (iron-rules §5).
 * (Task 30, Req 2)
 */
export function createBindRoute(app: Hono, createClient: () => BudgetedModelClient): void {
  app.post('/api/bind', async (c: Context) => {
    try {
      // Validate request
      // An unreadable body is a bad request, not a server failure; nothing of it is logged.
      const body = await readJsonBody(c);
      if (!body.ok) return body.tooLarge ? bodyTooLarge(c) : c.json({ message: 'Invalid bind request' }, 400);
      const parsed = BindRequestSchema.safeParse(body.value);
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

      // Propose binding (Req 2)
      const binding = proposeBinding(curse, clause, kind);

      // Judge the binding (Req 2). Every model call goes through the budget guard.
      const modelClient = createClient();
      const verdict = fitVerdict(await judgeBinding(curse, binding, modelClient));

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

      // The guard refused a call: paw-core would hand back its fallback verdict, so say so instead.
      if (modelClient.denied) {
        return c.json({ message: RESTING_MESSAGE }, 503);
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
      // Fixed code and class only: the message of a thrown value can hold the curse or the clause.
      logError('bind_failed', err);
      return c.json(
        { message: 'An error occurred while binding the curse' },
        500,
      );
    }
  });
}
