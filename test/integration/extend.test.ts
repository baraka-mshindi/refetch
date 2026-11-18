import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { create, pipe, setRequestHeader, withAuth } from '../../src/index';
import { asError, asOk } from '../helpers/assert';
import { type EchoPayload, startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(() => server.close());

beforeEach(() => server.resetHits());

const echo = async (api: ReturnType<typeof create>, config = {}) =>
  asOk(await api.get<EchoPayload>('/echo', undefined, config)).data;

describe('extend()', () => {
  it('inherits config and merges header overrides case-insensitively', async () => {
    const parent = create({
      baseURL: server.baseURL,
      headers: { 'X-Tenant': 'acme', 'X-Trace': 'parent' },
    });
    const child = parent.extend({ headers: { 'x-trace': 'child', 'X-Feature': 'billing' } });

    const sent = (await echo(child)).headers;
    expect(sent['x-tenant']).toBe('acme');
    expect(sent['x-trace']).toBe('child');
    expect(sent['x-feature']).toBe('billing');
    expect(child.getBaseURL()).toBe(server.baseURL);
  });

  it('leaves the parent untouched by overrides', async () => {
    const parent = create({ baseURL: server.baseURL, headers: { 'X-Trace': 'parent' } });
    parent.extend({ headers: { 'X-Trace': 'child' }, baseURL: 'http://127.0.0.1:1' });

    expect((await echo(parent)).headers['x-trace']).toBe('parent');
    expect(parent.getBaseURL()).toBe(server.baseURL);
  });

  it('keeps later mutations of either instance to itself', async () => {
    const parent = create({ baseURL: server.baseURL });
    const child = parent.extend();

    child.setHeader('X-Child', '1');
    parent.setHeader('X-Parent', '1');
    child.interceptors.request.use((config) => setRequestHeader(config, 'X-Child-Hook', '1'));
    parent.interceptors.request.use((config) => setRequestHeader(config, 'X-Parent-Hook', '1'));
    const childMonitor = vi.fn();
    const parentMonitor = vi.fn();
    child.addMonitor(childMonitor);
    parent.addMonitor(parentMonitor);

    const fromChild = (await echo(child)).headers;
    expect(fromChild['x-child']).toBe('1');
    expect(fromChild['x-child-hook']).toBe('1');
    expect(fromChild['x-parent']).toBeUndefined();
    expect(fromChild['x-parent-hook']).toBeUndefined();
    expect(childMonitor).toHaveBeenCalledTimes(1);
    expect(parentMonitor).not.toHaveBeenCalled();

    const fromParent = (await echo(parent)).headers;
    expect(fromParent['x-parent']).toBe('1');
    expect(fromParent['x-parent-hook']).toBe('1');
    expect(fromParent['x-child']).toBeUndefined();
    expect(fromParent['x-child-hook']).toBeUndefined();
    expect(childMonitor).toHaveBeenCalledTimes(1);
  });

  it('copies interceptors and monitors in order, and ejecting on the child spares the parent', async () => {
    const order: string[] = [];
    const parent = create({ baseURL: server.baseURL });
    parent.interceptors.request.use((config) => {
      order.push('request-1');
      return config;
    });
    parent.interceptors.request.use((config) => {
      order.push('request-2');
      return config;
    });
    parent.interceptors.response.use((response) => {
      order.push('response-1');
      return response;
    });
    parent.interceptors.response.use((response) => {
      order.push('response-2');
      return response;
    });
    const monitor = vi.fn();
    parent.addMonitor(monitor);

    const child = parent.extend();
    await echo(child);
    // Same order as on the parent: request interceptors LIFO, response interceptors FIFO.
    expect(order).toEqual(['request-2', 'request-1', 'response-1', 'response-2']);
    expect(monitor).toHaveBeenCalledTimes(1);

    child.interceptors.request.clear();
    child.interceptors.response.clear();
    child.clearMonitors();
    order.length = 0;
    await echo(parent);
    expect(order).toEqual(['request-2', 'request-1', 'response-1', 'response-2']);
    expect(monitor).toHaveBeenCalledTimes(2);
  });

  it('carries middleware such as withAuth to the child', async () => {
    const parent = pipe(
      create({ baseURL: server.baseURL }),
      withAuth(() => 'T'),
    );
    const child = parent.extend({ headers: { 'X-Feature': 'reports' } });
    const sent = (await echo(child)).headers;
    expect(sent.authorization).toBe('Bearer T');
    expect(sent['x-feature']).toBe('reports');
  });

  it('merges retry settings field by field', async () => {
    const parent = create({ baseURL: server.baseURL, retry: { attempts: 4, delay: 1 } });
    const child = parent.extend({ retry: 2 });

    asError(await child.get('/status/503'));
    expect(server.hits('/status/503')).toBe(2);
    expect(child.config.retry).toEqual({ attempts: 2, delay: 1 });
    expect(parent.config.retry).toEqual({ attempts: 4, delay: 1 });
  });

  it('combines the parent and child signals so either cancels', async () => {
    const parentAbort = new AbortController();
    const childAbort = new AbortController();
    const parent = create({ baseURL: server.baseURL, signal: parentAbort.signal });
    const child = parent.extend({ signal: childAbort.signal });

    expect(asOk(await child.get('/json')).ok).toBe(true);

    childAbort.abort();
    expect(asError(await child.get('/json')).error.kind).toBe('cancel');
    // The parent only listens to its own signal.
    expect(asOk(await parent.get('/json')).ok).toBe(true);

    const sibling = parent.extend({ signal: new AbortController().signal });
    parentAbort.abort();
    expect(asError(await sibling.get('/json')).error.kind).toBe('cancel');
  });

  it('uses a function result as the whole config (replace, not merge)', async () => {
    const parent = create({
      baseURL: server.baseURL,
      headers: { 'X-Tenant': 'acme' },
      timeout: 5000,
    });
    const child = parent.extend((config) => ({
      baseURL: config.baseURL,
      headers: { 'X-Only': '1' },
    }));

    const sent = (await echo(child)).headers;
    expect(sent['x-only']).toBe('1');
    expect(sent['x-tenant']).toBeUndefined();
    expect(child.config.timeout).toBeUndefined();
    // The parent config handed to the function is a copy.
    parent.extend((config) => {
      (config.headers as Headers).set('X-Leak', '1');
      return config;
    });
    expect((await echo(parent)).headers['x-leak']).toBeUndefined();
  });

  it('can be chained', async () => {
    const root = create({ baseURL: server.baseURL, headers: { 'X-A': '1' } });
    const leaf = root.extend({ headers: { 'X-B': '2' } }).extend({ headers: { 'X-C': '3' } });
    const sent = (await echo(leaf)).headers;
    expect([sent['x-a'], sent['x-b'], sent['x-c']]).toEqual(['1', '2', '3']);
  });
});
