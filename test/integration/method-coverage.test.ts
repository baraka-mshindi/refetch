import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { create, type RefetchInstance } from '../../src/index';
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

describe('DELETE with a body', () => {
  it('sends config.data as the body and still serialises params', async () => {
    const response = asOk(
      await api.delete<EchoPayload>('/echo', { soft: true }, { data: { ids: [1, 2] } }),
    );
    expect(response.data.method).toBe('DELETE');
    expect(response.data.url).toBe('/echo?soft=true');
    expect(response.data.body).toBe('{"ids":[1,2]}');
    expect(response.data.headers['content-type']).toBe('application/json');
  });

  it('sends the body through any()', async () => {
    const response = asOk(
      await api.any<EchoPayload>({ method: 'DELETE', url: '/echo', data: { ids: [3] } }),
    );
    expect(response.data.body).toBe('{"ids":[3]}');
  });

  it('stays body-less when no data is given', async () => {
    const response = asOk(await api.delete<EchoPayload>('/echo'));
    expect(response.data.body).toBe('');
    expect(response.data.headers['content-type']).toBeUndefined();
  });
});

describe('GET and HEAD', () => {
  it('never send a body, even when config.data is set', async () => {
    const response = asOk(await api.get<EchoPayload>('/echo', undefined, { data: { a: 1 } }));
    expect(response.data.method).toBe('GET');
    expect(response.data.body).toBe('');
  });
});

describe('query()', () => {
  it('sends a QUERY request whose body defines the query', async () => {
    const response = asOk(
      await api.query<EchoPayload, { filter: string }>('/echo', { filter: 'active' }),
    );
    expect(response.data.method).toBe('QUERY');
    expect(response.data.body).toBe('{"filter":"active"}');
    expect(response.data.headers['content-type']).toBe('application/json');
    expect(response.request?.method).toBe('QUERY');
  });

  it('keeps a caller-supplied Content-Type', async () => {
    const response = asOk(
      await api.query<EchoPayload>('/echo', 'SELECT 1', {
        headers: { 'Content-Type': 'application/sql' },
      }),
    );
    expect(response.data.body).toBe('SELECT 1');
    expect(response.data.headers['content-type']).toBe('application/sql');
  });

  it('is retried by the default retry policy', async () => {
    const response = asError(
      await api.query('/status/503', { q: 1 }, { retry: { attempts: 3, delay: 1 } }),
    );
    expect(response.status).toBe(503);
    expect(server.hits('/status/503')).toBe(3);
  });

  it('is retried when retries are limited to named methods', async () => {
    await api.query(
      '/status/503',
      { q: 1 },
      { retry: { attempts: 2, delay: 1, methods: ['QUERY'] } },
    );
    expect(server.hits('/status/503')).toBe(2);
  });
});

describe.each(['link', 'unlink'] as const)('%s()', (verb) => {
  it('sends its second argument as query params, not as a body (#62)', async () => {
    const response = asOk(await api[verb]<EchoPayload>('/echo', { rel: 'tag' }));
    expect(response.data.method).toBe(verb.toUpperCase());
    expect(response.data.url).toBe('/echo?rel=tag');
    expect(response.data.body).toBe('');
    expect(response.data.headers['content-type']).toBeUndefined();
  });

  it('sends a body when config.data is given', async () => {
    const response = asOk(
      await api[verb]<EchoPayload>('/echo', { rel: 'tag' }, { data: { note: 'x' } }),
    );
    expect(response.data.url).toBe('/echo?rel=tag');
    expect(response.data.body).toBe('{"note":"x"}');
  });
});

describe('options()', () => {
  it('sends OPTIONS with params and no body', async () => {
    const response = asOk(await api.options<EchoPayload>('/echo', { probe: 1 }));
    expect(response.data.method).toBe('OPTIONS');
    expect(response.data.url).toBe('/echo?probe=1');
    expect(response.data.body).toBe('');
  });

  it('sends a body when config.data is given', async () => {
    const response = asOk(
      await api.options<EchoPayload>('/echo', undefined, { data: { want: 'schema' } }),
    );
    expect(response.data.body).toBe('{"want":"schema"}');
  });
});
