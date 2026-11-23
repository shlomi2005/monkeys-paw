import { describe, it, expect } from 'vitest';
import { FakeBudgetStore } from './fake-store';
import { applyLoaded, snapshotOf } from './store';
import { createGlobalState, rollDayIfElapsed } from './state';
import { DAY_MS } from 'paw-core';

const BUDGET = 200;
const NOW = 5_000_000;

function loadInto(row: unknown) {
  const state = createGlobalState(NOW);
  applyLoaded(state, new FakeBudgetStore(row).load(), BUDGET, NOW);
  return state;
}

describe('snapshotOf', () => {
  it('holds the three numbers and nothing else', () => {
    const state = createGlobalState(7);
    state.spentCents = 1.5;
    state.reservedCents = 2.5;
    state.ipStates.set('203.0.113.7', { ipCalls: 1, windowStart: 7 });
    expect(snapshotOf(state)).toEqual({ spentCents: 1.5, reservedCents: 2.5, dayStart: 7 });
  });
});

describe('applyLoaded (the load rule)', () => {
  it('no row leaves the fresh state', () => {
    const state = loadInto(undefined);
    expect(state).toMatchObject({ spentCents: 0, reservedCents: 0, dayStart: NOW });
  });

  it('a readable row counts its reservation as spent and keeps its dayStart', () => {
    const state = loadInto({ spentCents: 10, reservedCents: 3.5, dayStart: 1234 });
    expect(state).toMatchObject({ spentCents: 13.5, reservedCents: 0, dayStart: 1234 });
  });

  it('a row of zeros is readable', () => {
    const state = loadInto({ spentCents: 0, reservedCents: 0, dayStart: 0 });
    expect(state).toMatchObject({ spentCents: 0, reservedCents: 0, dayStart: 0 });
  });

  const good = { spentCents: 10, reservedCents: 3, dayStart: 1234 };
  const bad: Array<[string, unknown]> = [
    ['a missing spentCents', { reservedCents: 3, dayStart: 1234 }],
    ['a missing reservedCents', { spentCents: 10, dayStart: 1234 }],
    ['a missing dayStart', { spentCents: 10, reservedCents: 3 }],
    ['NaN', { ...good, spentCents: NaN }],
    ['Infinity', { ...good, reservedCents: Infinity }],
    ['-Infinity', { ...good, dayStart: -Infinity }],
    ['a negative spentCents', { ...good, spentCents: -1 }],
    ['a negative reservedCents', { ...good, reservedCents: -0.5 }],
    ['a negative dayStart', { ...good, dayStart: -1 }],
    ['a string number', { ...good, spentCents: '10' }],
    ['null', { ...good, dayStart: null }],
    ['a row that is not an object', 'oops'],
    ['a null row', null],
  ];
  for (const [name, row] of bad) {
    it(`an unreadable row (${name}) is a spent day from now`, () => {
      const state = loadInto(row);
      expect(state).toMatchObject({ spentCents: BUDGET, reservedCents: 0, dayStart: NOW });
    });
  }
});

describe('persist hook on the day roll', () => {
  it('rollDayIfElapsed calls persist when it rolls, and only then', () => {
    const state = createGlobalState(0);
    let calls = 0;
    state.persist = () => {
      calls += 1;
    };
    expect(rollDayIfElapsed(state, DAY_MS - 1)).toBe(false);
    expect(calls).toBe(0);
    expect(rollDayIfElapsed(state, DAY_MS)).toBe(true);
    expect(calls).toBe(1);
  });
});
