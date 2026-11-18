import { type } from 'arktype';
import * as v from 'valibot';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  create,
  PROBLEM_CODE,
  type RefetchInstance,
  RefetchValidationError,
  type StandardSchemaV1,
  unwrap,
  ValidationError,
} from '../../src/index';
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

/** A hand-rolled Standard Schema, to prove no validator library is required. */
function custom<T>(
  validate: (value: unknown) => StandardSchemaV1.Result<T> | Promise<StandardSchemaV1.Result<T>>,
): StandardSchemaV1<unknown, T> {
  return { '~standard': { version: 1, vendor: 'test', validate } };
}

// `/json` answers `{ "ok": true }`.
const libraries: Array<[string, StandardSchemaV1, StandardSchemaV1]> = [
  ['zod', z.object({ ok: z.boolean() }), z.object({ ok: z.string() })],
  ['valibot', v.object({ ok: v.boolean() }), v.object({ ok: v.string() })],
  ['arktype', type({ ok: 'boolean' }), type({ ok: 'string' })],
];

describe.each(libraries)('schema with %s', (_name, matching, mismatching) => {
  it('returns validated data when the body matches', async () => {
    const response = asOk(await api.get('/json', undefined, { schema: matching }));
    expect(response.data).toEqual({ ok: true });
  });

  it('returns a validation error when the body does not match', async () => {
    const response = asError(await api.get('/json', undefined, { schema: mismatching }));
    expect(response.problem).toBe(PROBLEM_CODE.VALIDATION_ERROR);
    expect(response.error.kind).toBe('validation');
    if (response.error.kind !== 'validation') throw new Error('unreachable');
    expect(response.error.issues.length).toBeGreaterThan(0);
    expect(typeof response.error.issues[0]?.message).toBe('string');
  });
});

describe('schema', () => {
  it('keeps status, headers, the raw body and the request on a validation error', async () => {
    const response = asError(
      await api.get('/json', undefined, { schema: z.object({ ok: z.string() }) }),
    );
    expect(response.status).toBe(200);
    expect(response.headers?.['content-type']).toBe('application/json');
    expect(response.data).toEqual({ ok: true });
    expect(response.request?.url).toBe(`${server.baseURL}/json`);
    expect(response.originalError).toBeInstanceOf(ValidationError);
    expect((response.originalError as ValidationError).issues).toBe(
      response.error.kind === 'validation' ? response.error.issues : undefined,
    );
  });

  it('returns the schema output, including transforms', async () => {
    const schema = z.object({ ok: z.boolean() }).transform((body) => ({ fine: body.ok }));
    const response = asOk(await api.get('/json', undefined, { schema }));
    expect(response.data).toEqual({ fine: true });
  });

  it('supports asynchronous validators', async () => {
    const passing = custom(async (value) => ({ value: { wrapped: value } }));
    expect(asOk(await api.get('/json', undefined, { schema: passing })).data).toEqual({
      wrapped: { ok: true },
    });

    const failing = custom<never>(async () => ({ issues: [{ message: 'nope', path: ['ok'] }] }));
    const response = asError(await api.get('/json', undefined, { schema: failing }));
    expect(response.error).toMatchObject({
      kind: 'validation',
      issues: [{ message: 'nope', path: ['ok'] }],
    });
  });

  it('is never retried, whatever the retry condition says', async () => {
    await api.get('/json', undefined, {
      schema: z.object({ ok: z.string() }),
      retry: { attempts: 3, delay: 1, condition: () => true },
    });
    expect(server.hits('/json')).toBe(1);
  });

  it('runs after response interceptors and before monitors', async () => {
    const local = create({ baseURL: server.baseURL });
    local.interceptors.response.use((response) => ({ ...response, data: { ok: 'normalised' } }));
    const monitor = vi.fn();
    local.addMonitor(monitor);

    const passing = asOk(
      await local.get('/json', undefined, { schema: z.object({ ok: z.string() }) }),
    );
    expect(passing.data).toEqual({ ok: 'normalised' });

    await local.get('/json', undefined, { schema: z.object({ ok: z.boolean() }) });
    expect(monitor).toHaveBeenLastCalledWith(
      expect.objectContaining({ ok: false, problem: PROBLEM_CODE.VALIDATION_ERROR }),
    );
  });

  it('does not validate error responses', async () => {
    const response = asError(
      await api.get('/status/404', undefined, { schema: z.object({ ok: z.boolean() }) }),
    );
    expect(response.error.kind).toBe('http');
    expect(response.data).toEqual({ status: 404 });
  });

  it('reports a validator that throws as an unknown error, not a validation error', async () => {
    const schema = custom<never>(() => {
      throw new Error('validator crashed');
    });
    const response = asError(await api.get('/json', undefined, { schema }));
    expect(response.problem).toBe(PROBLEM_CODE.UNKNOWN_ERROR);
    expect(response.error.kind).toBe('unknown');
    expect(response.originalError?.message).toBe('validator crashed');
  });

  it('rejects with RefetchValidationError in throw mode', async () => {
    const promise = api.get('/json', undefined, { schema: z.object({ ok: z.string() }) });
    const error = await promise.then(unwrap).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(RefetchValidationError);
    expect((error as RefetchValidationError).issues.length).toBeGreaterThan(0);
    expect((error as RefetchValidationError).status).toBe(200);
  });

  it('never passes schema or bodySchema to fetch as init options', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await api.post('/echo', { a: 1 }, { schema: z.unknown(), bodySchema: z.unknown() });
      const init = fetchSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(init).not.toHaveProperty('schema');
      expect(init).not.toHaveProperty('bodySchema');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('bodySchema', () => {
  const bodySchema = z.object({ name: z.string().trim().min(1) });

  it('sends the validated (and transformed) body', async () => {
    const response = asOk(
      await api.post<EchoPayload>('/echo', { name: '  Ada  ' }, { bodySchema }),
    );
    expect(response.data.body).toBe('{"name":"Ada"}');
  });

  it('fails before any network call when the body is invalid', async () => {
    const response = asError(await api.post('/echo', { name: '   ' }, { bodySchema }));
    expect(response.problem).toBe(PROBLEM_CODE.VALIDATION_ERROR);
    expect(response.error.kind).toBe('validation');
    expect(response.request?.attempt).toBe(0);
    expect(response.status).toBeUndefined();
    expect(server.hits('/echo')).toBe(0);
  });
});
