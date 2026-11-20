import type { ModelClient } from 'paw-core';
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
 *    a 503, 429 or 404 moves on to the next model and every attempt may be billed.
 * 2. If `spentCents + reservedCents + ceiling` is above the budget, the call is
 *    refused. Otherwise the ceiling is reserved in the same synchronous tick (no
 *    `await` between the check and the reservation), so parallel calls cannot all
 *    pass the check and then overspend.
 * 3. After the call, in a `finally` (a failed call is billed too), the reservation
 *    is released and the real cost is charged: for each attempt the token usage at
 *    the price of the model that answered, or the attempt's own ceiling when the
 *    attempt reported no usage. When no attempt reported at all, the whole ceiling.
 *
 * The real cost is charged even when it is above the ceiling, because it is real
 * money. That happens only when the real prompt has more tokens than the chars/3
 * estimate, or when the answering model is pricier than the one requested (an
 * unlisted `modelVersion` is priced at the top row). The spend can pass the cap
 * only by that excess, and every later call is then refused because `spentCents`
 * alone is above the cap.
 *
 * The per-IP limit is not applied here. It counts HTTP requests and is
 * enforced by `checkBudget`.
 */
export class BudgetedModelClient implements ModelClient {
  /** Inner calls made through this guard. */
  calls = 0;
  /** True once this guard has refused a call. */
  denied = false;
  /** Cents this guard has charged to the shared state (its own spend). */
  costCents = 0;

  constructor(
    private readonly inner: MeteredModelClient,
    private readonly state: GlobalState,
    private readonly config: BudgetConfig,
    private readonly now: () => number = Date.now,
    private readonly prices: PriceTable = DEFAULT_PRICE_TABLE,
  ) {}

  async generate(prompt: string): Promise<unknown> {
    rollDayIfElapsed(this.state, this.now());

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

    const reports: AttemptReport[] = [];
    try {
      return await this.inner.generateMetered(prompt, (report) => reports.push(report));
    } finally {
      this.release(ceiling);
      const charge =
        reports.length === 0
          ? ceiling
          : reports.reduce((sum, report) => sum + this.chargeOf(report), 0);
      this.state.spentCents += charge;
      this.costCents += charge;
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

  /** What one attempt really cost: its usage at the answering model's price, else its ceiling. */
  private chargeOf(report: AttemptReport): number {
    if (report.usage) {
      const cost = attemptCostCents(
        priceFor(this.prices, report.modelVersion ?? report.model),
        report.usage.promptTokens,
        report.usage.outputTokens,
      );
      if (Number.isFinite(cost) && cost >= 0) return cost;
    }
    return this.ceilingOf(report);
  }

  private release(ceiling: number): void {
    const inFlight = (IN_FLIGHT.get(this.state) ?? 1) - 1;
    IN_FLIGHT.set(this.state, inFlight);
    // Float sums do not always cancel out; with nothing in flight the reservation is exactly 0.
    this.state.reservedCents = inFlight === 0 ? 0 : Math.max(0, this.state.reservedCents - ceiling);
  }
}
