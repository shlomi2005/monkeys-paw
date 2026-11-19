// @vitest-environment jsdom
// The static shell from index.html is removed once React has committed (task 19).

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { removeStaticShell, STATIC_SHELL_ID } from './static-shell';

function addShell(): HTMLElement {
  const shell = document.createElement('div');
  shell.id = STATIC_SHELL_ID;
  document.body.append(shell);
  return shell;
}

afterEach(() => {
  cleanup();
  document.getElementById(STATIC_SHELL_ID)?.remove();
});

describe('static shell', () => {
  it('is removed after the first commit of App', () => {
    addShell();
    expect(document.getElementById(STATIC_SHELL_ID)).not.toBeNull();
    render(<App />);
    expect(document.getElementById(STATIC_SHELL_ID)).toBeNull();
  });

  it('removeStaticShell is safe to call when the shell is already gone', () => {
    addShell();
    removeStaticShell();
    expect(() => removeStaticShell()).not.toThrow();
    expect(document.getElementById(STATIC_SHELL_ID)).toBeNull();
  });
});
