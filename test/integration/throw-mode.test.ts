import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  create,
  isRefetchError,
  PROBLEM_CODE,
  RefetchCancelError,
  RefetchHttpError,
  RefetchNetworkError,
  RefetchParseError,
  RefetchResponseError,
  RefetchTimeoutError,
  RefetchUnknownError,
  TimeoutError,
  unwrap,
} from '../../src/index';
import { startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(() => server.close());

beforeEach(() => server.resetHits());

/** Resolves with the rejection reason, or fails when the promise fulfils. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

describe('unwrap', () => {
  it('returns the data of an ok response', async () => {
    const api = create({ baseURL: server.baseURL });
    await expect(api.get<{ ok: boolean }>('/json').then(unwrap)).resolves.toEqual({ ok: true });
  });

  it('throws RefetchHttpError carrying status, body, problem and the response', async () => {
    const api = create({ baseURL: server.baseURL });
    const error = await rejection(api.get('/status/404').then(unwrap));

    expect(error).toBeInstanceOf(RefetchHttpError);
    expect(error).toBeInstanceOf(RefetchResponseError);
    expect(error).toBeInstanceOf(Error);
    expect(isRefetchError(error)).toBe(true);

    const http = error as RefetchHttpError<{ status: number }>;
    expect(http.name).toBe('RefetchHttpError');
    expect(http.kind).toBe('http');
    expect(http.problem).toBe(PROBLEM_CODE.CLIENT_ERROR);
    expect(http.status).toBe(404);
    expect(http.statusText).toBe('Not Found');
    expect(http.data).toEqual({ status: 404 });
    expect(http.headers?.['content-type']).toBe('application/json');
    expect(http.message).toContain('404');
    expect(http.response.ok).toBe(false);
    expect(http.response.error).toEqual({ kind: 'http', status: 404, statusText: 'Not Found' });
    expect(http.request?.method).toBe('GET');
    expect(http.request?.url).toBe(`${server.baseURL}/status/404`);
  });

  it('throws RefetchTimeoutError with the TimeoutError as cause', async () => {
    const api = create({ baseURL: server.baseURL, timeout: 30 });
    const error = await rejection(api.get('/slow-headers', { ms: 500 }).then(unwrap));

    expect(error).toBeInstanceOf(RefetchTimeoutError);
    const timeout = error as RefetchTimeoutError;
    expect(timeout.name).toBe('RefetchTimeoutError');
    expect(timeout.problem).toBe(PROBLEM_CODE.TIMEOUT_ERROR);
    expect(timeout.cause).toBeInstanceOf(TimeoutError);
    expect(timeout.status).toBeUndefined();
  });

  it('throws RefetchCancelError for an aborted request', async () => {
    const api = create({ baseURL: server.baseURL });
    const error = await rejection(
      api.get('/json', undefined, { signal: AbortSignal.abort() }).then(unwrap),
    );
    expect(error).toBeInstanceOf(RefetchCancelError);
    expect((error as RefetchCancelError).kind).toBe('cancel');
  });

  it('throws RefetchNetworkError when the transport fails', async () => {
    const api = create({ baseURL: 'http://127.0.0.1:1' });
    const error = await rejection(api.get('/json').then(unwrap));
    expect(error).toBeInstanceOf(RefetchNetworkError);
    expect((error as RefetchNetworkError).kind).toBe('network');
  });

  it('throws RefetchParseError and keeps the raw body', async () => {
    const api = create({ baseURL: server.baseURL });
    const error = await rejection(api.get('/bad-json').then(unwrap));
    expect(error).toBeInstanceOf(RefetchParseError);
    const parse = error as RefetchParseError;
    expect(parse.status).toBe(200);
    expect(parse.data).toBe('{not json');
  });

  it('throws RefetchUnknownError for a failing request interceptor', async () => {
    const api = create({ baseURL: server.baseURL });
    api.interceptors.request.use(() => {
      throw new Error('token fetch failed');
    });
    const error = await rejection(api.get('/json').then(unwrap));
    expect(error).toBeInstanceOf(RefetchUnknownError);
    expect((error as RefetchUnknownError).message).toBe('token fetch failed');
  });

  it('keeps credentials out of serialised errors while leaving them readable in code', async () => {
    const api = create({
      baseURL: server.baseURL,
      headers: { Authorization: 'Bearer s3cret-token' },
    });
    const error = (await rejection(
      api.post('/status/401', { password: 'hunter2' }).then(unwrap),
    )) as RefetchHttpError;

    expect(Object.keys(error)).not.toEqual(expect.arrayContaining(['response']));
    expect(Object.keys(error)).not.toEqual(expect.arrayContaining(['request']));
    expect(Object.keys(error)).not.toEqual(expect.arrayContaining(['headers']));
    const serialised = JSON.stringify(error) + JSON.stringify({ ...error });
    expect(serialised).not.toContain('s3cret-token');
    expect(serialised).not.toContain('hunter2');
    expect(serialised).toContain('"status":401');

    // Still available to code that asks for it, e.g. to replay the request.
    expect(error.response.status).toBe(401);
    expect(error.request?.headers.authorization).toBe('[redacted]');
    expect(error.request?.config.data).toEqual({ password: 'hunter2' });
  });

  it('isRefetchError rejects foreign values', () => {
    expect(isRefetchError(new Error('nope'))).toBe(false);
    expect(isRefetchError(null)).toBe(false);
    expect(isRefetchError({ kind: 'http' })).toBe(false);
  });
});

describe('throwOnError', () => {
  it('is off by default: failures resolve as error responses', async () => {
    const api = create({ baseURL: server.baseURL });
    const response = await api.get('/status/500');
    expect(response.ok).toBe(false);
  });

  it('rejects with the typed error when enabled on the instance', async () => {
    const api = create({ baseURL: server.baseURL, throwOnError: true });
    await expect(api.get('/json')).resolves.toMatchObject({ ok: true, data: { ok: true } });

    const error = await rejection(api.post('/status/500', { a: 1 }));
    expect(error).toBeInstanceOf(RefetchHttpError);
    expect((error as RefetchHttpError).status).toBe(500);
    expect((error as RefetchHttpError).problem).toBe(PROBLEM_CODE.SERVER_ERROR);
  });

  it('can be switched per request in both directions', async () => {
    const throwing = create({ baseURL: server.baseURL, throwOnError: true });
    const quiet = await throwing.get('/status/404', undefined, { throwOnError: false });
    expect(quiet.ok).toBe(false);

    const resolving = create({ baseURL: server.baseURL });
    const error = await rejection(resolving.get('/status/404', undefined, { throwOnError: true }));
    expect(error).toBeInstanceOf(RefetchHttpError);
  });

  it('accepts a predicate that decides per response', async () => {
    const api = create({
      baseURL: server.baseURL,
      throwOnError: (response) => (response.status ?? 0) >= 500,
    });
    expect((await api.get('/status/404')).ok).toBe(false);
    expect(await rejection(api.get('/status/503'))).toBeInstanceOf(RefetchHttpError);
  });

  it('throws only after response interceptors, monitors and retries have run', async () => {
    const api = create({
      baseURL: server.baseURL,
      throwOnError: true,
      retry: { attempts: 2, delay: 1 },
    });
    const interceptor = vi.fn((response) => response);
    const monitor = vi.fn();
    api.interceptors.response.use(interceptor);
    api.addMonitor(monitor);

    const error = await rejection(api.get('/status/503'));

    expect(error).toBeInstanceOf(RefetchHttpError);
    expect(server.hits('/status/503')).toBe(2);
    expect(interceptor).toHaveBeenCalledTimes(2);
    expect(monitor).toHaveBeenCalledTimes(2);
    expect((error as RefetchHttpError).request?.attempt).toBe(2);
  });

  it('lets a response interceptor recover before anything is thrown', async () => {
    const api = create({ baseURL: server.baseURL, throwOnError: true });
    api.interceptors.response.use((response) =>
      response.status === 404
        ? { ok: true, problem: null, originalError: null, data: 'fallback', status: 200 }
        : response,
    );
    await expect(api.get('/status/404')).resolves.toMatchObject({ ok: true, data: 'fallback' });
  });

  it('applies to any() and stream()', async () => {
    const api = create({ baseURL: server.baseURL, throwOnError: true });
    expect(await rejection(api.any({ url: '/status/400' }))).toBeInstanceOf(RefetchHttpError);
    expect(await rejection(api.stream('/status/404'))).toBeInstanceOf(RefetchHttpError);
  });

  it('never sends throwOnError to fetch as an init option', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const api = create({ baseURL: server.baseURL, throwOnError: true });
      await api.get('/json');
      const init = fetchSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(init).not.toHaveProperty('throwOnError');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
