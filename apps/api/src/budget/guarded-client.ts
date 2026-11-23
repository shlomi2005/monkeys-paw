import type { ModelClient } from 'paw-core';
import { LocationRefusedError, QuotaExhaustedError } from '../client/gemini';
import type { AttemptPlan, AttemptReport } from '../client/gemini';
import type { BudgetConfig } from './config';
import { DEFAULT_PRICE_TABLE, attemptCostCents, priceFor } from './prices';
import type { PriceTable } from './prices';
import { rollDayIfElapsed } from './state';
import type { GlobalState } from './state';

/**
 * A model client the guard can meter: it says what a call could cost at most
 * (`plan`) and reports what each HTTP attempt really used (`generateMetered`).
 * Api-local; paw-core's `ModelClient` stays as it is.
 */
export interface MeteredModelClient extends ModelClient {
  /** True when the client can call a model at all (an API key is set). */
  readonly available: boolean;
  plan(prompt: string): AttemptPlan[];
  generateMetered(prompt: string, onAttempt: (report: AttemptReport) => void): Promise<unknown>;
}

/** Thrown by the guard instead of calling the model when the budget cannot cover the call. */
export class BudgetExhaustedError extends Error {
  constructor() {
    super('The paw is resting');
    this.name = 'BudgetExhaustedError';
  }
}

/** Guards in flight per shared state, so the reservation lands on exactly 0 when the last one settles. */
const IN_FLIGHT = new WeakMap<GlobalState, number>();

/**
 * Wraps a model client so that every `generate` call is checked against the
 * daily budget first and charged the real cost afterwards (iron-rules §5).
 *
 * Reserve, then settle:
 * 1. `ceiling` is the most the call can cost: the sum over the whole fallback
 *    chain (`plan`) of input tokens at the input rate plus the output cap at the
 *    output rate, each at its requested model's price. The whole chain, because
 *    a 503, 429 or 404 moves on to the next model and any attempt may be billed, until its answer says otherwise.
 * 2. If `spentCents + reservedCents + ceiling` is above the budget, the call is
 *    refused. Otherwise the ceiling is reserved in the same synchronous tick (no
 *    `await` between the check and the reservation), so parallel calls cannot all
 *    pass the check and then overspend.
 * 3. After the call, in a `finally` (a failed attempt can be billed), the reservation
 *    is released and the real cost is charged: for each attempt the token usage at
 *    the price of the model that answered, or the attempt's own ceiling when the
 *    attempt reported no usage. When no attempt reported at all, the whole ceiling.
 *    A quota attempt (`report.quota`: a 429 or `RESOURCE_EXHAUSTED`) is charged 0
 *    cents, because Google does not bill it (Requirement 13.6). The reservation
 *    above is not changed by that: it cannot know which attempts will be quota
 *    answers, so the worst-case numbers stay an upper bound. An unbilled attempt
 *    (`report.unbilled`: HTTP 400 or 500 with no token counts) is charged 0 cents too,
 *    and the reservation is unchanged for the same reason.
 * 4. When the call threw `QuotaExhaustedError` (the free quota is spent), the guard
 *    sets `quotaSpent` and `denied`, then rethrows. Every later `generate` on this
 *    guard throws `BudgetExhaustedError` at once, before the day roll and before any
 *    reservation, without calling the model, so paw-core's retry spends no more quota.
 *    A `LocationRefusedError` (Google refuses the server's location, Requirement 17) does the same
 *    with `locationRefused`: nothing is called again on this guard, so paw-core's retry sends no
 *    second request. The routes then answer the gate's refusal.
 *    `quotaSpent` is separate from `denied` on purpose: a budget refusal does not block
 *    a later, cheaper call that still fits under the cap, a quota answer blocks all.
 *
 * The real cost is charged even when it is above the ceiling, because it is real
 * money. That happens only when the real prompt has more tokens than the chars/3
 * estimate, or when the answering model is pricier than the one requested (an
 * unlisted `modelVersion` is priced at the top row). The spend can pass the cap
 * only by that excess, and every later call is then refused because `spentCents`
 * alone is above the cap.
 *
 * When the state has a `persist` hook (a budget store), the guard calls it right after the reservation,
 * in the same tick and before `generateMetered`, so the reserve is saved before the first upstream fetch,
 * and again after the settle. The hook is not swallowed: if it throws, the error goes up, and a
 * throw at the reservation means the model is not called. paw-core hides the errors of a model call
 * behind a fallback, so the guard also keeps the first one in `persistFailure` and the grant and bind
 * routes throw it, which ends in the app's error handler (a fixed 500).
 *
 * The per-IP limit is not applied here. It counts HTTP requests and is
 * enforced by `checkBudget`.
 */
