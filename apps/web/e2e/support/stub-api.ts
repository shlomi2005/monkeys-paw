// The stubbed API (paw-web task 42). One `page.route` handler answers `GET /api/examples` and `POST /api/grant`,
// `/api/bind` and `/api/export` with schema-valid fixtures, records every request, and aborts (and records) any
// request to another origin. The real apps/api is never contacted, and neither is anything else outside the app.

import type { Page, Route } from '@playwright/test';
import { BindingKindSchema, GrantSchema, WishSchema } from 'paw-core';
import type { ExamplesResponse, GrantResponse } from 'paw-core';
import {
  bindResponseFixture,
  examplesFixture,
  exportFixture,
  grantResponseFixture,
  restingBody,
} from './fixtures';
import type { CurseCount } from './fixtures';

export type Endpoint = 'examples' | 'grant' | 'bind' | 'export';

const PATHS: Readonly<Record<string, Endpoint>> = {
  '/api/examples': 'examples',
  '/api/grant': 'grant',
  '/api/bind': 'bind',
  '/api/export': 'export',
};

/** One request the page made to a stubbed endpoint. */
export interface RecordedRequest {
  readonly endpoint: Endpoint;
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** The JSON body, or the raw text when it is not JSON, or null when there is none. */
  readonly body: unknown;
  /** The status the stub answered with. */
  readonly status: number;
}

/** What the stub answers. Tests change these fields before they act. */
export interface StubBehavior {
  /** Body of `GET /api/examples`. */
  examples: ExamplesResponse;
  /** Body of `POST /api/grant`. */
  grant: GrantResponse;
  /** A status for an endpoint makes the stub answer that status with the resting message (503) instead. */
  failWith: Partial<Record<Endpoint, number>>;
  /** Decides the Judge's verdict for `POST /api/bind`. The default closes every clause. */
  closes: (curseId: string, clause: string) => boolean;
}

export interface StubApi {
  readonly behavior: StubBehavior;
  /** Every request to a stubbed endpoint, in arrival order. */
  readonly requests: readonly RecordedRequest[];
  /** URLs of requests to another origin. They were aborted. Tests assert this stays empty. */
  readonly blocked: readonly string[];
  /** Requests to one endpoint. */
  to(endpoint: Endpoint): RecordedRequest[];
  /** Use a Grant of 3 or 5 curses for the next `POST /api/grant`. */
  grantWith(count: CurseCount): void;
}

function jsonBody(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Installs the stub on `page`. Call it before the first `goto`. `appOrigin` is the origin of the app under test: a
 * request to any other http(s) origin is aborted.
 */
export async function installStubApi(page: Page, appOrigin: string): Promise<StubApi> {
  const requests: RecordedRequest[] = [];
  const blocked: string[] = [];
  const behavior: StubBehavior = {
    examples: examplesFixture(),
    grant: grantResponseFixture(5),
    failWith: {},
    closes: () => true,
  };

  function answer(route: Route, endpoint: Endpoint, status: number, body: unknown, url: string, text: string | null): Promise<void> {
    requests.push({
      endpoint,
      method: route.request().method(),
      url,
      headers: route.request().headers(),
      body: jsonBody(text),
      status,
    });
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  }

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return route.continue();

    if (url.origin !== appOrigin) {
      blocked.push(request.url());
      return route.abort('blockedbyclient');
    }

    const endpoint = PATHS[url.pathname];
    if (endpoint === undefined) return route.continue();

    const text = request.postData();
    const expectedMethod = endpoint === 'examples' ? 'GET' : 'POST';
    const full = request.url();
    if (request.method() !== expectedMethod) return answer(route, endpoint, 405, { message: 'Wrong method.' }, full, text);

    const failure = behavior.failWith[endpoint];
    if (failure !== undefined) return answer(route, endpoint, failure, restingBody(), full, text);

    switch (endpoint) {
      case 'examples':
        return answer(route, endpoint, 200, behavior.examples, full, text);
      case 'grant': {
        const wish = jsonBody(text) as { wish?: { text?: unknown } } | null;
        if (typeof wish?.wish?.text !== 'string' || wish.wish.text.trim() === '') {
          return answer(route, endpoint, 400, { message: 'The Paw cannot read that wish.' }, full, text);
        }
        return answer(route, endpoint, 200, behavior.grant, full, text);
      }
      case 'bind': {
        const body = jsonBody(text) as { grant?: unknown; curseId?: unknown; clause?: unknown; kind?: unknown } | null;
        const grant = GrantSchema.safeParse(body?.grant);
        const kind = BindingKindSchema.safeParse(body?.kind);
        if (
          !grant.success ||
          !kind.success ||
          typeof body?.curseId !== 'string' ||
          typeof body.clause !== 'string' ||
          body.clause.trim() === '' ||
          !grant.data.curses.some((curse) => curse.id === body.curseId)
        ) {
          return answer(route, endpoint, 400, { message: 'The Judge cannot read that clause.' }, full, text);
        }
        const closed = behavior.closes(body.curseId, body.clause);
        const response = bindResponseFixture(grant.data, body.curseId, kind.data, body.clause, closed);
        return answer(route, endpoint, 200, response, full, text);
      }
      case 'export': {
        const body = jsonBody(text) as { wish?: unknown; grant?: unknown } | null;
        const wish = WishSchema.safeParse(body?.wish);
        const grant = GrantSchema.safeParse(body?.grant);
        if (!wish.success || !grant.success) {
          return answer(route, endpoint, 400, { message: 'The Judge cannot read that clause.' }, full, text);
        }
        return answer(route, endpoint, 200, exportFixture(wish.data, grant.data), full, text);
      }
    }
  });

  return {
    behavior,
    requests,
    blocked,
    to: (endpoint) => requests.filter((entry) => entry.endpoint === endpoint),
    grantWith: (count) => {
      behavior.grant = grantResponseFixture(count);
    },
  };
}
