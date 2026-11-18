import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  create,
  PROBLEM_CODE,
  pipe,
  RefetchSizeError,
  ResponseSizeError,
  unwrap,
  withAuth,
} from '../../src/index';
import { asError, asOk } from '../helpers/assert';
import { type EchoPayload, startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;
/** A second origin (same host, different port). */
let other: TestServer;

beforeAll(async () => {
  [server, other] = await Promise.all([startTestServer(), startTestServer()]);
});

afterAll(() => Promise.all([server.close(), other.close()]));

beforeEach(() => {
  server.resetHits();
  other.resetHits();
});

const MB = 1024 * 1024;

describe('withAuth origin scoping', () => {
  it('attaches the token to relative URLs and absolute URLs on the base origin', async () => {
    const api = pipe(
      create({ baseURL: server.baseURL }),
      withAuth(() => 'T'),
    );
    const relative = asOk(await api.get<EchoPayload>('/echo'));
    expect(relative.data.headers.authorization).toBe('Bearer T');

    const absolute = asOk(await api.get<EchoPayload>(`${server.baseURL}/echo`));
    expect(absolute.data.headers.authorization).toBe('Bearer T');
  });

  it('does not send the token to another origin, and does not even fetch one', async () => {
    const getToken = vi.fn(() => 'T');
    const api = pipe(create({ baseURL: server.baseURL }), withAuth(getToken));

    const response = asOk(await api.get<EchoPayload>(`${other.baseURL}/echo`));

    expect(response.data.headers.authorization).toBeUndefined();
    expect(getToken).not.toHaveBeenCalled();
  });

  it('follows a per-request baseURL', async () => {
    const api = pipe(
      create({ baseURL: server.baseURL }),
      withAuth(() => 'T'),
    );
    const response = asOk(
      await api.get<EchoPayload>('/echo', undefined, { baseURL: other.baseURL }),
    );
    expect(response.data.headers.authorization).toBe('Bearer T');
  });

  it('cannot be switched off by an empty per-request baseURL', async () => {
    const api = pipe(
      create({ baseURL: server.baseURL }),
      withAuth(() => 'T'),
    );
    const response = asOk(
      await api.get<EchoPayload>(`${other.baseURL}/echo`, undefined, { baseURL: '' }),
    );
    expect(response.data.headers.authorization).toBeUndefined();

    // The instance base is still what a relative URL resolves against, and it is in scope.
    const relative = asOk(await api.get<EchoPayload>('/echo', undefined, { baseURL: '' }));
    expect(relative.data.headers.authorization).toBe('Bearer T');
  });

  it('sends the token to extra origins that are listed explicitly', async () => {
    const api = pipe(
      create({ baseURL: server.baseURL }),
      withAuth(() => 'T', { origins: [server.baseURL, other.baseURL] }),
    );
    const response = asOk(await api.get<EchoPayload>(`${other.baseURL}/echo`));
    expect(response.data.headers.authorization).toBe('Bearer T');
  });

  it('limits the token to the listed origins only', async () => {
    const api = pipe(
      create({ baseURL: server.baseURL }),
      withAuth(() => 'T', { origins: [other.baseURL] }),
    );
    const base = asOk(await api.get<EchoPayload>('/echo'));
    expect(base.data.headers.authorization).toBeUndefined();
  });

  it("origins: 'any' restores the unscoped behaviour", async () => {
    const api = pipe(
      create({ baseURL: server.baseURL }),
      withAuth(() => 'T', { origins: 'any' }),
    );
    const response = asOk(await api.get<EchoPayload>(`${other.baseURL}/echo`));
    expect(response.data.headers.authorization).toBe('Bearer T');
  });

  it('attaches everywhere when the instance has no baseURL to scope to', async () => {
    const api = pipe(
      create(),
      withAuth(() => 'T'),
    );
    const response = asOk(await api.get<EchoPayload>(`${other.baseURL}/echo`));
    expect(response.data.headers.authorization).toBe('Bearer T');
  });
});

describe('maxResponseSize', () => {
  it('aborts a 10 MB body at the configured cap', async () => {
    const api = create({ baseURL: server.baseURL });
    const response = asError(
      await api.get('/big', { bytes: 10 * MB }, { maxResponseSize: MB, responseType: 'text' }),
    );

    expect(response.problem).toBe(PROBLEM_CODE.RESPONSE_TOO_LARGE);
    expect(response.error).toMatchObject({ kind: 'size', limit: MB });
    expect(response.originalError).toBeInstanceOf(ResponseSizeError);
    expect(response.status).toBe(200);
    expect(response.data).toBeUndefined();
    // The server stops being read: fewer than 10 MB were written before the abort.
    expect(server.bytesSent('/big')).toBeLessThan(10 * MB);
  });

  it('lets through a body at or under the cap', async () => {
    const api = create({ baseURL: server.baseURL, maxResponseSize: 64 * 1024 });
    const exact = asOk(await api.get<string>('/big', { bytes: 64 * 1024 }));
    expect(exact.data.length).toBe(64 * 1024);

    const over = asError(await api.get('/big', { bytes: 64 * 1024 + 1 }));
    expect(over.error.kind).toBe('size');
  });

  it('applies to JSON and to error bodies', async () => {
    const api = create({ baseURL: server.baseURL, maxResponseSize: 4 });
    expect(asError(await api.get('/json')).error.kind).toBe('size');
    expect(asError(await api.get('/status/500')).error.kind).toBe('size');
  });

  it('is never retried, whatever the retry condition says', async () => {
    const api = create({ baseURL: server.baseURL });
    await api.get('/json', undefined, {
      maxResponseSize: 4,
      retry: { attempts: 3, delay: 1, condition: () => true },
    });
    expect(server.hits('/json')).toBe(1);
  });

  it("caps a 'stream' response while the caller reads it", async () => {
    const api = create({ baseURL: server.baseURL });
    const response = asOk(
      await api.get<ReadableStream<Uint8Array>>(
        '/big',
        { bytes: 2 * MB },
        { maxResponseSize: 64 * 1024, responseType: 'stream' },
      ),
    );
    await expect(new Response(response.data).arrayBuffer()).rejects.toBeInstanceOf(
      ResponseSizeError,
    );
  });

  it('rejects with RefetchSizeError in throw mode', async () => {
    const api = create({ baseURL: server.baseURL, maxResponseSize: 4 });
    const error = await api
      .get('/json')
      .then(unwrap)
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(RefetchSizeError);
    expect((error as RefetchSizeError).limit).toBe(4);
  });

  it('is never passed to fetch as an init option', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await create({ baseURL: server.baseURL }).get('/json', undefined, { maxResponseSize: MB });
      const init = fetchSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(init).not.toHaveProperty('maxResponseSize');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
