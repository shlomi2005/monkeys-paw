/**
 * Model prices and the cost of a model call, in cents (paw-api tasks 102, 105).
 *
 * The guard charges the real cost of every call from the token counts the model
 * reports, so nothing here is a fixed per-call cost.
 */

/** USD per one million tokens. The output rate includes thinking tokens. */
export interface ModelPrice {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

export type PriceTable = Readonly<Record<string, ModelPrice>>;

/**
 * Gemini API paid tier, USD per 1M tokens, at the rates that apply from 1.1.2027.
 * Source: https://ai.google.dev/gemini-api/docs/pricing (checked 2026-11-20).
 *
 * Until 31.12.2026 gemini-3.6-flash and gemini-3.8-flash cost 0.75 in / 3.75 out
 * and the others the same as below. The guard uses the later, higher rates on
 * purpose: it over-counts today and never under-counts.
 *
 * `gemini-3.5-flash` is a retired name whose endpoint routes to gemini-3.6-flash,
 * so it carries the 3.6-flash rates in case someone still sets it.
 */
export const DEFAULT_PRICE_TABLE: PriceTable = {
  'gemini-3.6-flash': { inputUsdPerMTok: 1.5, outputUsdPerMTok: 7.5 },
  'gemini-3.8-flash': { inputUsdPerMTok: 1.5, outputUsdPerMTok: 7.5 },
  'gemini-3.5-flash': { inputUsdPerMTok: 1.5, outputUsdPerMTok: 7.5 },
  'gemini-3.5-flash-lite': { inputUsdPerMTok: 0.3, outputUsdPerMTok: 2.5 },
  'gemini-3.1-flash-lite': { inputUsdPerMTok: 0.25, outputUsdPerMTok: 1.5 },
};

/** The highest input rate and the highest output rate of the table: never under-prices. */
function topPrice(table: PriceTable): ModelPrice {
  const rows = Object.values(table);
  if (rows.length === 0) return topPrice(DEFAULT_PRICE_TABLE);
  return {
    inputUsdPerMTok: Math.max(...rows.map((row) => row.inputUsdPerMTok)),
    outputUsdPerMTok: Math.max(...rows.map((row) => row.outputUsdPerMTok)),
  };
}

/**
 * The price of `modelId`:
 * 1. a leading `models/` is stripped;
 * 2. an exact match wins;
 * 3. else the longest key K such that the id starts with `K-` (a versioned name
 *    of a known model, such as `gemini-3.6-flash-001`);
 * 4. else the most expensive row. An unknown model is never under-priced.
 */
export function priceFor(table: PriceTable, modelId: string): ModelPrice {
  const id = modelId.startsWith('models/') ? modelId.slice('models/'.length) : modelId;

  if (Object.hasOwn(table, id)) return table[id];

  let best: string | undefined;
  for (const key of Object.keys(table)) {
    if (id.startsWith(`${key}-`) && (best === undefined || key.length > best.length)) {
      best = key;
    }
  }
  return best === undefined ? topPrice(table) : table[best];
}

/**
 * Cents for `tokens` at `usdPerMTok`: tokens x usd / 1_000_000 x 100 cents.
 * 1000 tokens at 7.50 USD per million is 0.75 cents. Never rounded.
 */
export function tokensToCents(tokens: number, usdPerMTok: number): number {
  return (tokens * usdPerMTok) / 10_000;
}

/** Cents for one attempt: input tokens at the input rate plus output tokens at the output rate. */
export function attemptCostCents(
  price: ModelPrice,
  inputTokens: number,
  outputTokens: number,
): number {
  return (
    tokensToCents(inputTokens, price.inputUsdPerMTok) +
    tokensToCents(outputTokens, price.outputUsdPerMTok)
  );
}

function isRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** A non-empty object of `{ inputUsdPerMTok, outputUsdPerMTok }` rows, every rate finite and 0 or more. */
function parsePriceTable(raw: string): PriceTable | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) return undefined;

  const table: Record<string, ModelPrice> = {};
  for (const [id, row] of entries) {
    if (id.trim() === '' || row === null || typeof row !== 'object') return undefined;
    const { inputUsdPerMTok, outputUsdPerMTok } = row as Record<string, unknown>;
    if (!isRate(inputUsdPerMTok) || !isRate(outputUsdPerMTok)) return undefined;
    table[id] = { inputUsdPerMTok, outputUsdPerMTok };
  }
  return table;
}

function defaultWarn(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * The price table for this process. `PRICE_TABLE_JSON` (a JSON object
 * `{ "<model id>": { "inputUsdPerMTok": n, "outputUsdPerMTok": n } }`) replaces
 * the default table. Unset or blank means the default table. Set but invalid
 * means the default table and ONE warning line that holds no part of the value.
 */
export function loadPriceTable(
  raw: string | undefined = process.env.PRICE_TABLE_JSON,
  warn: (line: string) => void = defaultWarn,
): PriceTable {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PRICE_TABLE;

  const table = parsePriceTable(raw);
  if (!table) {
    warn(JSON.stringify({ event: 'price_table_invalid' }));
    return DEFAULT_PRICE_TABLE;
  }
  return table;
}
