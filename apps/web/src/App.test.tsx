import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ApiClient } from './api/api-client';
import { App } from './App';
import { SessionProvider } from './state/SessionProvider';

const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);
const idleApi: ApiClient = {
  getExamples: () => never(),
  getLive: () => never(),
  postGrant: () => never(),
  postBind: () => never(),
  postExport: () => never(),
};

describe('App', () => {
  it('renders the page with a main element on the server, without touching the browser', () => {
    const html = renderToString(
      <SessionProvider api={idleApi}>
        <App />
      </SessionProvider>,
    );
    expect(html).toContain('<main');
    expect(html).toContain('Make the wish');
  });
});
