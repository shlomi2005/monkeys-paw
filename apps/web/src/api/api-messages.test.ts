// The in-character lines and the server-message guard (design.md section 6).

import { describe, expect, it } from 'vitest';
import * as messages from './api-messages';

describe('api-messages lines', () => {
  it('uses the exact lines from the status mapping table', () => {
    expect(messages.GRANT_UNREADABLE_MESSAGE).toBe('The Paw cannot read that wish. Try fewer words.');
    expect(messages.CLAUSE_UNREADABLE_MESSAGE).toBe('The Judge cannot read that clause.');
    expect(messages.CURSE_FORGOTTEN_MESSAGE).toBe('The paw has no memory of this curse.');
    expect(messages.RESTING_MESSAGE).toBe('The paw is resting. Browse the examples until it wakes.');
    expect(messages.SERVER_STUMBLE_MESSAGE).toBe('The paw stumbles. Try again in a moment.');
    expect(messages.NETWORK_MESSAGE).toBe('The line to the paw is cut.');
    expect(messages.TIMEOUT_MESSAGE).toBe('The paw is slow to wake.');
    expect(messages.INVALID_RESPONSE_MESSAGE).toBe('The paw mumbles nonsense. Try again.');
  });

  it('uses the wish line and example lines', () => {
    expect(messages.EMPTY_WISH_MESSAGE).toBe('The paw waits for a wish. Write one first.');
    expect(messages.PAW_STIRS_MESSAGE).toBe('The Paw stirs…');
    expect(messages.EXAMPLES_SLEEPING_MESSAGE).toBe('The examples are sleeping. Write your own wish.');
  });

  it('uses the binding card lines', () => {
    expect(messages.JUDGE_STIRS_MESSAGE).toBe('The Judge stirs…');
    expect(messages.PAW_REMEMBERS_MESSAGE).toBe('The paw remembers.');
    expect(messages.EMPTY_CLAUSE_MESSAGE).toBe('The Judge cannot weigh a blank clause. Write one first.');
  });

  it('keeps every line within the 200 character limit', () => {
    for (const value of Object.values(messages)) {
      if (typeof value === 'string') expect(value.length).toBeLessThanOrEqual(200);
    }
  });
});

describe('serverMessageOf', () => {
  it('accepts a string message of at most 200 characters', () => {
    expect(messages.serverMessageOf({ message: 'The paw trembles and refuses.' })).toBe(
      'The paw trembles and refuses.',
    );
    expect(messages.serverMessageOf({ message: 'x'.repeat(200) })).toBe('x'.repeat(200));
  });

  it('rejects a message of 201 characters', () => {
    expect(messages.serverMessageOf({ message: 'x'.repeat(201) })).toBeUndefined();
  });

  it('rejects an empty or blank message', () => {
    expect(messages.serverMessageOf({ message: '' })).toBeUndefined();
    expect(messages.serverMessageOf({ message: '   ' })).toBeUndefined();
  });

  it('rejects a message that is not a string', () => {
    for (const message of [1, null, undefined, true, ['a'], { a: 'b' }]) {
      expect(messages.serverMessageOf({ message })).toBeUndefined();
    }
  });

  it('rejects bodies that are not objects with a message', () => {
    for (const body of [undefined, null, 'text', 42, [], {}, { error: 'x' }]) {
      expect(messages.serverMessageOf(body)).toBeUndefined();
    }
  });
});
