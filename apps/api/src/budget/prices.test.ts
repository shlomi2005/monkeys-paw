import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_PRICE_TABLE,
  attemptCostCents,
  loadPriceTable,
  priceFor,
  tokensToCents,
} from './prices';

const TOP = { inputUsdPerMTok: 1.5, outputUsdPerMTok: 7.5 };

describe('DEFAULT_PRICE_TABLE (the 1.1.2027 prices)', () => {
  it('has exactly the five rows at the 1.1.2027 rates', () => {
    expect(DEFAULT_PRICE_TABLE).toEqual({
      'gemini-3.6-flash': { inputUsdPerMTok: 1.5, outputUsdPerMTok: 7.5 },
      'gemini-3.8-flash': { inputUsdPerMTok: 1.5, outputUsdPerMTok: 7.5 },
      'gemini-3.5-flash': { inputUsdPerMTok: 1.5, outputUsdPerMTok: 7.5 },
      'gemini-3.5-flash-lite': { inputUsdPerMTok: 0.3, outputUsdPerMTok: 2.5 },
      'gemini-3.1-flash-lite': { inputUsdPerMTok: 0.25, outputUsdPerMTok: 1.5 },
    });
  });
});

describe('cents', () => {
  it('is tokens x usd per million / 10_000: 1000 tokens at 7.50 is 0.75 cents', () => {
    expect(tokensToCents(1000, 7.5)).toBe(0.75);
    expect(tokensToCents(1_000_000, 1.5)).toBe(150);
    expect(tokensToCents(0, 7.5)).toBe(0);
  });

  it('charges 1000 prompt and 2000 output tokens on gemini-3.6-flash 1.65 cents, unrounded', () => {
    const cents = attemptCostCents(priceFor(DEFAULT_PRICE_TABLE, 'gemini-3.6-flash'), 1000, 2000);
    expect(cents).toBeCloseTo(1.65, 12);
    expect(attemptCostCents(TOP, 1, 1)).toBeCloseTo(0.0009, 12); // fractions stay
  });
});

describe('priceFor', () => {
  it('takes the exact match', () => {
    expect(priceFor(DEFAULT_PRICE_TABLE, 'gemini-3.5-flash-lite')).toEqual({
      inputUsdPerMTok: 0.3,
      outputUsdPerMTok: 2.5,
    });
    expect(priceFor(DEFAULT_PRICE_TABLE, 'gemini-3.1-flash-lite')).toEqual({
      inputUsdPerMTok: 0.25,
      outputUsdPerMTok: 1.5,
    });
  });

  it('strips a leading models/', () => {
    expect(priceFor(DEFAULT_PRICE_TABLE, 'models/gemini-3.1-flash-lite')).toEqual(
      DEFAULT_PRICE_TABLE['gemini-3.1-flash-lite'],
    );
  });

  it('matches a versioned name to the longest known key: -lite-001 is lite, not the flash row', () => {
    expect(priceFor(DEFAULT_PRICE_TABLE, 'gemini-3.5-flash-lite-001')).toEqual(
      DEFAULT_PRICE_TABLE['gemini-3.5-flash-lite'],
    );
    expect(priceFor(DEFAULT_PRICE_TABLE, 'gemini-3.6-flash-001')).toEqual(
      DEFAULT_PRICE_TABLE['gemini-3.6-flash'],
    );
    expect(priceFor(DEFAULT_PRICE_TABLE, 'models/gemini-3.1-flash-lite-preview')).toEqual(
      DEFAULT_PRICE_TABLE['gemini-3.1-flash-lite'],
    );
  });

  it('prices an unknown model at the most expensive row', () => {
    expect(priceFor(DEFAULT_PRICE_TABLE, 'gemini-9-ultra')).toEqual(TOP);
    expect(priceFor(DEFAULT_PRICE_TABLE, '')).toEqual(TOP);
    // a prefix without the dash is not a versioned name
    expect(priceFor(DEFAULT_PRICE_TABLE, 'gemini-3.1-flash-litex')).toEqual(TOP);
  });

  it('the top row is the highest input rate and the highest output rate, even from different rows', () => {
    const table = {
      a: { inputUsdPerMTok: 5, outputUsdPerMTok: 1 },
      b: { inputUsdPerMTok: 2, outputUsdPerMTok: 9 },
    };
    expect(priceFor(table, 'unknown')).toEqual({ inputUsdPerMTok: 5, outputUsdPerMTok: 9 });
  });

  it('does not read inherited object keys as models', () => {
    expect(priceFor(DEFAULT_PRICE_TABLE, 'constructor')).toEqual(TOP);
    expect(priceFor(DEFAULT_PRICE_TABLE, '__proto__')).toEqual(TOP);
  });
});

describe('loadPriceTable (PRICE_TABLE_JSON)', () => {
  const row = { inputUsdPerMTok: 2, outputUsdPerMTok: 4 };

  it('unset or blank is the default table, with no warning', () => {
    const warn = vi.fn();
    expect(loadPriceTable(undefined, warn)).toBe(DEFAULT_PRICE_TABLE);
    expect(loadPriceTable('  ', warn)).toBe(DEFAULT_PRICE_TABLE);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses a valid override instead of the default table', () => {
    const warn = vi.fn();
    const table = loadPriceTable(JSON.stringify({ 'my-model': row, other: { ...row, inputUsdPerMTok: 0 } }), warn);
    expect(table).toEqual({ 'my-model': row, other: { inputUsdPerMTok: 0, outputUsdPerMTok: 4 } });
    expect(priceFor(table, 'my-model')).toEqual(row);
    expect(warn).not.toHaveBeenCalled();
  });

  const SECRET = 'value-that-must-not-leak';
  it.each([
    ['not JSON', `{${SECRET}`],
    ['an array', JSON.stringify([row, SECRET])],
    ['null', 'null'],
    ['a number', '5'],
    ['an empty object', '{}'],
    ['a row that is not an object', JSON.stringify({ [SECRET]: 3 })],
    ['a missing rate', JSON.stringify({ [SECRET]: { inputUsdPerMTok: 1 } })],
    ['a negative rate', JSON.stringify({ [SECRET]: { ...row, outputUsdPerMTok: -1 } })],
    ['a rate that is a string', JSON.stringify({ [SECRET]: { ...row, inputUsdPerMTok: '1' } })],
    ['a rate that is not finite (JSON.stringify writes null)', JSON.stringify({ [SECRET]: { ...row, inputUsdPerMTok: Infinity } })],
    ['one good row and one bad row', JSON.stringify({ good: row, [SECRET]: { ...row, outputUsdPerMTok: null } })],
  ])('%s: the default table and ONE warning that holds no part of the value', (_label, raw) => {
    const warn = vi.fn();
    expect(loadPriceTable(raw, warn)).toBe(DEFAULT_PRICE_TABLE);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('{"event":"price_table_invalid"}');
    expect(String(warn.mock.calls[0][0])).not.toContain(SECRET);
  });

  it('reads process.env.PRICE_TABLE_JSON by default and warns on stdout', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const before = process.env.PRICE_TABLE_JSON;
    try {
      process.env.PRICE_TABLE_JSON = 'nope';
      expect(loadPriceTable()).toBe(DEFAULT_PRICE_TABLE);
      expect(write.mock.calls.map((c) => String(c[0]))).toEqual(['{"event":"price_table_invalid"}\n']);
    } finally {
      if (before === undefined) delete process.env.PRICE_TABLE_JSON;
      else process.env.PRICE_TABLE_JSON = before;
      write.mockRestore();
    }
  });
});
