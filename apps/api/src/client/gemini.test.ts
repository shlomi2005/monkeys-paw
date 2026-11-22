import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_MODEL,
  GeminiModelClient,
  MAX_ERROR_BODY_BYTES,
  MAX_OUTPUT_TOKENS,
  QuotaExhaustedError,
  quotaScopeOf,
} from './gemini';
import type { AttemptReport, ModelCallLogEntry } from './gemini';

const FAKE_KEY = 'test-key-not-real';
const PROMPT_SECRET = 'prompt-words-that-must-not-leak';
const RESPONSE_SECRET = 'response-words-that-must-not-leak';
const MODELS = ['model-a', 'model-b', 'model-c'];

/** A 200 response carrying `text` as the first candidate's only text part. */
function geminiOk(text: string): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
  });
}

function status(code: number): Response {
  return new Response('{"error":{"message":"details"}}', { status: code });
}

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function setup(responses: Array<Response | (() => Promise<Response>)>) {
  const queue = [...responses];
  const fetchMock: FetchMock = vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra fetch');
    return typeof next === 'function' ? next() : next;
  });
  const logs: ModelCallLogEntry[] = [];
  const client = new GeminiModelClient({
    apiKey: FAKE_KEY,
    models: MODELS,
    timeoutMs: 1000,
    fetch: fetchMock,
    log: (entry) => logs.push(entry),
  });
  return { client, fetchMock, logs };
}

function requestOf(fetchMock: FetchMock, index = 0) {
  const [url, init] = fetchMock.mock.calls[index];
  const headers = new Headers((init as RequestInit).headers);
  return {
    url: String(url),
    headers,
    body: JSON.parse(String((init as RequestInit).body)),
    rawBody: String((init as RequestInit).body),
    signal: (init as RequestInit).signal,
  };
}

