import { canSpend } from 'paw-core';
import type { ModelClient } from 'paw-core';
import { DEFAULT_MODEL_CALL_COST_CENTS } from './config';
import type { BudgetConfig } from './config';
import { rollDayIfElapsed } from './state';
import type { GlobalState } from './state';

/** A model client that knows whether it can call a model at all (an API key is set). */
export interface AvailableModelClient extends ModelClient {
  readonly available: boolean;
}

/** Thrown by the guard instead of calling the model when the budget cannot cover the call. */
export class BudgetExhaustedError extends Error {
  constructor() {
    super('The paw is resting');
    this.name = 'BudgetExhaustedError';
  }
}

/**
 * Wraps a model client so that every `generate` call is checked against the
 * daily budget first and charged to it (iron-rules §5; design: canCall -> model
 * -> recordCall). The spend can never pass `dailyBudgetCents`.
 *
 * The cost is charged in the same tick as the check, before the inner call
 * starts, so parallel requests cannot all pass the check and then overspend.
 * An attempt that fails still costs, as the provider may bill it.
 *
 * The per-IP limit is not applied here. It counts HTTP requests and is
 * enforced by `checkBudget`.
 */
export class BudgetedModelClient implements ModelClient {
  /** Inner calls made through this guard. */
  calls = 0;
  /** True once this guard has refused a call. */
  denied = false;

  private readonly costPerCall: number;

  constructor(
    private readonly inner: AvailableModelClient,
    private readonly state: GlobalState,
    private readonly config: BudgetConfig,
    private readonly now: () => number = Date.now,
    costPerCallCents: number = DEFAULT_MODEL_CALL_COST_CENTS,
  ) {
    this.costPerCall =
      Number.isFinite(costPerCallCents) && costPerCallCents >= 0
        ? costPerCallCents
        : DEFAULT_MODEL_CALL_COST_CENTS;
  }

  async generate(prompt: string): Promise<unknown> {
    const now = this.now();
    rollDayIfElapsed(this.state, now);

    if (!this.inner.available || !canSpend(this.state, this.config, this.costPerCall, now)) {
      this.denied = true;
      throw new BudgetExhaustedError();
    }

    this.state.spentCents += this.costPerCall;
    this.calls += 1;
    return this.inner.generate(prompt);
  }
}
