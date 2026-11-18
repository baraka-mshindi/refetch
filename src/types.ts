import type { StandardSchemaV1 } from './schema';

export enum PROBLEM_CODE {
  NONE = 'NONE',
  CLIENT_ERROR = 'CLIENT_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  CANCEL_ERROR = 'CANCEL_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RESPONSE_TOO_LARGE = 'RESPONSE_TOO_LARGE',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Discriminated union covering every failure mode with narrowable fields per kind.
 *
 * @example
 * if (!response.ok) {
 *   switch (response.error.kind) {
 *     case 'timeout':  // response.error.duration is available
 *     case 'http':     // response.error.status is narrowed to number
 *     case 'cancel':   // response.error.reason may carry a message
 *   }
 * }
 */
export type RefetchError =
  | { kind: 'network'; cause: TypeError }
  | { kind: 'timeout'; duration: number; cause: Error }
  | { kind: 'cancel'; reason?: string; cause: Error }
  | { kind: 'http'; status: number; statusText: string }
  | { kind: 'parse'; contentType: string | null; cause: Error }
  | { kind: 'size'; limit: number; cause: Error }
  | { kind: 'validation'; issues: ReadonlyArray<StandardSchemaV1.Issue>; cause: Error }
  | { kind: 'unknown'; cause: Error };

/**
 * Retry configuration. Pass a plain number as shorthand for `{ attempts: n }`.
 */
export interface RetryConfig {
  /** Total attempts including the first (minimum 1). */
  attempts: number;
  /** Fixed delay in ms, or a function returning ms for each retry (1-based attempt number). */
  delay?: number | ((attempt: number) => number);
  /**
   * Return true to retry. Defaults to retrying on any non-ok response except
   * 400/401/403/404/422 or a parse failure. Cancelled requests and total-timeout expiries are
   * never retried, and requests whose body is a one-shot ReadableStream cannot be retried.
   */
  condition?: (response: ApiResponse<unknown>) => boolean;
  /** Grows the base `delay` per attempt. Ignored when `delay` is a function. Default `'fixed'`. */
  backoff?: 'fixed' | 'linear' | 'exponential';
  /** Full jitter: each computed delay becomes a random value in [0, delay]. Default `false`. */
  jitter?: boolean;
  /** Upper bound in ms for computed delays. */
  maxDelay?: number;
  /** Honour `Retry-After` and rate-limit reset headers instead of the computed delay. Default `true`. */
  respectRetryAfter?: boolean;
  /** Give up instead of waiting when the server asks for more than this many ms. Default 60 000. */
  maxRetryAfter?: number;
  /** Only retry these HTTP methods (case-insensitive). Default: every method. */
  methods?: string[];
  /** Only retry these status codes; transport failures stay retryable. Default: see `condition`. */
  statusCodes?: number[];
  /** Called before each retry's delay with the 1-based attempt, the last response and the delay in ms. */
  onRetry?: (attempt: number, response: ApiResponse<unknown>, delay: number) => void;
}

/** Extra facts `shouldRetry` needs beyond the response. */
export interface RetryContext {
  /** HTTP method of the request being retried, checked against `RetryConfig.methods`. */
  method?: string;
}

/** Options for `exponentialBackoff()`. */
export interface BackoffOptions {
  /** First delay in ms. Default 300. */
  base?: number;
  /** Growth factor per attempt. Default 2. */
  factor?: number;
  /** Upper bound in ms. Default 30 000. */
  max?: number;
  /** Full jitter in [0, delay]. Default `false`. */
  jitter?: boolean;
}

/**
 * Query parameters: a plain object (arrays repeat the key, Dates become ISO 8601 strings,
 * `null`/`undefined` are omitted, nested objects throw), a `URLSearchParams`, or key/value tuples.
 */
export type QueryParams = Record<string, unknown> | URLSearchParams | Array<[string, unknown]>;

/** Custom query serializer; returns the query string without the leading `?`. */
export type ParamsSerializer = (params: QueryParams) => string;

/** The request as it was actually sent, attached to every response. */
export interface ResolvedRequest {
  /** Full URL including the query string. */
  readonly url: string;
  readonly method: string;
  /**
   * Headers as sent, lower-cased, including defaults and the auto Content-Type. Credential
   * headers (authorization, proxy-authorization, cookie, set-cookie, x-api-key, x-auth-token)
   * are replaced by `[redacted]`; `config.headers` keeps the real values for replays.
   */
  readonly headers: Record<string, string>;
  /** The `data` before serialisation. */
  readonly body?: unknown;
  /** The config after request interceptors; pass it to `api.any()` to re-issue the request. */
  readonly config: RequestConfig;
  /** 1-based attempt number; 0 when no network call was made (short-circuit, interceptor error). */
  readonly attempt: number;
}

/** Return this from a request interceptor to answer without a network call. */
export interface ShortCircuit<T = unknown> {
  response: ApiResponse<T>;
}

export type RequestInterceptorResult = RequestConfig | ShortCircuit;

export interface ApiResponse<T> {
  ok: boolean;
  problem: PROBLEM_CODE | null;
  originalError: Error | null;
  data?: T;
  status?: number;
  headers?: Record<string, string>;
  duration?: number;
  response?: Response;
  /** Set by the client on every response it produces; optional only for hand-built responses. */
  request?: ResolvedRequest;
}

export interface ApiOkResponse<T> extends ApiResponse<T> {
  ok: true;
  problem: null;
  data: T;
  status: number;
}

export interface ApiErrorResponse<T> extends ApiResponse<T> {
  ok: false;
  problem: PROBLEM_CODE;
  /** Discriminated union for precise narrowing — use instead of or alongside `problem`. */
  error: RefetchError;
  originalError: Error | null;
}

/** Known methods for autocomplete; any other string (e.g. `PROPFIND`) is accepted too. */
export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | 'QUERY'
  | 'LINK'
  | 'UNLINK'
  | (string & {});

/**
 * How the response body is read. `'auto'` (default) decides from `Content-Type`; the others
 * force one reader whatever the server declares. `'stream'` returns the unread
 * `ReadableStream` (the timeout then covers headers only); `'none'` skips the body.
 */
export type ResponseBodyType =
  | 'auto'
  | 'json'
  | 'text'
  | 'blob'
  | 'arrayBuffer'
  | 'bytes'
  | 'stream'
  | 'none';

/** Replaces `JSON.parse` for response bodies (success and error). Throw to report a parse error. */
export type ParseJson = (
  text: string,
  context: { response: Response; request?: ResolvedRequest },
) => unknown;

/** Replaces `JSON.stringify` for plain object and array request bodies. */
export type StringifyJson = (value: unknown) => string;

/** Body handling options shared by the instance config and per-request config. */
export interface BodyOptions {
  /** How to read the response body. Default `'auto'`. */
  responseType?: ResponseBodyType;
  /** Custom JSON parser, e.g. BigInt-safe or prototype-pollution-safe. */
  parseJson?: ParseJson;
  /** Custom JSON serialiser for object and array bodies. */
  stringifyJson?: StringifyJson;
  /**
   * Largest response body to accept, in bytes after decompression. Reading stops at the cap
   * and the result is an error response with `kind: 'size'`; it is never retried. With
   * `responseType: 'stream'` the returned stream errors once the cap is passed.
   */
  maxResponseSize?: number;
}

/** `true` rejects on every error response; a predicate picks which ones reject. */
export type ThrowOnError = boolean | ((response: ApiErrorResponse<unknown>) => boolean);

export interface RequestConfig extends Omit<RequestInit, 'body' | 'method'>, BodyOptions {
  url?: string;
  method?: HttpMethod;
  params?: QueryParams;
  /** Replaces the default query serialisation for this request. */
  paramsSerializer?: ParamsSerializer;
  data?: unknown;
  /** Per-attempt timeout in ms (covers headers and body). `0` or `false` disables it. */
  timeout?: number | false;
  /** Deadline for the whole call including retries and back-off. Disabled by default. */
  totalTimeout?: number | false;
  /** Required by fetch for ReadableStream bodies; set automatically when omitted. */
  duplex?: 'half';
  /** Free-form data carried through interceptors and monitors; never sent. */
  context?: Record<string, unknown>;
  baseURL?: string;
  /** Retry on failure. Number = attempt count shorthand; object for full control. */
  retry?: number | RetryConfig;
  /** Overrides the instance `throwOnError` for this request. */
  throwOnError?: ThrowOnError;
  /**
   * Validates the response body of a successful request with any Standard Schema validator
   * (Zod, Valibot, ArkType…). `data` becomes the schema output and its type is inferred. A
   * mismatch is an error response with `kind: 'validation'`; it is never retried. Runs after
   * response interceptors and before monitors.
   */
  schema?: StandardSchemaV1;
  /** Validates `data` before it is serialised; a mismatch fails without a network call. */
  bodySchema?: StandardSchemaV1;
}

/**
 * The `data` type of a response: the output of `config.schema` when one is passed and the
 * response generic is left to inference, otherwise the explicit generic `T`.
 */
export type SchemaData<T, C> = C extends { schema: infer S extends StandardSchemaV1 }
  ? StandardSchemaV1.InferOutput<S>
  : T;

export interface RefetchConfig extends Omit<RequestInit, 'method' | 'body'>, BodyOptions {
  baseURL?: string;
  headers?: HeadersInit;
  /** Default per-attempt timeout in ms. `0` or `false` disables it. Defaults to 10 000. */
  timeout?: number | false;
  /** Default deadline for a whole call including retries. Disabled by default. */
  totalTimeout?: number | false;
  /** Replaces the default query serialisation for every request. */
  paramsSerializer?: ParamsSerializer;
  /** Instance-wide retry default. Overridden by per-request `retry`. */
  retry?: number | RetryConfig;
  /**
   * Reject with a typed `RefetchResponseError` instead of resolving an error response. `true`
   * throws for every failure; a function decides per response. Thrown after retries, response
   * interceptors and monitors have run. Default `false`.
   */
  throwOnError?: ThrowOnError;
}

export type RequestTransform = (config: RequestConfig) => void;
export type AsyncRequestTransform = (config: RequestConfig) => Promise<void>;
export type ResponseTransform = <T>(response: ApiResponse<T>) => void;
export type AsyncResponseTransform = <T>(response: ApiResponse<T>) => Promise<void>;
export type Monitor = <T>(response: ApiResponse<T>) => void;

export interface InterceptorHandler<T, R = T> {
  onFulfilled?: (value: T) => R | Promise<R>;
  onRejected?: (error: unknown) => R | Promise<R>;
}

export interface InterceptorManager<T, R = T> {
  use(
    onFulfilled?: (value: T) => R | Promise<R>,
    onRejected?: (error: unknown) => R | Promise<R>,
  ): number;
  eject(id: number): void;
  clear(): void;
}

export interface RefetchInstance {
  config: RefetchConfig;

