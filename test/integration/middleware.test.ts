import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  create,
  pipe,
  withAuth,
  withBaseURL,
  withHeaders,
  withLogging,
  withTimeout,
} from '../../src/index';
import { asOk } from '../helpers/assert';
import { type EchoPayload, startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(() => server.close());

describe('middleware over the wire', () => {
  it('withAuth injects a fresh bearer token for every request', async () => {
    let calls = 0;
    const local = pipe(
      create({ baseURL: server.baseURL }),
      withAuth(async () => `token-${++calls}`),
    );
    expect(asOk(await local.get<EchoPayload>('/echo')).data.headers.authorization).toBe(
      'Bearer token-1',
    );
    expect(asOk(await local.get<EchoPayload>('/echo')).data.headers.authorization).toBe(
      'Bearer token-2',
    );
  });

  it('composes several middlewares with pipe', async () => {
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const local = pipe(
      create({ baseURL: server.baseURL }),
      withHeaders({ 'X-App': 'refetch' }),
      withTimeout(100),
      withLogging(logger),
    );

    const ok = asOk(await local.get<EchoPayload>('/echo'));
    expect(ok.data.headers['x-app']).toBe('refetch');
    expect(logger.log).toHaveBeenCalledWith('[refetch] → GET /echo');
    expect(logger.log).toHaveBeenCalledWith(expect.stringMatching(/^\[refetch\] ← 200 \(\d+ms\)$/));

    const slow = await local.get('/slow-headers?ms=800');
    expect(slow.ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('withBaseURL points an instance at another server', async () => {
    const local = pipe(create({ baseURL: 'http://127.0.0.1:1' }), withBaseURL(server.baseURL));
    expect(asOk(await local.get('/json')).data).toEqual({ ok: true });
  });

  it('withAuth keeps per-request Headers instances', async () => {
    const local = pipe(
      create({ baseURL: server.baseURL }),
      withAuth(() => 'T'),
    );
    const result = asOk(
      await local.get<EchoPayload>('/echo', undefined, {
        headers: new Headers({ 'X-Foo': 'bar' }),
      }),
    );
    expect(result.data.headers['x-foo']).toBe('bar');
    expect(result.data.headers.authorization).toBe('Bearer T');
  });
});

describe('middleware does not mutate its argument (v4)', () => {
  const sentBy = async (api: ReturnType<typeof create>) =>
    asOk(await api.get<EchoPayload>('/echo')).data.headers;

  it('leaves the original instance without the middleware', async () => {
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const base = create({ baseURL: server.baseURL });
    const full = pipe(
      base,
      withAuth(() => 'T'),
      withHeaders({ 'X-App': 'web' }),
      withLogging(logger),
    );

    const fromBase = await sentBy(base);
    expect(fromBase.authorization).toBeUndefined();
    expect(fromBase['x-app']).toBeUndefined();
    expect(logger.log).not.toHaveBeenCalled();

    const fromFull = await sentBy(full);
    expect(fromFull.authorization).toBe('Bearer T');
    expect(fromFull['x-app']).toBe('web');
    expect(logger.log).toHaveBeenCalled();
  });

  it('lets two clients share a base without sharing middleware', async () => {
    const base = pipe(create({ baseURL: server.baseURL }), withHeaders({ 'X-App': 'web' }));
    const admin = pipe(
      base,
      withAuth(() => 'admin'),
    );
    const guest = pipe(base, withHeaders({ 'X-Role': 'guest' }));

    const fromAdmin = await sentBy(admin);
    const fromGuest = await sentBy(guest);
    expect([fromAdmin['x-app'], fromAdmin.authorization, fromAdmin['x-role']]).toEqual([
      'web',
      'Bearer admin',
      undefined,
    ]);
    expect([fromGuest['x-app'], fromGuest.authorization, fromGuest['x-role']]).toEqual([
      'web',
      undefined,
      'guest',
    ]);
  });

  it('keeps the interceptor order of chained middleware', async () => {
    const order: string[] = [];
    const tag = (name: string) => (instance: ReturnType<typeof create>) => {
      const child = instance.extend();
      child.interceptors.request.use((config) => {
        order.push(name);
        return config;
      });
      return child;
    };
    const api = pipe(
      create({ baseURL: server.baseURL }),
      tag('first'),
      withTimeout(5000),
      tag('last'),
    );
    await api.get('/json');
    // Request interceptors run last-registered first, exactly as when they shared one instance.
    expect(order).toEqual(['last', 'first']);
  });

  it('withTimeout and withBaseURL also return derived instances', async () => {
    const base = create({ baseURL: server.baseURL, timeout: 5000 });
    const hurried = withTimeout(20)(base);
    expect(asOk(await base.get('/slow-headers', { ms: 80 })).ok).toBe(true);
    expect((await hurried.get('/slow-headers', { ms: 80 })).ok).toBe(false);

    const elsewhere = withBaseURL('http://127.0.0.1:1')(base);
    expect(base.getBaseURL()).toBe(server.baseURL);
    expect(elsewhere.getBaseURL()).toBe('http://127.0.0.1:1');
  });
});
