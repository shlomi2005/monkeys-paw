import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the app shell with a main element', () => {
    expect(renderToString(<App />)).toContain('<main');
  });
});
