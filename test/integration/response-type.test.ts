import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { create, PROBLEM_CODE, type RefetchInstance } from '../../src/index';
import { asError, asOk } from '../helpers/assert';
import { type EchoPayload, startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;
let api: RefetchInstance;

beforeAll(async () => {
  server = await startTestServer();
  api = create({ baseURL: server.baseURL });
});

afterAll(() => server.close());

beforeEach(() => server.resetHits());

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe('responseType', () => {
  it("'json' parses JSON served with a non-JSON content type", async () => {
    const auto = asOk(await api.get('/text-json'));
    expect(auto.data).toBe('{"a":1}');

    const forced = asOk(
      await api.get<{ a: number }>('/text-json', undefined, { responseType: 'json' }),
    );
    expect(forced.data).toEqual({ a: 1 });
  });

  it("'json' reports a body that is not JSON as a parse error with the raw text", async () => {
    const response = asError(await api.get('/text', undefined, { responseType: 'json' }));
    expect(response.problem).toBe(PROBLEM_CODE.PARSE_ERROR);
    expect(response.error.kind).toBe('parse');
    expect(response.data).toBe('hello');
    expect(response.status).toBe(200);
  });

  it("'text' returns JSON unparsed", async () => {
    const response = asOk(await api.get<string>('/json', undefined, { responseType: 'text' }));
    expect(response.data).toBe('{"ok":true}');
  });

  it("'blob' returns a Blob", async () => {
    const response = asOk(await api.get<Blob>('/json', undefined, { responseType: 'blob' }));
    expect(response.data).toBeInstanceOf(Blob);
    expect(await response.data.text()).toBe('{"ok":true}');
  });

  it("'arrayBuffer' returns an ArrayBuffer", async () => {
    const response = asOk(
      await api.get<ArrayBuffer>('/text', undefined, { responseType: 'arrayBuffer' }),
    );
    expect(response.data).toBeInstanceOf(ArrayBuffer);
    expect(response.data.byteLength).toBe(5);
  });

  it("'bytes' returns a Uint8Array", async () => {
    const response = asOk(await api.get<Uint8Array>('/png', undefined, { responseType: 'bytes' }));
    expect(response.data).toBeInstanceOf(Uint8Array);
    expect(response.data[0]).toBe(0x89);
    expect(response.data.byteLength).toBe(8);
  });

  it("'none' skips reading the body", async () => {
    const response = asOk(await api.get('/json', undefined, { responseType: 'none' }));
    expect(response.data).toBeNull();
    expect(response.status).toBe(200);
  });

  it("'stream' returns the body stream through the normal pipeline", async () => {
    const local = create({ baseURL: server.baseURL });
    const interceptor = vi.fn((response) => response);
    const monitor = vi.fn();
    local.interceptors.response.use(interceptor);
    local.addMonitor(monitor);

    const response = asOk(
      await local.post<ReadableStream<Uint8Array>>('/stream', { q: 1 }, { responseType: 'stream' }),
    );

    expect(response.data).toBeInstanceOf(ReadableStream);
    expect(response.request?.method).toBe('POST');
    expect(interceptor).toHaveBeenCalledTimes(1);
    expect(monitor).toHaveBeenCalledTimes(1);
    expect(await readAll(response.data)).toBe('chunk1chunk2');
  });

  it("'stream' is not cut off by the request timeout once headers have arrived", async () => {
    const response = asOk(
      await api.get<ReadableStream<Uint8Array>>(
        '/slow-body',
        { ms: 120 },
        { responseType: 'stream', timeout: 60 },
      ),
    );
    expect(await readAll(response.data)).toBe('{"partial":true}');
  });

  it("'stream' stays linked to the caller's signal after headers", async () => {
    const controller = new AbortController();
    const response = asOk(
      await api.get<ReadableStream<Uint8Array>>(
        '/slow-body',
        { ms: 2000 },
        { responseType: 'stream', signal: controller.signal },
      ),
    );
    const reading = readAll(response.data);
    controller.abort();
    await expect(reading).rejects.toThrow();
  });

  it("'stream' still parses an error body so the failure is readable", async () => {
    const response = asError(await api.get('/status/404', undefined, { responseType: 'stream' }));
    expect(response.error.kind).toBe('http');
    expect(response.data).toEqual({ status: 404 });
  });

  it("'auto' hands back text/event-stream as a stream instead of buffering it", async () => {
    const response = asOk(await api.get<ReadableStream<Uint8Array>>('/sse'));
    expect(response.data).toBeInstanceOf(ReadableStream);
    expect(await readAll(response.data)).toBe('data: one\n\ndata: two\n\n');
  });

  it('can be set as an instance default and overridden per request', async () => {
    const local = create({ baseURL: server.baseURL, responseType: 'text' });
    expect(asOk(await local.get('/json')).data).toBe('{"ok":true}');
    expect(asOk(await local.get('/json', undefined, { responseType: 'auto' })).data).toEqual({
      ok: true,
    });
  });

  it('sets Accept to */* for non-JSON types unless the caller set one', async () => {
    const echo = async (config: Parameters<RefetchInstance['get']>[2]) =>
      (JSON.parse(asOk(await api.get<string>('/echo', undefined, config)).data) as EchoPayload)
        .headers.accept;

    expect(await echo({ responseType: 'text' })).toBe('*/*');
    expect(await echo({ responseType: 'text', headers: { Accept: 'text/csv' } })).toBe('text/csv');

    const json = asOk(await api.get<EchoPayload>('/echo', undefined, { responseType: 'json' }));
    expect(json.data.headers.accept).toBe('application/json');
    const auto = asOk(await api.get<EchoPayload>('/echo'));
    expect(auto.data.headers.accept).toBe('application/json');
  });

  it('is never passed to fetch as an init option', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await api.get('/json', undefined, {
        responseType: 'text',
        parseJson: (text) => JSON.parse(text),
        stringifyJson: (value) => JSON.stringify(value),
      });
      const init = fetchSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(init).not.toHaveProperty('responseType');
      expect(init).not.toHaveProperty('parseJson');
      expect(init).not.toHaveProperty('stringifyJson');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('parseJson', () => {
  const bigintParse = (text: string): unknown =>
    JSON.parse(text.replace(/:(\d{16,})/g, ':"$1"'), (_key, value: unknown) =>
      typeof value === 'string' && /^\d{16,}$/.test(value) ? BigInt(value) : value,
    );

  it('replaces JSON.parse for success bodies and receives the response', async () => {
    const parseJson = vi.fn((text: string, _context: { response: Response }) => bigintParse(text));
    const local = create({ baseURL: server.baseURL, parseJson });

    const response = asOk(await local.get<{ id: bigint }>('/big-json'));

    expect(response.data.id).toBe(9007199254740993n);
    expect(parseJson).toHaveBeenCalledTimes(1);
    expect(parseJson.mock.calls[0]?.[0]).toBe('{"id":9007199254740993}');
    expect(parseJson.mock.calls[0]?.[1].response).toBeInstanceOf(Response);
  });

  it('is used for error bodies too', async () => {
    const local = create({
      baseURL: server.baseURL,
      parseJson: (text) => ({ wrapped: JSON.parse(text) }),
    });
    const response = asError(await local.get('/status/422'));
    expect(response.data).toEqual({ wrapped: { status: 422 } });
  });

  it('is used with a forced json responseType', async () => {
    const local = create({ baseURL: server.baseURL, parseJson: () => 'custom' });
    const response = asOk(await local.get('/text-json', undefined, { responseType: 'json' }));
    expect(response.data).toBe('custom');
  });

  it('can be overridden per request', async () => {
    const local = create({ baseURL: server.baseURL, parseJson: () => 'instance' });
    const response = asOk(await local.get('/json', undefined, { parseJson: () => 'request' }));
    expect(response.data).toBe('request');
  });

  it('turns a throwing parser into a parse error with the raw text', async () => {
    const local = create({
      baseURL: server.baseURL,
      parseJson: () => {
        throw new Error('forbidden key');
      },
    });
    const response = asError(await local.get('/json'));
    expect(response.problem).toBe(PROBLEM_CODE.PARSE_ERROR);
    expect(response.data).toBe('{"ok":true}');
    expect(response.originalError?.message).toContain('forbidden key');
  });
});

describe('stringifyJson', () => {
  it('replaces JSON.stringify for object bodies and keeps the JSON content type', async () => {
    const local = create({
      baseURL: server.baseURL,
      stringifyJson: (value) =>
        JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
    });
    const response = asOk(await local.post<EchoPayload>('/echo', { id: 9007199254740993n }));
    expect(response.data.body).toBe('{"id":"9007199254740993"}');
    expect(response.data.headers['content-type']).toBe('application/json');
  });

  it('leaves string, FormData and other native bodies alone', async () => {
    const stringifyJson = vi.fn(() => 'never');
    const local = create({ baseURL: server.baseURL, stringifyJson });
    const response = asOk(await local.post<EchoPayload>('/echo', 'raw-string'));
    expect(response.data.body).toBe('raw-string');
    expect(stringifyJson).not.toHaveBeenCalled();
  });

  it('can be overridden per request', async () => {
    const local = create({ baseURL: server.baseURL, stringifyJson: () => '"instance"' });
    const response = asOk(
      await local.post<EchoPayload>('/echo', { a: 1 }, { stringifyJson: () => '"request"' }),
    );
    expect(response.data.body).toBe('"request"');
  });
});
