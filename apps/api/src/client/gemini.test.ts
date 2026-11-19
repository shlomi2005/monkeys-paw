import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiModelClient } from './gemini';
import type { ModelCallLogEntry } from './gemini';

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
      ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'].map(
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
    expect(body.generationConfig).toEqual({ responseMimeType: 'application/json' });
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

  it('throws the last status when every model is unavailable', async () => {
    const { client, fetchMock } = setup([status(503), status(429), status(404)]);
    await expect(client.generate('x')).rejects.toThrow('model-c: HTTP 404');
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