  /**
   * Axios-style interceptors.
   * Request interceptors run LIFO (last registered runs first).
   * Response interceptors run FIFO (first registered runs first).
   */
  interceptors: {
    request: InterceptorManager<RequestConfig, RequestInterceptorResult>;
    response: InterceptorManager<ApiResponse<unknown>>;
  };

  get<T = unknown, C extends RequestConfig = RequestConfig>(
    url: string,
    params?: QueryParams,
    config?: C,
  ): Promise<ApiResponse<SchemaData<T, C>>>;

  post<TResponse = unknown, TBody = unknown, C extends RequestConfig = RequestConfig>(
    url: string,
    data?: TBody,
    config?: C,
  ): Promise<ApiResponse<SchemaData<TResponse, C>>>;

  put<TResponse = unknown, TBody = unknown, C extends RequestConfig = RequestConfig>(
    url: string,
    data?: TBody,
    config?: C,
  ): Promise<ApiResponse<SchemaData<TResponse, C>>>;

  patch<TResponse = unknown, TBody = unknown, C extends RequestConfig = RequestConfig>(
    url: string,
    data?: TBody,
    config?: C,
  ): Promise<ApiResponse<SchemaData<TResponse, C>>>;

  /** `DELETE` with query params; pass `config.data` to send a body (bulk deletes). */
  delete<T = unknown, C extends RequestConfig = RequestConfig>(
    url: string,
    params?: QueryParams,
    config?: C,
  ): Promise<ApiResponse<SchemaData<T, C>>>;

