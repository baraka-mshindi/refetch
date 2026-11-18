import type {
  ApiErrorResponse,
  ApiResponse,
  BackoffOptions,
  RetryConfig,
  RetryContext,
} from './types.ts';

/** Methods retried by default: the idempotent ones (RFC 9110) plus QUERY (RFC 10008). */
export const DEFAULT_RETRY_METHODS = ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'TRACE', 'QUERY'];
/** Statuses retried by default: timeouts, rate limits and transient server failures. */
export const DEFAULT_RETRY_STATUS_CODES = [408, 413, 429, 500, 502, 503, 504];
/** Base and cap of the default back-off, used when no `delay` is configured. */
const DEFAULT_DELAY = 300;
const DEFAULT_MAX_DELAY = 30_000;
/** Longest server-requested delay honoured by default; longer means "come back later". */
export const DEFAULT_MAX_RETRY_AFTER = 60_000;
/** setTimeout cannot schedule beyond this; larger values would fire immediately. */
const MAX_DELAY = 2_147_483_647;
const RATE_LIMIT_RESET_HEADERS = ['ratelimit-reset', 'x-ratelimit-reset', 'x-rate-limit-reset'];

export function normalizeRetryConfig(retry?: number | RetryConfig): RetryConfig | null {
  if (retry === undefined || retry === null) return null;
  if (typeof retry === 'number') return { attempts: retry };
  return retry;
}

/** Full jitter: a random delay in [0, delay]. Server-provided delays are never jittered. */
function applyJitter(delay: number, jitter: boolean | undefined): number {
  return jitter ? Math.random() * delay : delay;
}

/** Delay before the given 1-based retry attempt, from `delay`, `backoff`, `maxDelay` and `jitter`. */
export function getRetryDelay(config: RetryConfig, attempt: number): number {
  // With no `delay` configured the default is exponential back-off with full jitter:
  // 300 ms, 600 ms, 1.2 s… capped at 30 s. Any explicit `delay` keeps a fixed, unjittered wait.
  const unset = config.delay === undefined;
  const base = config.delay ?? DEFAULT_DELAY;
  if (typeof base === 'function') return Math.min(MAX_DELAY, base(attempt));
  const backoff = config.backoff ?? (unset ? 'exponential' : 'fixed');
  let delay = base;
  if (backoff === 'linear') delay = base * attempt;
  else if (backoff === 'exponential') delay = base * 2 ** (attempt - 1);
  const maxDelay = config.maxDelay ?? (unset ? DEFAULT_MAX_DELAY : undefined);
  if (maxDelay !== undefined) delay = Math.min(delay, maxDelay);
  return applyJitter(Math.min(MAX_DELAY, delay), config.jitter ?? unset);
}

/** A `delay` function: `base * factor^(attempt - 1)` capped at `max`, optionally jittered. */
export function exponentialBackoff(options: BackoffOptions = {}): (attempt: number) => number {
  const { base = 300, factor = 2, max = 30_000, jitter = false } = options;
  return (attempt) => applyJitter(Math.min(max, base * factor ** (attempt - 1)), jitter);
}

/**
 * Delay requested by the server in ms, from `Retry-After` (seconds or HTTP-date) or a rate-limit
 * reset header (seconds from now, or a Unix timestamp in seconds or ms). `undefined` when absent.
 */
export function retryAfterDelay(response: ApiResponse<unknown>): number | undefined {
  const headers = response.headers;
  if (!headers) return undefined;

  const retryAfter = headers['retry-after'];
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
  }

  for (const name of RATE_LIMIT_RESET_HEADERS) {
    const value = headers[name];
    if (value === undefined) continue;
    const reset = Number(value);
    if (!Number.isFinite(reset)) continue;
    // Small values are seconds until reset (IETF draft); large ones are Unix timestamps.
    if (reset < 1e9) return Math.max(0, reset * 1000);
    const resetAt = reset < 1e12 ? reset * 1000 : reset;
    return Math.max(0, resetAt - Date.now());
  }
  return undefined;
}

function errorKind(response: ApiResponse<unknown>): string | undefined {
  // Hand-built responses (tests, interceptors) may omit `error`.
  return (response as Partial<ApiErrorResponse<unknown>>).error?.kind;
}

/**
 * Cancelled requests, total-timeout expiries, schema validation failures and oversized
 * responses are never retried, whatever `condition` says.
 */
function isUnretryable(response: ApiResponse<unknown>): boolean {
  if (response.ok) return false;
  const error = (response as Partial<ApiErrorResponse<unknown>>).error;
  if (!error) return false;
  if (error.kind === 'cancel' || error.kind === 'validation' || error.kind === 'size') return true;
  // Duck-typed so this module stays free of runtime imports (see TimeoutError.scope).
  return error.kind === 'timeout' && (error.cause as { scope?: unknown }).scope === 'total';
}

export function shouldRetry(
  response: ApiResponse<unknown>,
  config: RetryConfig,
  context: RetryContext = {},
): boolean {
  if (isUnretryable(response)) return false;
  if (config.condition) return config.condition(response);
  if (response.ok) return false;
  if (errorKind(response) === 'parse') return false;

  const method = context.method?.toUpperCase();
  const methods = config.methods ?? DEFAULT_RETRY_METHODS;
  if (method && !methods.some((m) => m.toUpperCase() === method)) return false;
  // Transport failures have no status and stay retryable.
  if (!response.status) return true;
  return (config.statusCodes ?? DEFAULT_RETRY_STATUS_CODES).includes(response.status);
}

/** Resolves after `ms`; rejects with `signal.reason` as soon as `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!signal) {
      setTimeout(resolve, ms);
      return;
    }
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
