import { describe, expect, it } from 'vitest';
import { ignoredLine, originOf, resolveMode, startupLine } from '../src/mode';

describe('resolveMode: local, nothing to report', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '   \t'],
    ['unexpanded placeholder', '${PAW_API_URL}'],
    ['placeholder inside a URL', 'https://${HOST}/x'],
  ])('%s', (_name, raw) => {
    expect(resolveMode(raw)).toEqual({ mode: { kind: 'local' }, ignored: false });
  });
});

describe('resolveMode: local, ignored (one stderr line)', () => {
  it.each([
    ['not parseable', 'not a url'],
    ['wrong protocol', 'ftp://example.com'],
    ['file protocol', 'file:///etc/passwd'],
    ['username', 'https://user@example.com'],
    ['username and password', 'https://user:pw@example.com'],
    ['password only', 'https://:pw@example.com'],
  ])('%s', (_name, raw) => {
    expect(resolveMode(raw)).toEqual({ mode: { kind: 'local' }, ignored: true });
  });
});

describe('resolveMode: remote', () => {
  it.each([
    ['http://127.0.0.1:8787///', 'http://127.0.0.1:8787'],
    ['http://127.0.0.1:8787', 'http://127.0.0.1:8787'],
    ['  https://paw.example.com/  ', 'https://paw.example.com'],
    ['https://paw.example.com/base/', 'https://paw.example.com/base'],
  ])('%s', (raw, baseUrl) => {
    expect(resolveMode(raw)).toEqual({ mode: { kind: 'remote', baseUrl }, ignored: false });
  });
});

describe('stderr lines', () => {
  it('the start-up line names the mode', () => {
    expect(startupLine('0.2.0', { kind: 'local' })).toBe('paw-mcp 0.2.0 mode=local');
    expect(startupLine('0.2.0', { kind: 'remote', baseUrl: 'https://paw.example.com:8443/base' })).toBe(
      'paw-mcp 0.2.0 mode=remote api=https://paw.example.com:8443',
    );
  });

  it('the ignored line is fixed text and never holds the value', () => {
    const line = ignoredLine('0.2.0');
    expect(line).toBe(
      'paw-mcp 0.2.0 ignored PAW_API_URL: not a usable http(s) URL without credentials; using local mode',
    );
    for (const raw of ['ftp://secret-host/x', 'https://user:hunter2@example.com', 'not a url']) {
      expect(resolveMode(raw).ignored).toBe(true);
      expect(line).not.toContain(raw);
      expect(line).not.toContain('hunter2');
    }
  });

  it('the remote start-up line carries the origin only, never credentials or a path', () => {
    const line = startupLine('0.2.0', { kind: 'remote', baseUrl: 'https://paw.example.com/secret/path' });
    expect(line).not.toContain('secret');
  });
});

describe('originOf', () => {
  it('strips the path and credentials', () => {
    expect(originOf('https://paw.example.com:8443/base/api?x=1')).toBe('https://paw.example.com:8443');
    expect(originOf('https://user:pw@paw.example.com/x')).toBe('https://paw.example.com');
  });
  it('never echoes garbage', () => {
    expect(originOf('nope secret')).toBe('an unusable URL');
  });
});