  head<T = unknown, C extends RequestConfig = RequestConfig>(
    url: string,
    params?: QueryParams,
    config?: C,
  ): Promise<ApiResponse<SchemaData<T, C>>>;

  link<T = unknown, C extends RequestConfig = RequestConfig>(
    url: string,
    params?: QueryParams,
    config?: C,
  ): Promise<ApiResponse<SchemaData<T, C>>>;

  unlink<T = unknown, C extends RequestConfig = RequestConfig>(
    url: string,
    params?: QueryParams,
    config?: C,
  ): Promise<ApiResponse<SchemaData<T, C>>>;

  /**
   * RFC 10008 `QUERY`: a safe, idempotent request whose body defines the query. `Content-Type`
   * is set from the body like any other request; pass your own for formats such as SQL.
   */
  query<TResponse = unknown, TBody = unknown, C extends RequestConfig = RequestConfig>(
    url: string,
    data?: TBody,
    config?: C,
  ): Promise<ApiResponse<SchemaData<TResponse, C>>>;

  /** `OPTIONS` with query params; pass `config.data` to send a body. */
  options<T = unknown, C extends RequestConfig = RequestConfig>(
    url: string,
    params?: QueryParams,
    config?: C,
  ): Promise<ApiResponse<SchemaData<T, C>>>;