export class BudgetedModelClient implements ModelClient {
  /** Inner calls made through this guard. */
  calls = 0;
  /** True once this guard has refused a call. */
  denied = false;
  /** True once the model answered that the free quota is spent. Blocks every later call of this guard. */
  quotaSpent = false;
  /** True once the model refused the server's location. Blocks every later call of this guard. */
  locationRefused = false;
  /** Cents this guard has charged to the shared state (its own spend). */
  costCents = 0;
  /**
   * The first error a `persist` hook threw through this guard. paw-core swallows the errors of a
   * model call (retry once, then a fallback), so the routes read this after the call and throw it:
   * a failed save ends in the app's error handler, a fixed 500, and not in a fallback answer.
   */
  persistFailure: { error: unknown } | undefined;

  constructor(
    private readonly inner: MeteredModelClient,
    private readonly state: GlobalState,
    private readonly config: BudgetConfig,
    private readonly now: () => number = Date.now,
    private readonly prices: PriceTable = DEFAULT_PRICE_TABLE,
  ) {}

  async generate(prompt: string): Promise<unknown> {
    if (this.quotaSpent || this.locationRefused) {
      this.denied = true;
      throw new BudgetExhaustedError();
    }

    this.remember(() => rollDayIfElapsed(this.state, this.now()));

    if (!this.inner.available) {
      this.denied = true;
      throw new BudgetExhaustedError();
    }

    const ceiling = this.inner
      .plan(prompt)
      .reduce((sum, attempt) => sum + this.ceilingOf(attempt), 0);

    // `!(a <= b)` also refuses a ceiling that is not a number.
    const { spentCents, reservedCents } = this.state;
    if (!(spentCents + reservedCents + ceiling <= this.config.dailyBudgetCents)) {
      this.denied = true;
      throw new BudgetExhaustedError();
    }

    // Same tick as the check above: no await in between.
    this.state.reservedCents += ceiling;
    IN_FLIGHT.set(this.state, (IN_FLIGHT.get(this.state) ?? 0) + 1);
    this.calls += 1;
    // Same tick, before the first upstream fetch. A failed save is not swallowed: the reservation is
    // given back, nothing was charged, the error goes up and the model is not called.
    try {
      this.remember(() => this.state.persist?.());
    } catch (error) {
      this.calls -= 1;
      this.release(ceiling);
      throw error;
    }

    const reports: AttemptReport[] = [];
    try {
      return await this.inner.generateMetered(prompt, (report) => reports.push(report));
    } catch (error) {
      if (error instanceof QuotaExhaustedError) {
        this.quotaSpent = true;
        this.denied = true;
      }
      if (error instanceof LocationRefusedError) {
        this.locationRefused = true;
        this.denied = true;
      }
      throw error;
    } finally {
      this.release(ceiling);
      const charge =
        reports.length === 0
          ? ceiling
          : reports.reduce((sum, report) => sum + this.chargeOf(report), 0);
      this.state.spentCents += charge;
      this.costCents += charge;
      // Not caught: a failed save reaches the route's error handler (a fixed 500).
      this.remember(() => this.state.persist?.());
    }
  }

  /** The most one attempt can cost, at its requested model's price. */
  private ceilingOf(attempt: AttemptPlan): number {
    return attemptCostCents(
      priceFor(this.prices, attempt.model),
      attempt.inputTokens,
      attempt.maxOutputTokens,
    );
  }

  /**
   * What one attempt really cost: 0 for a quota attempt, else its usage at the answering
   * model's price, else 0 for an unbilled attempt (400 or 500 without token counts), else
   * its ceiling.
   */
  private chargeOf(report: AttemptReport): number {
    if (report.quota) return 0;
    if (report.usage) {
      const cost = attemptCostCents(
        priceFor(this.prices, report.modelVersion ?? report.model),
        report.usage.promptTokens,
        report.usage.outputTokens,
      );
      if (Number.isFinite(cost) && cost >= 0) return cost;
    }
    if (report.unbilled && !report.usage) return 0;
    return this.ceilingOf(report);
  }

  /** Runs `fn`; an error it throws is kept in `persistFailure` (the first one) and thrown again. */
  private remember<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      this.persistFailure ??= { error };
      throw error;
    }
  }

  private release(ceiling: number): void {
    const inFlight = (IN_FLIGHT.get(this.state) ?? 1) - 1;
    IN_FLIGHT.set(this.state, inFlight);
    // Float sums do not always cancel out; with nothing in flight the reservation is exactly 0.
    this.state.reservedCents = inFlight === 0 ? 0 : Math.max(0, this.state.reservedCents - ceiling);
  }
}
