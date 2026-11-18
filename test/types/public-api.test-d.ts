import { describe, expectTypeOf, it } from 'vitest';
import {
  type ApiErrorResponse,
  type ApiOkResponse,
  type ApiResponse,
  create,
  type HttpMethod,
  isErrorResponse,
  isOkResponse,
  isRefetchError,
  type QueryParams,
  type RefetchConfig,
  type RefetchError,
  RefetchHttpError,
  type RefetchInstance,
  type RefetchResponseError,
  type RequestConfig,
  type ResolvedRequest,
  type ResponseBodyType,
  type RetryConfig,
  type ShortCircuit,
  type StandardSchemaV1,
  type ThrowOnError,
  unwrap,
} from '../../src/index';

interface User {
  id: number;
}

interface CreateUserDto {
  name: string;
}

describe('public API types', () => {
  const api: RefetchInstance = create();

  it('types GET, DELETE and HEAD responses by their single generic', () => {
    expectTypeOf(api.get<User>('/users/1')).resolves.toEqualTypeOf<ApiResponse<User>>();
    expectTypeOf(api.delete<User>('/users/1')).resolves.toEqualTypeOf<ApiResponse<User>>();
    expectTypeOf(api.head('/health')).resolves.toEqualTypeOf<ApiResponse<unknown>>();
  });

  it('types POST, PUT and PATCH bodies with the second generic', () => {
    expectTypeOf(api.post<User, CreateUserDto>)
      .parameter(1)
      .toEqualTypeOf<CreateUserDto | undefined>();
    expectTypeOf(api.put<User, CreateUserDto>('/u', { name: 'x' })).resolves.toEqualTypeOf<
      ApiResponse<User>
    >();
    expectTypeOf(api.patch<User, Partial<User>>('/u', { id: 1 })).resolves.toEqualTypeOf<
      ApiResponse<User>
    >();
  });

  it('types stream() as a ReadableStream of bytes by default', () => {
    expectTypeOf(api.stream('/file')).resolves.toEqualTypeOf<
      ApiResponse<ReadableStream<Uint8Array>>
    >();
  });

  it('narrows with the type guards', async () => {
    const result = await api.get<User>('/users/1');
    if (isOkResponse(result)) {
      expectTypeOf(result).toEqualTypeOf<ApiOkResponse<User>>();
      expectTypeOf(result.data).toEqualTypeOf<User>();
      expectTypeOf(result.problem).toEqualTypeOf<null>();
    }
    if (isErrorResponse(result)) {
      expectTypeOf(result).toEqualTypeOf<ApiErrorResponse<User>>();
      expectTypeOf(result.error).toEqualTypeOf<RefetchError>();
    }
  });

  it('does not yet narrow on `ok` alone (known gap #12)', async () => {
    const result = await api.get<User>('/users/1');
    if (result.ok) {
      expectTypeOf(result.data).toEqualTypeOf<User | undefined>();
    }
    if (!result.ok) {
      // @ts-expect-error — `error` only exists on ApiErrorResponse until #12 lands
      result.error;
    }
  });

  it('accepts false to disable timeouts and exposes totalTimeout', () => {
    expectTypeOf<RequestConfig['timeout']>().toEqualTypeOf<number | false | undefined>();
    expectTypeOf<RefetchConfig['timeout']>().toEqualTypeOf<number | false | undefined>();
    expectTypeOf<RequestConfig['totalTimeout']>().toEqualTypeOf<number | false | undefined>();
    expectTypeOf<RefetchConfig['totalTimeout']>().toEqualTypeOf<number | false | undefined>();
    expectTypeOf<RequestConfig['duplex']>().toEqualTypeOf<'half' | undefined>();
    expectTypeOf<RequestConfig['paramsSerializer']>().toEqualTypeOf<
      ((params: QueryParams) => string) | undefined
    >();
    expectTypeOf(api.get<User>('/u', new URLSearchParams())).resolves.toEqualTypeOf<
      ApiResponse<User>
    >();
    expectTypeOf(api.get<User>('/u', [['a', 1]])).resolves.toEqualTypeOf<ApiResponse<User>>();
  });

  it('types the additive retry options', () => {
    expectTypeOf<RetryConfig['backoff']>().toEqualTypeOf<
      'fixed' | 'linear' | 'exponential' | undefined
    >();
    expectTypeOf<RetryConfig['onRetry']>().toEqualTypeOf<
      ((attempt: number, response: ApiResponse<unknown>, delay: number) => void) | undefined
    >();
    expectTypeOf<RetryConfig['methods']>().toEqualTypeOf<string[] | undefined>();
  });

  it('exposes the resolved request and accepts short-circuits', () => {
    expectTypeOf<ApiResponse<User>['request']>().toEqualTypeOf<ResolvedRequest | undefined>();
    expectTypeOf<RequestConfig['context']>().toEqualTypeOf<Record<string, unknown> | undefined>();
    api.interceptors.request.use(
      (config) =>
        ({ response: { ok: true, problem: null, originalError: null, data: 1 } }) as ShortCircuit,
    );
    api.interceptors.request.use((config) => config);
  });

  it('exposes RefetchError as a discriminated union on kind', () => {
    expectTypeOf<RefetchError['kind']>().toEqualTypeOf<
      'network' | 'timeout' | 'cancel' | 'http' | 'parse' | 'size' | 'validation' | 'unknown'
    >();
    expectTypeOf<Extract<RefetchError, { kind: 'http' }>>().toEqualTypeOf<{
      kind: 'http';
      status: number;
      statusText: string;
    }>();
  });

  it('unwrap narrows a response to its data type', async () => {
    const response = await api.get<User>('/users/1');
    expectTypeOf(unwrap(response)).toEqualTypeOf<User>();
    expectTypeOf(api.get<User>('/users/1').then(unwrap)).resolves.toEqualTypeOf<User>();
  });

  it('types the thrown errors: guard, narrowed kind and status, typed error body', () => {
    const thrown: unknown = undefined;
    if (isRefetchError(thrown)) {
      expectTypeOf(thrown).toEqualTypeOf<RefetchResponseError>();
      expectTypeOf(thrown.status).toEqualTypeOf<number | undefined>();
      expectTypeOf(thrown.kind).toEqualTypeOf<RefetchError['kind']>();
    }
    if (thrown instanceof RefetchHttpError) {
      expectTypeOf(thrown.kind).toEqualTypeOf<'http'>();
      expectTypeOf(thrown.status).toEqualTypeOf<number>();
      expectTypeOf(thrown.statusText).toEqualTypeOf<string>();
    }
    expectTypeOf<RefetchHttpError<{ code: string }>['data']>().toEqualTypeOf<
      { code: string } | undefined
    >();
  });

  it('accepts throwOnError as a boolean or predicate on the instance and per request', () => {
    expectTypeOf<RefetchConfig['throwOnError']>().toEqualTypeOf<ThrowOnError | undefined>();
    expectTypeOf<RequestConfig['throwOnError']>().toEqualTypeOf<ThrowOnError | undefined>();
    expectTypeOf<ThrowOnError>().toEqualTypeOf<
      boolean | ((response: ApiErrorResponse<unknown>) => boolean)
    >();
  });

  it('types responseType, parseJson and stringifyJson on both config levels', () => {
    expectTypeOf<ResponseBodyType>().toEqualTypeOf<
      'auto' | 'json' | 'text' | 'blob' | 'arrayBuffer' | 'bytes' | 'stream' | 'none'
    >();
    expectTypeOf<RequestConfig['responseType']>().toEqualTypeOf<ResponseBodyType | undefined>();
    expectTypeOf<RefetchConfig['responseType']>().toEqualTypeOf<ResponseBodyType | undefined>();
    create({
      parseJson: (text, context) => {
        expectTypeOf(text).toBeString();
        expectTypeOf(context.response).toEqualTypeOf<Response>();
        expectTypeOf(context.request).toEqualTypeOf<ResolvedRequest | undefined>();
        return JSON.parse(text);
      },
      stringifyJson: (value) => {
        expectTypeOf(value).toBeUnknown();
        return JSON.stringify(value);
      },
    });
    // @ts-expect-error unknown response types are rejected
    api.get('/x', undefined, { responseType: 'xml' });
  });

  it('types query() by response and body, options() by response, and method as an open union', () => {
    expectTypeOf(
      api.query<User[], { role: string }>('/users/search', { role: 'admin' }),
    ).toEqualTypeOf<Promise<ApiResponse<User[]>>>();
    // @ts-expect-error the body must match TBody
    api.query<User[], { role: string }>('/users/search', { role: 1 });
    expectTypeOf(api.options<User>('/users')).toEqualTypeOf<Promise<ApiResponse<User>>>();

    expectTypeOf<RequestConfig['method']>().toEqualTypeOf<HttpMethod | undefined>();
    expectTypeOf<'QUERY'>().toExtend<HttpMethod>();
    expectTypeOf<'PROPFIND'>().toExtend<HttpMethod>();
    api.delete('/users', undefined, { data: { ids: [1] } });
  });

  it('infers data from config.schema and keeps the explicit generic usable', () => {
    type Schema<T> = StandardSchemaV1<unknown, T>;
    const userSchema = {} as Schema<User>;

    expectTypeOf(api.get('/users/1', undefined, { schema: userSchema })).resolves.toEqualTypeOf<
      ApiResponse<User>
    >();
    expectTypeOf(api.post('/users', { name: 'x' }, { schema: userSchema })).resolves.toEqualTypeOf<
      ApiResponse<User>
    >();
    expectTypeOf(api.query('/users/search', {}, { schema: userSchema })).resolves.toEqualTypeOf<
      ApiResponse<User>
    >();
    expectTypeOf(api.any({ url: '/users/1', schema: userSchema })).resolves.toEqualTypeOf<
      ApiResponse<User>
    >();

    // No schema: unchanged.
    expectTypeOf(api.get('/users/1')).resolves.toEqualTypeOf<ApiResponse<unknown>>();
    expectTypeOf(api.get('/users/1', undefined, { timeout: 1 })).resolves.toEqualTypeOf<
      ApiResponse<unknown>
    >();
    // An explicit generic wins over the schema.
    expectTypeOf(
      api.get<{ custom: true }>('/users/1', undefined, { schema: userSchema }),
    ).resolves.toEqualTypeOf<ApiResponse<{ custom: true }>>();

    expectTypeOf<Extract<RefetchError, { kind: 'validation' }>['issues']>().toEqualTypeOf<
      ReadonlyArray<StandardSchemaV1.Issue>
    >();
  });
});
