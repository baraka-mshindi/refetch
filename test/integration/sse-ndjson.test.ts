import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CancelError,
  create,
  createCancelToken,
  RefetchHttpError,
  type RefetchInstance,
} from '../../src/index';
import { ndjson, type SseEvent, sse } from '../../src/stream';
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

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe('stream() for any method', () => {
  it('sends config.method and config.data', async () => {
    const response = asOk(
      await api.stream('/echo', { v: 1 }, { method: 'POST', data: { prompt: 'hi' } }),
    );
    const echo = JSON.parse(await new Response(response.data).text()) as EchoPayload;
    expect(echo.method).toBe('POST');
    expect(echo.url).toBe('/echo?v=1');
    expect(echo.body).toBe('{"prompt":"hi"}');
    expect(echo.headers['content-type']).toBe('application/json');
  });

  it('runs response interceptors and monitors with the stream as data', async () => {
    const local = create({ baseURL: server.baseURL });
    const interceptor = vi.fn((response) => response);
    const monitor = vi.fn();
    local.interceptors.response.use(interceptor);
    local.addMonitor(monitor);

    const response = asOk(await local.stream('/stream'));

    expect(interceptor).toHaveBeenCalledTimes(1);
    expect(interceptor.mock.calls[0]?.[0].data).toBeInstanceOf(ReadableStream);
    expect(monitor).toHaveBeenCalledTimes(1);
    expect(response.request?.method).toBe('GET');
    await response.data.cancel();
  });

  it('keeps the parsed error body on a failed request', async () => {
    const response = asError(await api.stream('/status/404'));
    expect(response.error.kind).toBe('http');
    expect(response.data).toEqual({ status: 404 });
  });

  it('is not retried, even when the instance retries by default', async () => {
    const local = create({ baseURL: server.baseURL, retry: { attempts: 3, delay: 1 } });
    await local.stream('/status/503');
    expect(server.hits('/status/503')).toBe(1);
  });
});

describe('sse()', () => {
  it('round-trips a POST and decodes comments, multi-line data, ids and CRLF frames', async () => {
    const response = asOk(
      await sse(api, '/sse-chat', { method: 'POST', data: { prompt: 'hello' } }),
    );
    expect(response.status).toBe(200);

    const received = await collect(response.data);

    expect(received).toEqual<SseEvent[]>([
      { data: '{"prompt":"hello"}', event: 'request' },
      { data: 'text/event-stream', event: 'accept' },
      { data: '{"delta":"Hel"}', id: '1' },
      { data: 'line one\nline two', id: '1' },
      { data: '[DONE]', id: '1', retry: 3000 },
    ]);
  });

  it('keeps a caller-supplied Accept header', async () => {
    const response = asOk(
      await sse(api, '/sse-chat', { method: 'POST', headers: { Accept: 'text/plain' } }),
    );
    const received = await collect(response.data);
    expect(received[1]).toEqual({ data: 'text/plain', event: 'accept' });
  });

  it('resolves a failed request as an ordinary error response', async () => {
    const response = asError(await sse(api, '/status/404'));
    expect(response.error.kind).toBe('http');
    expect(response.data).toEqual({ status: 404 });
  });

  it('rejects in throw mode', async () => {
    const strict = create({ baseURL: server.baseURL, throwOnError: true });
    await expect(sse(strict, '/status/500')).rejects.toBeInstanceOf(RefetchHttpError);
  });

  it('stops with the cancel reason when the request is cancelled mid-stream', async () => {
    const { token, cancel } = createCancelToken();
    const response = asOk(await sse(api, '/sse-forever', { signal: token }));

    const received: string[] = [];
    const reading = (async () => {
      for await (const event of response.data) {
        received.push(event.data);
        if (received.length === 2) cancel('user left');
      }
    })();

    await expect(reading).rejects.toBeInstanceOf(CancelError);
    await expect(reading).rejects.toThrow('user left');
    expect(received.length).toBeGreaterThanOrEqual(2);
  });

  it('fails with a TimeoutError when the stream goes quiet for idleTimeout', async () => {
    const response = asOk(await sse(api, '/sse-stall', { idleTimeout: 40 }));
    const received: string[] = [];
    const reading = (async () => {
      for await (const event of response.data) received.push(event.data);
    })();
    await expect(reading).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(received).toEqual(['first']);
  });

  it('does not pass idleTimeout to fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const response = asOk(await sse(api, '/sse-chat', { idleTimeout: 1000 }));
      await collect(response.data);
      const init = fetchSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(init).not.toHaveProperty('idleTimeout');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('ndjson()', () => {
  it('yields one parsed value per line', async () => {
    const response = asOk(await ndjson<{ n: number }>(api, '/ndjson'));
    expect(await collect(response.data)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('asks for application/x-ndjson and uses config.parseJson', async () => {
    const parseJson = vi.fn((text: string, _context: { response: Response }) => ({ raw: text }));
    const response = asOk(await ndjson(api, '/ndjson', { parseJson }));
    expect(await collect(response.data)).toEqual([
      { raw: '{"n":1}' },
      { raw: '{"n":2}' },
      { raw: '{"n":3}' },
    ]);
    expect(parseJson.mock.calls[0]?.[1]).toMatchObject({ response: expect.any(Response) });
    expect(response.request?.headers.accept).toBe('application/x-ndjson');
  });
});
