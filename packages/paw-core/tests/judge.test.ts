import { describe, expect, it } from 'vitest';

import { judgeBinding } from '../src/judge';
import { proposeBinding } from '../src/bind';
import type { Curse, ModelClient } from '../src/types';

function makeCurse(id: string = 'c1'): Curse {
  return {
    id,
    type: 'permissions',
    story: 'The owner quits; nobody can delete the project.',
    loophole: 'Only the owner can delete',
    status: 'open',
  };
}

function fakeModel(response: unknown): ModelClient {
  return {
    async generate(): Promise<unknown> {
      return response;
    },
  };
}

describe('judgeBinding (task 12)', () => {
  it('returns a Verdict with closed: true when the model says the binding closes the loophole', async () => {
    const curse = makeCurse();
    const binding = proposeBinding(curse, 'Admins can also delete', 'ears-clause');

    const model = fakeModel({
      curseId: curse.id,
      closed: true,
      reason: 'The binding adds admin deletion rights, closing the permission loophole.',
      judgedAt: 0,
    });

    const verdict = await judgeBinding(curse, binding, model);

    expect(verdict.curseId).toBe('c1');
    expect(verdict.closed).toBe(true);
    expect(verdict.reason.length).toBeGreaterThan(0);
    expect(verdict.judgedAt).toBeGreaterThan(0);
  });

  it('returns a Verdict with closed: false when the model says the binding does not close the loophole', async () => {
    const curse = makeCurse();
    const binding = proposeBinding(curse, 'Only the owner', 'rewrite');

    const model = fakeModel({
      curseId: curse.id,
      closed: false,
      reason: 'This is the original wish text; no change.',
      judgedAt: 0,
    });

    const verdict = await judgeBinding(curse, binding, model);

    expect(verdict.closed).toBe(false);
    expect(verdict.reason).toBe('This is the original wish text; no change.');
  });

  it('retries once on invalid JSON, then succeeds', async () => {
    const curse = makeCurse();
    const binding = proposeBinding(curse, 'a binding', 'rewrite');

    let callCount = 0;
    const model: ModelClient = {
      async generate(): Promise<unknown> {
        callCount += 1;
        if (callCount === 1) return 'definitely not json';
        return {
          curseId: curse.id,
          closed: true,
          reason: 'Closed on retry.',
          judgedAt: 0,
        };
      },
    };

    const verdict = await judgeBinding(curse, binding, model);

    expect(verdict.closed).toBe(true);
    expect(callCount).toBe(2); // one failure + one retry
  });

  it('falls back to closed: false after two failures', async () => {
    const curse = makeCurse();
    const binding = proposeBinding(curse, 'a binding', 'rewrite');

    const model = fakeModel('definitely not json');

    const verdict = await judgeBinding(curse, binding, model);

    // Req 4.4: fall back to closed: false on unrecoverable model failure.
    expect(verdict.curseId).toBe('c1');
    expect(verdict.closed).toBe(false);
    expect(verdict.reason.length).toBeGreaterThan(0);
    expect(verdict.judgedAt).toBeGreaterThan(0);
  });

  it('includes curseId in the verdict', async () => {
    const curse = makeCurse('curse-xyz');
    const binding = proposeBinding(curse, 'a binding', 'rewrite');

    const model = fakeModel({
      curseId: curse.id,
      closed: true,
      reason: 'Test reason.',
      judgedAt: 0,
    });

    const verdict = await judgeBinding(curse, binding, model);

    expect(verdict.curseId).toBe('curse-xyz');
  });

  it('keeps the property of a closed verdict', async () => {
    const curse = makeCurse();
    const binding = proposeBinding(curse, 'Admins can also delete', 'ears-clause');
    const property = 'For any project whose owner has left, at least one member can still delete it.';

    const verdict = await judgeBinding(
      curse,
      binding,
      fakeModel({ closed: true, reason: 'Closed.', property: `  ${property}  ` }),
    );

    expect(verdict.closed).toBe(true);
    expect(verdict.property).toBe(property);
  });

  it('drops the property of a not-closed verdict', async () => {
    const curse = makeCurse();
    const binding = proposeBinding(curse, 'Only the owner', 'rewrite');

    const verdict = await judgeBinding(
      curse,
      binding,
      fakeModel({ closed: false, reason: 'Still open.', property: 'For any project, anything.' }),
    );

    expect(verdict.closed).toBe(false);
    expect('property' in verdict).toBe(false);
  });

  it('drops a blank property of a closed verdict', async () => {
    const curse = makeCurse();
    const binding = proposeBinding(curse, 'a binding', 'rewrite');

    const verdict = await judgeBinding(
      curse,
      binding,
      fakeModel({ closed: true, reason: 'Closed.', property: '   ' }),
    );

    expect(verdict.closed).toBe(true);
    expect('property' in verdict).toBe(false);
  });

  it('parses a model answer without curseId and judgedAt, using the curse id', async () => {
    const curse = makeCurse('curse-3');
    const binding = proposeBinding(curse, 'a binding', 'rewrite');

    const verdict = await judgeBinding(
      curse,
      binding,
      fakeModel({ closed: false, reason: 'Not yet.', property: '' }),
    );

    expect(verdict.curseId).toBe('curse-3');
    expect(verdict.closed).toBe(false);
    expect(verdict.reason).toBe('Not yet.');
    expect(verdict.judgedAt).toBeGreaterThan(0);
  });

  it('ignores a curseId the model invents', async () => {
    const curse = makeCurse('curse-1');
    const binding = proposeBinding(curse, 'a binding', 'rewrite');

    const verdict = await judgeBinding(
      curse,
      binding,
      fakeModel({ curseId: 'made-up', closed: false, reason: 'No.', judgedAt: 5 }),
    );

    expect(verdict.curseId).toBe('curse-1');
    expect(verdict.judgedAt).toBeGreaterThan(5);
  });
});