describe('GeminiModelClient', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GEMINI_MODEL: process.env.GEMINI_MODEL,
      GEMINI_MODEL_FALLBACKS: process.env.GEMINI_MODEL_FALLBACKS,
      GEMINI_TIMEOUT_MS: process.env.GEMINI_TIMEOUT_MS,
    };
  });

  afterEach(() => {
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value !== undefined) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('starts without a key: not available, generate rejects, fetch is never called (Req 6.2)', async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const client = new GeminiModelClient();
    expect(client.available).toBe(false);
    await expect(client.generate('Task: GRANT_WISH')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a blank key as no key', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new GeminiModelClient({ apiKey: '   ', fetch: fetchMock });
    expect(client.available).toBe(false);
    await expect(client.generate('x')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the key only from GEMINI_API_KEY by default', () => {
    process.env.GEMINI_API_KEY = FAKE_KEY;
    expect(new GeminiModelClient().available).toBe(true);
  });

  it('uses the global fetch by default', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => geminiOk('{"a":1}'));
    vi.stubGlobal('fetch', fetchMock);
    const client = new GeminiModelClient({ apiKey: FAKE_KEY, models: ['model-a'], log: () => {} });
    await expect(client.generate('hi')).resolves.toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the default model chain and GEMINI_MODEL / GEMINI_MODEL_FALLBACKS overrides', async () => {
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL_FALLBACKS;
    const defaults = setup([status(503), status(503), status(503), status(503)]);
    const withDefaults = new GeminiModelClient({
      apiKey: FAKE_KEY,
      fetch: defaults.fetchMock,
      log: () => {},
    });
    await expect(withDefaults.generate('x')).rejects.toThrow();
    expect(defaults.fetchMock.mock.calls.map((_, i) => requestOf(defaults.fetchMock, i).url)).toEqual(
      ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'].map(
        (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,
      ),
    );

    process.env.GEMINI_MODEL = 'custom-a';
    process.env.GEMINI_MODEL_FALLBACKS = 'custom-b, custom-a';
    const custom = setup([status(503), status(503)]);
    const withEnv = new GeminiModelClient({ apiKey: FAKE_KEY, fetch: custom.fetchMock, log: () => {} });
    await expect(withEnv.generate('x')).rejects.toThrow();
    expect(custom.fetchMock).toHaveBeenCalledTimes(2);
    expect(requestOf(custom.fetchMock, 0).url).toContain('/models/custom-a:generateContent');
    expect(requestOf(custom.fetchMock, 1).url).toContain('/models/custom-b:generateContent');
  });

  it('puts the key only in the x-goog-api-key header, never in the URL or the body', async () => {
    const { client, fetchMock } = setup([geminiOk('{"ok":true}')]);
    await client.generate(`Task: GRANT_WISH ${PROMPT_SECRET}`);

    const req = requestOf(fetchMock);
    expect(req.headers.get('x-goog-api-key')).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(req.rawBody).not.toContain(FAKE_KEY);
    expect(req.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/model-a:generateContent',
    );
  });

  it('sends the JSON mime type and the schema that matches the prompt Task', async () => {
    const cases: Array<[string, string]> = [
      ['Task: GRANT_WISH', 'grantWishSchema'],
      ['Task: JUDGE_VERDICT', 'verdictSchema'],
      ['Task: JUDGE_QUALITY', 'qualityGateSchema'],
      ['Task: JUDGE_BATCH_QUALITY', 'batchQualityGateSchema'],
      ['Task: REPLACE_CURSE', 'replaceCurseSchema'],
    ];
    for (const [task, method] of cases) {
      const { client, fetchMock } = setup([geminiOk('{}')]);
      await client.generate(`${task}\nbody`);
      const { body } = requestOf(fetchMock);
      expect(body.contents).toEqual([{ role: 'user', parts: [{ text: `${task}\nbody` }] }]);
      expect(body.generationConfig.responseMimeType).toBe('application/json');
      expect(body.generationConfig.responseSchema).toEqual((client as any)[method]());
    }
  });

  it('sends no schema when the prompt has no known Task', async () => {
    const { client, fetchMock } = setup([geminiOk('{}')]);
    await client.generate('just a prompt');
    const { body } = requestOf(fetchMock);
    expect(body.generationConfig).toEqual({
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'low' },
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
  });

  it('joins the text parts of the first candidate and parses them as JSON', async () => {
    const envelope = {
      candidates: [
        { content: { parts: [{ text: '{"narration":' }, { text: '"granted"}' }] } },
        { content: { parts: [{ text: '{"other":true}' }] } },
      ],
    };
    const { client } = setup([new Response(JSON.stringify(envelope), { status: 200 })]);
    await expect(client.generate('x')).resolves.toEqual({ narration: 'granted' });
  });

  it.each([503, 429, 404])('HTTP %i moves on to the next model', async (code) => {
    const { client, fetchMock, logs } = setup([status(code), geminiOk('{"from":"b"}')]);
    await expect(client.generate('x')).resolves.toEqual({ from: 'b' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestOf(fetchMock, 1).url).toContain('/models/model-b:');
    expect(logs.map((l) => [l.model, l.status, l.ok])).toEqual([
      ['model-a', code, false],
      ['model-b', 200, true],
    ]);
  });

  it('throws the last status when every model is unavailable (no quota answer among them)', async () => {
    const { client, fetchMock } = setup([status(503), status(404), status(503)]);
    await expect(client.generate('x')).rejects.toThrow('model-c: HTTP 503');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('HTTP 400 throws at once without trying the other models', async () => {
    const { client, fetchMock } = setup([status(400)]);
    await expect(client.generate('x')).rejects.toThrow('Model call failed (model-a: HTTP 400)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 500])('HTTP %i throws at once', async (code) => {
    const { client, fetchMock } = setup([status(code)]);
    await expect(client.generate('x')).rejects.toThrow(`HTTP ${code}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes the abort signal to fetch and rejects with "Model call timed out" (Req 6.4)', async () => {
    let seenSignal: AbortSignal | null | undefined;
    const waitsForAbort = () =>
      new Promise<Response>((_resolve, reject) => {
        seenSignal!.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted', 'AbortError')),
        );
      });
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      seenSignal = init?.signal;
      return waitsForAbort();
    });
    const logs: ModelCallLogEntry[] = [];
    const client = new GeminiModelClient({
      apiKey: FAKE_KEY,
      models: MODELS,
      timeoutMs: 20,
      fetch: fetchMock,
      log: (entry) => logs.push(entry),
    });

    await expect(client.generate('x')).rejects.toThrow('Model call timed out');
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal!.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ model: 'model-a', status: 0, ok: false });
  });

  it('reads GEMINI_TIMEOUT_MS when no timeout option is given', async () => {
    process.env.GEMINI_TIMEOUT_MS = '15';
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const client = new GeminiModelClient({ apiKey: FAKE_KEY, fetch: fetchMock, log: () => {} });
    await expect(client.generate('x')).rejects.toThrow('Model call timed out');
  });

  it.each([
    ['no candidates (blocked)', JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })],
    ['an empty candidate', JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] })],
    ['empty parts', JSON.stringify({ candidates: [{ content: { parts: [] } }] })],
    ['a blank text part', JSON.stringify({ candidates: [{ content: { parts: [{ text: '  ' }] } }] })],
  ])('throws on %s', async (_label, payload) => {
    const { client, fetchMock } = setup([new Response(payload, { status: 200 })]);
    await expect(client.generate('x')).rejects.toThrow('no text returned');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws when the text is not JSON, without echoing it', async () => {
    const { client } = setup([geminiOk(`not json ${RESPONSE_SECRET}`)]);
    const error = await client.generate('x').catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(RESPONSE_SECRET);
  });

  it('wraps a network failure without its cause', async () => {
    const { client } = setup([
      () => Promise.reject(new TypeError(`fetch failed ${FAKE_KEY} ${RESPONSE_SECRET}`)),
    ]);
    const error = (await client.generate('x').catch((e: Error) => e)) as Error;
    expect(error.message).toBe('Model call failed (model-a: no response)');
  });

  it('logs one metadata line per HTTP attempt', async () => {
    const { client, logs } = setup([status(503), geminiOk('{"a":1}')]);
    await client.generate('x');
    expect(logs).toHaveLength(2);
    for (const entry of logs) {
      expect(Object.keys(entry).sort()).toEqual(['event', 'model', 'ms', 'ok', 'status']);
      expect(entry.event).toBe('model_call');
      expect(typeof entry.ms).toBe('number');
    }
  });

  it('writes the default log as one JSON line on stdout', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const fetchMock = vi.fn<typeof fetch>(async () => geminiOk('{}'));
      const client = new GeminiModelClient({ apiKey: FAKE_KEY, models: ['model-a'], fetch: fetchMock });
      await client.generate('x');
      const lines = write.mock.calls.map((c) => String(c[0]));
      expect(lines).toHaveLength(1);
      expect(lines[0].endsWith('\n')).toBe(true);
      expect(JSON.parse(lines[0])).toMatchObject({ event: 'model_call', model: 'model-a', status: 200, ok: true });
    } finally {
      write.mockRestore();
    }
  });

  it('no log line and no error message contains the key, the prompt or the response text', async () => {
    const prompt = `Task: GRANT_WISH ${PROMPT_SECRET}`;
    const scenarios: Array<Array<Response | (() => Promise<Response>)>> = [
      [geminiOk(`{"a":"${RESPONSE_SECRET}"}`)],
      [status(503), status(429), status(404)],
      [status(400)],
      [new Response(JSON.stringify({ candidates: [] }), { status: 200 })],
      [geminiOk(`not json ${RESPONSE_SECRET}`)],
      [new Response(`garbage ${RESPONSE_SECRET}`, { status: 200 })],
      [() => Promise.reject(new Error(`boom ${FAKE_KEY} ${PROMPT_SECRET}`))],
    ];
    const texts: string[] = [];
    for (const responses of scenarios) {
      const { client, logs } = setup(responses);
      try {
        await client.generate(prompt);
      } catch (err) {
        texts.push(String((err as Error).message), String((err as Error).stack ?? ''));
      }
      texts.push(JSON.stringify(logs));
    }
    for (const text of texts) {
      expect(text).not.toContain(FAKE_KEY);
      expect(text).not.toContain(PROMPT_SECRET);
      expect(text).not.toContain(RESPONSE_SECRET);
    }
  });
});

describe('Task 101: Gemini structured output schemas', () => {
  /** Helper to get private schema methods via reflection */
  function getSchema(client: GeminiModelClient, methodName: string): any {
    return (client as any)[methodName]();
  }

  it('grant wish schema has required properties and curse type enum', () => {
    const client = new GeminiModelClient({ apiKey: FAKE_KEY });
    const schema = getSchema(client, 'grantWishSchema');

    // Top-level required fields
    expect([...schema.required].sort()).toEqual(['curses', 'narration', 'userStory', 'wishCriterion']);
    expect(Object.keys(schema.properties).sort()).toEqual([
      'curses',
      'narration',
      'userStory',
      'wishCriterion',
    ]);
    expect(schema.properties.wishCriterion).toEqual({ type: 'string' });

    // Curse array items
    const curseItems = schema.properties.curses.items;
    expect([...curseItems.required].sort()).toEqual(['loophole', 'story', 'type']);
    expect(curseItems.properties.id).toBeUndefined();

    // Curse type enum includes all 10 taxonomy tags
    const typeEnum = curseItems.properties.type.enum;
    const expectedTags = [
      'permissions',
      'time',
      'money',
      'scale',
      'abuse',
      'privacy',
      'accessibility',
      'data-loss',
      'concurrency',
      'edge-input',
    ];
    for (const tag of expectedTags) {
      expect(typeEnum).toContain(tag);
    }
    expect(typeEnum).toHaveLength(10);
  });

  it('verdict schema has required properties', () => {
    const client = new GeminiModelClient({ apiKey: FAKE_KEY });
    const schema = getSchema(client, 'verdictSchema');

    expect([...schema.required].sort()).toEqual(['closed', 'property', 'reason']);
    expect(Object.keys(schema.properties).sort()).toEqual(['closed', 'property', 'reason']);
  });

  it('quality gate schema has required properties', () => {
    const client = new GeminiModelClient({ apiKey: FAKE_KEY });
    const schema = getSchema(client, 'qualityGateSchema');

    expect(schema.required).toContain('specific');
    expect(schema.required).toContain('reason');
  });

  it('batch quality gate schema is array of required properties', () => {
    const client = new GeminiModelClient({ apiKey: FAKE_KEY });
    const schema = getSchema(client, 'batchQualityGateSchema');

    expect(schema.type).toBe('array');
    const itemSchema = schema.items;
    expect(itemSchema.required).toContain('curseId');
    expect(itemSchema.required).toContain('specific');
    expect(itemSchema.required).toContain('reason');
  });

  it('replace curse schema has required properties and type enum', () => {
    const client = new GeminiModelClient({ apiKey: FAKE_KEY });
    const schema = getSchema(client, 'replaceCurseSchema');

    expect([...schema.required].sort()).toEqual(['loophole', 'story', 'type']);
    expect(schema.properties.id).toBeUndefined();

    // Type enum includes all 10 taxonomy tags
    const typeEnum = schema.properties.type.enum;
    const expectedTags = [
      'permissions',
      'time',
      'money',
      'scale',
      'abuse',
      'privacy',
      'accessibility',
      'data-loss',
      'concurrency',
      'edge-input',
    ];
    for (const tag of expectedTags) {
      expect(typeEnum).toContain(tag);
    }
    expect(typeEnum).toHaveLength(10);
  });
});

/** A 200 response with usage and a model version, as the real API sends them. */
function geminiWithUsage(
  text: string,
  extra: { finishReason?: string; usageMetadata?: unknown; modelVersion?: string } = {},
): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        { content: { parts: [{ text }] }, ...(extra.finishReason ? { finishReason: extra.finishReason } : {}) },
      ],
      ...(extra.usageMetadata !== undefined ? { usageMetadata: extra.usageMetadata } : {}),
      ...(extra.modelVersion ? { modelVersion: extra.modelVersion } : {}),
    }),
    { status: 200 },
  );
}

describe('request shape (paw-api task 103)', () => {
  it('the default model is gemini-3.6-flash, and MAX_OUTPUT_TOKENS is 4096, not above 8192', () => {
    expect(DEFAULT_MODEL).toBe('gemini-3.6-flash');
    expect(MAX_OUTPUT_TOKENS).toBe(4096);
    expect(MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(8192);
  });

  it.each([
    'Task: GRANT_WISH',
    'Task: JUDGE_VERDICT',
    'Task: JUDGE_QUALITY',
    'Task: JUDGE_BATCH_QUALITY',
    'Task: REPLACE_CURSE',
    'no known task',
  ])('%s: thinkingLevel is low and maxOutputTokens is MAX_OUTPUT_TOKENS', async (task) => {
    const { client, fetchMock } = setup([geminiOk('{}')]);
    await client.generate(`${task}\nbody`);
    const { generationConfig } = requestOf(fetchMock).body;
    expect(generationConfig.thinkingConfig.thinkingLevel).toBe('low');
    expect(generationConfig.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
  });

  it('the same on a fallback attempt', async () => {
    const { client, fetchMock } = setup([status(503), geminiOk('{}')]);
    await client.generate('Task: GRANT_WISH');
    for (const index of [0, 1]) {
      const { generationConfig } = requestOf(fetchMock, index).body;
      expect(generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
      expect(generationConfig.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
    }
    expect(requestOf(fetchMock, 1).url).toContain('/models/model-b:');
  });
});

describe('plan (paw-api task 104)', () => {
  it('has one entry per model of the chain, in order, with the input estimate and the output cap', () => {
    const { client, fetchMock } = setup([]);
    const prompt = 'Task: GRANT_WISH ' + 'x'.repeat(100);
    const schemaLength = JSON.stringify((client as any).grantWishSchema()).length;

    const plan = client.plan(prompt);

    expect(plan).toEqual(
      MODELS.map((model) => ({
        model,
        inputTokens: Math.ceil((prompt.length + schemaLength) / 3),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      })),
    );
    expect(fetchMock).not.toHaveBeenCalled(); // pure: no I/O
  });

  it('counts no schema when the prompt has no known Task', () => {
    const { client } = setup([]);
    expect(client.plan('abcd')[0].inputTokens).toBe(2); // ceil(4 / 3)
    expect(client.plan('')[0].inputTokens).toBe(0);
  });

  it('needs no key, and follows the deduplicated chain', () => {
    const client = new GeminiModelClient({ apiKey: '', models: ['a', ' b ', 'a', ''] });
    expect(client.available).toBe(false);
    expect(client.plan('x').map((p) => p.model)).toEqual(['a', 'b']);
  });
});

describe('generateMetered (paw-api task 104)', () => {
  const USAGE = { promptTokenCount: 100, candidatesTokenCount: 30, thoughtsTokenCount: 12 };

  it('reports usage as prompt tokens and candidates + thoughts, and copies modelVersion', async () => {
    const { client } = setup([
      geminiWithUsage('{"a":1}', { usageMetadata: USAGE, modelVersion: 'model-a-001', finishReason: 'STOP' }),
    ]);
    const reports: AttemptReport[] = [];
    await expect(client.generateMetered('x', (r) => reports.push(r))).resolves.toEqual({ a: 1 });
    expect(reports).toEqual([
      {
        model: 'model-a',
        inputTokens: 1,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        modelVersion: 'model-a-001',
        usage: { promptTokens: 100, outputTokens: 42 },
      },
    ]);
  });

  it('counts a missing candidates or thoughts count as 0', async () => {
    const { client } = setup([
      geminiWithUsage('{}', { usageMetadata: { promptTokenCount: 7 } }),
      geminiWithUsage('{}', { usageMetadata: { promptTokenCount: 7, thoughtsTokenCount: 5 } }),
    ]);
    const reports: AttemptReport[] = [];
    await client.generateMetered('x', (r) => reports.push(r));
    await client.generateMetered('x', (r) => reports.push(r));
    expect(reports.map((r) => r.usage)).toEqual([
      { promptTokens: 7, outputTokens: 0 },
      { promptTokens: 7, outputTokens: 5 },
    ]);
    expect(reports[0].modelVersion).toBeUndefined();
  });

  it.each([
    ['no usageMetadata', undefined],
    ['usageMetadata that is not an object', 'many'],
    ['no promptTokenCount', { candidatesTokenCount: 5 }],
    ['a negative promptTokenCount', { promptTokenCount: -1, candidatesTokenCount: 5 }],
    ['a promptTokenCount that is not a number', { promptTokenCount: '5' }],
    ['a promptTokenCount that is not finite', { promptTokenCount: null }],
  ])('has no usage for %s', async (_label, usageMetadata) => {
    const { client } = setup([geminiWithUsage('{}', { usageMetadata })]);
    const reports: AttemptReport[] = [];
    await client.generateMetered('x', (r) => reports.push(r));
    expect(reports).toHaveLength(1);
    expect('usage' in reports[0]).toBe(false);
  });

  const SCENARIOS: Array<[string, Array<Response | (() => Promise<Response>)>, number, boolean]> = [
    ['success', [geminiOk('{}')], 1, true],
    ['HTTP 503 then success', [status(503), geminiOk('{}')], 2, true],
    ['503, 429 and 404 until the chain is exhausted', [status(503), status(429), status(404)], 3, false],
    ['HTTP 400', [status(400)], 1, false],
    ['HTTP 500', [status(500)], 1, false],
    ['a network error', [() => Promise.reject(new TypeError('boom'))], 1, false],
    ['an unreadable body', [new Response('garbage', { status: 200 })], 1, false],
    ['a body that fails while it is read', [
      () => {
        const failing = new ReadableStream({ start: (c) => c.error(new Error('broken pipe')) });
        return Promise.resolve(new Response(failing, { status: 200 }));
      },
    ], 1, false],
    ['no candidates', [new Response('{}', { status: 200 })], 1, false],
    ['text that is not JSON', [geminiOk('nope')], 1, false],
    ['MAX_TOKENS', [geminiWithUsage('{"a"', { finishReason: 'MAX_TOKENS', usageMetadata: USAGE })], 1, false],
    ['cut-off JSON', [geminiWithUsage('{"a": "cut', { finishReason: 'STOP', usageMetadata: USAGE })], 1, false],
  ];

  it.each(SCENARIOS)('%s: exactly one report per HTTP attempt', async (_label, responses, attempts, succeeds) => {
    const { client, fetchMock } = setup(responses);
    const reports: AttemptReport[] = [];
    const outcome = await client.generateMetered('x', (r) => reports.push(r)).then(
      () => 'ok',
      () => 'error',
    );
    expect(outcome).toBe(succeeds ? 'ok' : 'error');
    expect(fetchMock).toHaveBeenCalledTimes(attempts);
    expect(reports.map((r) => r.model)).toEqual(MODELS.slice(0, attempts));
  });

  it('reports a timeout once, with no usage', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const client = new GeminiModelClient({ apiKey: FAKE_KEY, models: MODELS, timeoutMs: 10, fetch: fetchMock, log: () => {} });
    const reports: AttemptReport[] = [];
    await expect(client.generateMetered('x', (r) => reports.push(r))).rejects.toThrow('timed out');
    expect(reports).toHaveLength(1);
    expect('usage' in reports[0]).toBe(false);
  });

  it('reports each attempt before the next one starts and before the promise settles', async () => {
    const events: string[] = [];
    const queue = [status(503), status(429), geminiOk('{}')];
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      events.push(`fetch ${String(url).split('/models/')[1].split(':')[0]}`);
      return queue.shift()!;
    });
    const client = new GeminiModelClient({ apiKey: FAKE_KEY, models: MODELS, fetch: fetchMock, log: () => {} });

    await client.generateMetered('x', (r) => events.push(`report ${r.model}`));
    events.push('settled');

    expect(events).toEqual([
      'fetch model-a',
      'report model-a',
      'fetch model-b',
      'report model-b',
      'fetch model-c',
      'report model-c',
      'settled',
    ]);

    const failing = new GeminiModelClient({
      apiKey: FAKE_KEY,
      models: ['model-a'],
      fetch: vi.fn<typeof fetch>(async () => status(400)),
      log: () => {},
    });
    const order: string[] = [];
    await failing.generateMetered('x', () => order.push('report')).catch(() => order.push('rejected'));
    expect(order).toEqual(['report', 'rejected']);
  });

  it('reports nothing without a key: no HTTP attempt was made', async () => {
    const client = new GeminiModelClient({ apiKey: '', models: MODELS, fetch: vi.fn<typeof fetch>() });
    const onAttempt = vi.fn();
    await expect(client.generateMetered('x', onAttempt)).rejects.toThrow();
    expect(onAttempt).not.toHaveBeenCalled();
  });

  it('generate keeps working with no listener', async () => {
    const { client } = setup([geminiWithUsage('{"a":1}', { usageMetadata: USAGE })]);
    await expect(client.generate('x')).resolves.toEqual({ a: 1 });
  });
});

describe('MAX_TOKENS and cut-off JSON (paw-api task 103)', () => {
  const USAGE = { promptTokenCount: 100, candidatesTokenCount: 3000, thoughtsTokenCount: 996 };

  it('a 200 with finishReason MAX_TOKENS and cut-off JSON rejects, reports one attempt with its usage, and does not try the next model', async () => {
    const { client, fetchMock, logs } = setup([
      geminiWithUsage('{"narration": "The pa', { finishReason: 'MAX_TOKENS', usageMetadata: USAGE }),
      geminiOk('{"from":"b"}'),
    ]);
    const reports: AttemptReport[] = [];

    await expect(client.generateMetered('x', (r) => reports.push(r))).rejects.toThrow(
      'Model call failed (model-a: output cut off)',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reports).toHaveLength(1);
    expect(reports[0].usage).toEqual({ promptTokens: 100, outputTokens: 3996 });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ model: 'model-a', status: 200, ok: false, finishReason: 'MAX_TOKENS' });
  });

  it('MAX_TOKENS with empty text is also a cut-off, not "no text returned"', async () => {
    const { client } = setup([geminiWithUsage('', { finishReason: 'MAX_TOKENS', usageMetadata: USAGE })]);
    await expect(client.generate('x')).rejects.toThrow('output cut off');
  });

  it('text that is not complete JSON, with a normal finish reason, is a failed attempt too', async () => {
    const { client, fetchMock } = setup([
      geminiWithUsage('{"narration": "cut', { finishReason: 'STOP', usageMetadata: USAGE }),
      geminiOk('{}'),
    ]);
    await expect(client.generate('x')).rejects.toThrow('model-a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('the model_call log line (paw-api task 103)', () => {
  it('adds promptTokens, outputTokens and finishReason, as numbers and an enum, when the response has them', async () => {
    const { client, logs } = setup([
      geminiWithUsage(`{"a":"${RESPONSE_SECRET}"}`, {
        finishReason: 'STOP',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30, thoughtsTokenCount: 12 },
        modelVersion: 'model-a-001',
      }),
    ]);
    await client.generate(`Task: GRANT_WISH ${PROMPT_SECRET}`);

    expect(logs).toHaveLength(1);
    expect(Object.keys(logs[0]).sort()).toEqual(
      ['event', 'finishReason', 'model', 'ms', 'ok', 'outputTokens', 'promptTokens', 'status'],
    );
    expect(logs[0]).toMatchObject({ promptTokens: 100, outputTokens: 42, finishReason: 'STOP', ok: true });
    expect(JSON.stringify(logs)).not.toContain(RESPONSE_SECRET);
    expect(JSON.stringify(logs)).not.toContain(PROMPT_SECRET);
    expect(JSON.stringify(logs)).not.toContain(FAKE_KEY);
  });

  it('logs OTHER for a finishReason that is not on the list of Gemini finish reasons', async () => {
    for (const reason of [`free text ${RESPONSE_SECRET}`, 'SHOUTED_USER_TEXT', 'stop']) {
      const { client, logs } = setup([geminiWithUsage('{}', { finishReason: reason })]);
      await client.generate('x');
      expect(logs[0].finishReason).toBe('OTHER');
      expect(JSON.stringify(logs)).not.toContain(RESPONSE_SECRET);
    }
  });

  it('logs a token count only as a safe integer from 0 to 1000000, and charges the report unchanged', async () => {
    const odd = { promptTokenCount: 12345678, candidatesTokenCount: 1.5, thoughtsTokenCount: 0 };
    const { client, logs } = setup([geminiWithUsage('{}', { usageMetadata: odd })]);
    const reports: AttemptReport[] = [];
    await client.generateMetered('x', (report) => reports.push(report));
    expect('promptTokens' in logs[0]).toBe(false);
    expect('outputTokens' in logs[0]).toBe(false);
    expect(reports[0].usage).toEqual({ promptTokens: 12345678, outputTokens: 1.5 });
  });

  it('logs status 0 for a status that is not an integer from 100 to 599', async () => {
    for (const bad of [99, 600, 200.5, 'abc']) {
      const logs: ModelCallLogEntry[] = [];
      const fake = vi.fn<typeof fetch>(async () => ({ status: bad }) as unknown as Response);
      const client = new GeminiModelClient({ apiKey: FAKE_KEY, models: ['model-a'], fetch: fake, log: (e) => logs.push(e) });
      await expect(client.generate('x')).rejects.toThrow();
      expect(logs[0].status).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Free tier: quota answers (paw-api task 113, Requirement 13)
// ---------------------------------------------------------------------------

const BODY_SECRET = 'error-body-words-that-must-not-leak';

/** One `google.rpc.QuotaFailure` violation. */
const violation = (quotaId: string, quotaDimensions?: Record<string, unknown>) => ({
  quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
  quotaId,
  ...(quotaDimensions ? { quotaDimensions } : {}),
});

const PER_MODEL = violation('GenerateRequestsPerDayPerProjectPerModel-FreeTier', {
  location: 'global',
  model: 'model-a',
});
const PER_PROJECT = violation('GenerateRequestsPerDayPerProject-FreeTier', { location: 'global' });

/** The error body of a quota answer, field names as in `google.rpc.QuotaFailure`. */
function quotaBody(violations: unknown[], errorStatus = 'RESOURCE_EXHAUSTED'): unknown {
  return {
    error: {
      code: 429,
      status: errorStatus,
      message: BODY_SECRET,
      details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations }],
    },
  };
}

function answer(code: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: code });
}

describe('quotaScopeOf (paw-api task 113, Req 13.3)', () => {
  const failure = (violations: unknown[]) => ({
    '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
    violations,
  });
  const bodyOf = (...details: unknown[]) => ({ error: { status: 'RESOURCE_EXHAUSTED', details } });

  it('is shared for a per-project quota with no model dimension', () => {
    expect(quotaScopeOf(bodyOf(failure([PER_PROJECT])))).toBe('shared');
  });

  it('is shared when every violation of every QuotaFailure entry is per-project', () => {
    const second = violation('GenerateContentInputTokensPerMinutePerProject-FreeTier', { location: 'global' });
    expect(quotaScopeOf(bodyOf(failure([PER_PROJECT]), { '@type': 'other' }, failure([second])))).toBe('shared');
  });

  it('accepts the body as a JSON string too', () => {
    expect(quotaScopeOf(JSON.stringify(bodyOf(failure([PER_PROJECT]))))).toBe('shared');
    expect(quotaScopeOf('not json')).toBe('per-model');
  });

  it.each([
    ['a per-model quota that names the model', bodyOf(failure([PER_MODEL]))],
    ['PerProject and PerModel in one id', bodyOf(failure([violation('PerProjectPerModel', { location: 'global' })]))],
    ['a per-project id with a model dimension', bodyOf(failure([violation('GenerateRequestsPerDayPerProject', { model: 'm' })]))],
    ['a violation with no quotaDimensions', bodyOf(failure([violation('GenerateRequestsPerDayPerProject')]))],
    ['a violation with no quotaId', bodyOf(failure([{ quotaDimensions: { location: 'global' } }]))],
    ['a quotaId that is not per-project', bodyOf(failure([violation('GenerateRequestsPerMinute', { location: 'global' })]))],
    ['one shared and one per-model violation', bodyOf(failure([PER_PROJECT, PER_MODEL]))],
    ['a violation that is not an object', bodyOf(failure(['PerProject']))],
    ['no violation', bodyOf(failure([]))],
    ['a detail that is not a QuotaFailure', bodyOf({ '@type': 'type.googleapis.com/google.rpc.Help', violations: [PER_PROJECT] })],
    ['no details', { error: { status: 'RESOURCE_EXHAUSTED' } }],
    ['details that is not an array', { error: { details: 'x' } }],
    ['an error that is not an object', { error: 'x' }],
    ['null', null],
    ['undefined', undefined],
    ['a number', 429],
  ])('is per-model for %s', (_label, body) => {
    expect(quotaScopeOf(body)).toBe('per-model');
  });
});

describe('GeminiModelClient quota answers (paw-api task 113, Req 13.1-13.4)', () => {
  it('a per-model 429 on the primary tries the next model: two calls, and a success succeeds', async () => {
    const { client, fetchMock, logs } = setup([answer(429, quotaBody([PER_MODEL])), geminiOk('{"from":"b"}')]);
    const reports: AttemptReport[] = [];
    await expect(client.generateMetered('x', (r) => reports.push(r))).resolves.toEqual({ from: 'b' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestOf(fetchMock, 1).url).toContain('/models/model-b:');
    expect(reports.map((r) => [r.model, r.quota])).toEqual([
      ['model-a', true],
      ['model-b', undefined],
    ]);
    expect(logs.map((l) => [l.status, l.ok])).toEqual([[429, false], [200, true]]);
  });

  it('a per-project 429 stops the chain after one attempt and throws QuotaExhaustedError', async () => {
    const { client, fetchMock } = setup([answer(429, quotaBody([PER_PROJECT]))]);
    const reports: AttemptReport[] = [];
    const error = await client.generateMetered('x', (r) => reports.push(r)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QuotaExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reports).toHaveLength(1);
    expect(reports[0].quota).toBe(true);
  });

  it('a per-project quota ends the chain after a first attempt that was not a quota answer too', async () => {
    const { client, fetchMock } = setup([status(503), answer(429, quotaBody([PER_PROJECT]))]);
    await expect(client.generate('x')).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(2); // model-c is never tried
  });

  it('429 on every model throws QuotaExhaustedError with a fixed message, after trying them all', async () => {
    const { client, fetchMock } = setup(MODELS.map(() => answer(429, quotaBody([PER_MODEL]))));
    const reports: AttemptReport[] = [];
    const error = await client.generateMetered('x', (r) => reports.push(r)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QuotaExhaustedError);
    expect((error as Error).name).toBe('QuotaExhaustedError');
    expect((error as Error).message).toBe(new QuotaExhaustedError().message);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(reports.every((r) => r.quota === true)).toBe(true);
  });

  it('a 429 on one model and another failure on the rest still ends as a quota answer', async () => {
    const { client } = setup([answer(429, quotaBody([PER_MODEL])), status(503), status(404)]);
    await expect(client.generate('x')).rejects.toBeInstanceOf(QuotaExhaustedError);
  });

  it.each([
    ['an unreadable body', 'this is not json'],
    ['an empty body', ''],
    ['no violation', quotaBody([])],
    ['a body with no error', {}],
  ])('a 429 with %s tries the next model and counts as a quota attempt', async (_label, body) => {
    const { client, fetchMock } = setup([answer(429, body), geminiOk('{"from":"b"}')]);
    const reports: AttemptReport[] = [];
    await expect(client.generateMetered('x', (r) => reports.push(r))).resolves.toEqual({ from: 'b' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reports[0].quota).toBe(true);
  });

  it.each([403, 503, 400, 500])(
    'RESOURCE_EXHAUSTED in the body of an HTTP %i is a quota attempt',
    async (code) => {
      const { client, fetchMock } = setup([answer(code, quotaBody([PER_MODEL])), geminiOk('{"from":"b"}')]);
      const reports: AttemptReport[] = [];
      await expect(client.generateMetered('x', (r) => reports.push(r))).resolves.toEqual({ from: 'b' });
      expect(fetchMock).toHaveBeenCalledTimes(2); // even a 400, 403 or 500 moves on: it is a per-model quota
      expect(reports[0].quota).toBe(true);
    },
  );

  it('RESOURCE_EXHAUSTED with status 403 on every model throws QuotaExhaustedError', async () => {
    const { client } = setup(MODELS.map(() => answer(403, quotaBody([PER_MODEL]))));
    await expect(client.generate('x')).rejects.toBeInstanceOf(QuotaExhaustedError);
  });

  it('a shared quota in the body of a 403 stops the chain too', async () => {
    const { client, fetchMock } = setup([answer(403, quotaBody([PER_PROJECT]))]);
    await expect(client.generate('x')).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a 403 without RESOURCE_EXHAUSTED still throws at once with its own error', async () => {
    const { client, fetchMock } = setup([answer(403, { error: { status: 'PERMISSION_DENIED', message: BODY_SECRET } })]);
    const reports: AttemptReport[] = [];
    const error = await client.generateMetered('x', (r) => reports.push(r)).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(QuotaExhaustedError);
    expect((error as Error).message).toBe('Model call failed (model-a: HTTP 403)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reports[0].quota).toBeUndefined();
  });

  it('a 500 still throws its own error, even when the body is large, and is no quota attempt', async () => {
    const { client, fetchMock } = setup([answer(500, 'x'.repeat(200_000))]);
    const reports: AttemptReport[] = [];
    await expect(client.generateMetered('x', (r) => reports.push(r))).rejects.toThrow('Model call failed (model-a: HTTP 500)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reports[0].quota).toBeUndefined();
  });

  it('503 and 404 without a quota body are not quota attempts', async () => {
    const { client } = setup([status(503), status(404), status(503)]);
    const reports: AttemptReport[] = [];
    await expect(client.generateMetered('x', (r) => reports.push(r))).rejects.toThrow('HTTP 503');
    expect(reports.map((r) => r.quota)).toEqual([undefined, undefined, undefined]);
  });

  it('a body over 64 KB is cut at 64 KB and does not hang', async () => {
    let pulled = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(16 * 1024).fill(32));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { client, fetchMock } = setup([new Response(endless, { status: 429 }), geminiOk('{"from":"b"}')]);
    await expect(client.generate('x')).resolves.toEqual({ from: 'b' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cancelled).toBe(true);
    expect(pulled * 16 * 1024).toBeLessThanOrEqual(MAX_ERROR_BODY_BYTES + 3 * 16 * 1024);
  });

  it('reads no more than 64 KB: a quota verdict that sits after the cut is not seen', async () => {
    const padding = ' '.repeat(MAX_ERROR_BODY_BYTES + 10);
    const { client, fetchMock } = setup([answer(403, `${padding}${JSON.stringify(quotaBody([PER_MODEL]))}`)]);
    // The body is cut, so the RESOURCE_EXHAUSTED is not seen and the 403 keeps its own error.
    await expect(client.generate('x')).rejects.toThrow('HTTP 403');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a body that never arrives is given up on at the timeout: the 429 tries the next model', async () => {
    const hanging = new ReadableStream<Uint8Array>({ start() {} });
    const queue: Array<Response> = [new Response(hanging, { status: 429 }), geminiOk('{"from":"b"}')];
    const fetchMock = vi.fn<typeof fetch>(async () => queue.shift()!);
    const client = new GeminiModelClient({
      apiKey: FAKE_KEY,
      models: MODELS,
      timeoutMs: 30,
      fetch: fetchMock,
      log: () => {},
    });
    await expect(client.generate('x')).resolves.toEqual({ from: 'b' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a body that fails while it is read is an unreadable body', async () => {
    const failing = new ReadableStream<Uint8Array>({ start: (c) => c.error(new Error(BODY_SECRET)) });
    const { client } = setup([new Response(failing, { status: 429 }), geminiOk('{"from":"b"}')]);
    await expect(client.generate('x')).resolves.toEqual({ from: 'b' });
  });

  it('the key and the error body never reach a log line, a report or an error message', async () => {
    const scenarios: Array<Array<Response | (() => Promise<Response>)>> = [
      [answer(429, quotaBody([PER_PROJECT]))],
      MODELS.map(() => answer(429, quotaBody([PER_MODEL]))),
      [answer(403, quotaBody([PER_MODEL])), answer(500, `${BODY_SECRET} ${FAKE_KEY}`)],
      [answer(500, `${BODY_SECRET} ${FAKE_KEY}`)],
      [answer(429, `${BODY_SECRET} ${FAKE_KEY}`), status(503), status(404)],
    ];
    const texts: string[] = [];
    for (const responses of scenarios) {
      const { client, logs } = setup(responses);
      const reports: AttemptReport[] = [];
      try {
        await client.generateMetered('x', (r) => reports.push(r));
      } catch (err) {
        texts.push(String((err as Error).message), String((err as Error).stack ?? ''));
      }
      texts.push(JSON.stringify(logs), JSON.stringify(reports));
    }
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text).not.toContain(FAKE_KEY);
      expect(text).not.toContain(BODY_SECRET);
    }
  });

  it('the default log writes no body either', async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    try {
      const fetchMock = vi.fn<typeof fetch>(async () => answer(429, quotaBody([PER_PROJECT])));
      const client = new GeminiModelClient({ apiKey: FAKE_KEY, models: MODELS, fetch: fetchMock });
      await expect(client.generate('x')).rejects.toBeInstanceOf(QuotaExhaustedError);
    } finally {
      vi.restoreAllMocks();
    }
    expect(writes.join('')).toContain('"event":"model_call"');
    expect(writes.join('')).not.toContain(BODY_SECRET);
    expect(writes.join('')).not.toContain(FAKE_KEY);
  });
});