  any<T = unknown, C extends RequestConfig = RequestConfig>(
    config: C,
  ): Promise<ApiResponse<SchemaData<T, C>>>;

  /**
   * Fetch a resource as a raw ReadableStream — no body parsing.
   * Useful for large downloads, SSE, or chunked data.
   */
  stream<T = Uint8Array>(
    url: string,
    params?: QueryParams,
    config?: RequestConfig,
  ): Promise<ApiResponse<ReadableStream<T>>>;

  /** @deprecated Use `interceptors.request.use()` instead. */
  addRequestTransform(transform: RequestTransform | AsyncRequestTransform): void;
  /** @deprecated Use `interceptors.response.use()` instead. */
  addResponseTransform(transform: ResponseTransform | AsyncResponseTransform): void;
  addMonitor(monitor: Monitor): void;
  /** @deprecated Use `interceptors.request.eject()` instead. */
  removeRequestTransform(transform: RequestTransform | AsyncRequestTransform): boolean;
  /** @deprecated Use `interceptors.response.eject()` instead. */
  removeResponseTransform(transform: ResponseTransform | AsyncResponseTransform): boolean;
  removeMonitor(monitor: Monitor): boolean;
  /** @deprecated Use `interceptors.request.clear()` instead. */
  clearRequestTransforms(): void;
  /** @deprecated Use `interceptors.response.clear()` instead. */
  clearResponseTransforms(): void;
  clearMonitors(): void;

  setHeader(name: string, value: string): void;
  setHeaders(headers: Record<string, string>): void;
  deleteHeader(name: string): void;
  setBaseURL(baseURL: string): void;
  getBaseURL(): string | undefined;
}

export function isOkResponse<T>(response: ApiResponse<T>): response is ApiOkResponse<T> {
  return response.ok === true;
}

export function isErrorResponse<T>(response: ApiResponse<T>): response is ApiErrorResponse<T> {
  return response.ok === false;
}
