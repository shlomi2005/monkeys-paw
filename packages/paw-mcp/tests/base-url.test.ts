import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_API_URL, originOf, resolveBaseUrl } from '../src/base-url';

describe('resolveBaseUrl', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '   \t'],
    ['unexpanded placeholder', '${PAW_API_URL}'],
    ['placeholder inside a URL', 'https://${HOST}/x'],
    ['not parseable', 'not a url'],
    ['wrong protocol', 'ftp://example.com'],
    ['file protocol', 'file:///etc/passwd'],
    ['username', 'https://user@example.com'],
    ['username and password', 'https://user:pw@example.com'],
    ['password only', 'https://:pw@example.com'],
  ])('falls back to the placeholder: %s', (_name, raw) => {
    expect(resolveBaseUrl(raw)).toBe(PLACEHOLDER_API_URL);
  });

  it('uses the reserved .invalid placeholder', () => {
    expect(PLACEHOLDER_API_URL).toBe('https://paw-api.invalid');
  });

  it.each([
    ['http://127.0.0.1:8787///', 'http://127.0.0.1:8787'],
    ['http://127.0.0.1:8787', 'http://127.0.0.1:8787'],
    ['  https://paw.example.com/  ', 'https://paw.example.com'],
    ['https://paw.example.com/base/', 'https://paw.example.com/base'],
  ])('keeps a usable URL without trailing slashes: %s', (raw, expected) => {
    expect(resolveBaseUrl(raw)).toBe(expected);
  });
});

describe('originOf', () => {
  it('strips the path and credentials', () => {
    expect(originOf('https://paw.example.com:8443/base/api?x=1')).toBe('https://paw.example.com:8443');
    expect(originOf('https://user:pw@paw.example.com/x')).toBe('https://paw.example.com');
  });
  it('falls back to the placeholder for garbage', () => {
    expect(originOf('nope')).toBe(PLACEHOLDER_API_URL);
  });
});
