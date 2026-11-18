# Retry, timeouts and cancellation

## Retry

```typescript
// Instance-wide default — 3 total attempts (1 original + 2 retries)
const api = create({ baseURL: 'https://api.example.com', retry: 3 });

// Full per-request config
const response = await api.get('/data', undefined, {
  retry: {
    attempts: 4,
    delay: 300,                 // base delay in ms
    backoff: 'exponential',     // 300ms, 600ms, 1.2s …
    jitter: true,               // each delay becomes random in [0, delay]
    maxDelay: 5_000,
    methods: ['GET', 'PUT'],    // only retry idempotent calls
    statusCodes: [408, 429, 500, 502, 503, 504],
    maxRetryAfter: 30_000,      // give up if the server asks for longer
    onRetry: (attempt, last, delay) => console.warn('Retry', attempt, last.status, 'in', delay),
  },
});

// Or hand the delay function the standard formula
import { exponentialBackoff } from '@mshindi-labs/refetch/retry';
await api.get('/data', undefined, { retry: { attempts: 5, delay: exponentialBackoff({ base: 200, jitter: true }) } });
```

| Option | Default | Meaning |
|---|---|---|
| `attempts` | – | total attempts including the first |
| `delay` | unset | base delay in ms, or `(attempt) => ms` (then `backoff`/`jitter`/`maxDelay` are not applied). Unset means the default back-off: 300 ms doubling per attempt, full jitter, capped at 30 s |
| `backoff` | `'fixed'` when `delay` is set | `'linear'` multiplies by the attempt, `'exponential'` doubles per attempt |
| `jitter` | `false` when `delay` is set | full jitter in `[0, delay]` |
| `maxDelay` | – | cap for computed delays |
| `respectRetryAfter` | `true` | wait for `Retry-After` (seconds or HTTP-date) or `RateLimit-Reset` / `X-RateLimit-Reset` instead of the computed delay; never jittered |
| `maxRetryAfter` | `60_000` | stop retrying when the server asks for longer than this (caps hostile or absurd `Retry-After` values) |
| `methods` | `GET` `HEAD` `PUT` `DELETE` `OPTIONS` `TRACE` `QUERY` | only retry these methods (case-insensitive) |
| `statusCodes` | `408` `413` `429` `500` `502` `503` `504` | only retry these status codes; transport failures stay retryable |
| `condition` | see below | full override: return `true` to retry |
| `onRetry` | – | called before each delay with `(attempt, lastResponse, delayMs)` |

**Defaults are safe to leave on.** Only idempotent methods are retried, so a `POST` or `PATCH` is never sent twice unless you list it (`retry: { attempts: 3, methods: ['POST'] }`) or supply a `condition`. Only the statuses above are retried: a `404` or `501` will not improve on a second try. Parse failures, schema validation failures, oversized responses, cancelled requests, `totalTimeout` expiries and requests with a one-shot `ReadableStream` body are never retried. The lists are exported as `DEFAULT_RETRY_METHODS` and `DEFAULT_RETRY_STATUS_CODES`.

Request interceptors run **once** before the retry loop. Response interceptors run **per attempt**.

Cancelled requests and `totalTimeout` expiries are never retried, whatever `condition` returns, and a cancel during the back-off delay returns immediately with `kind: 'cancel'`.

## Timeouts

```typescript
const api = create({ baseURL: 'https://api.example.com', timeout: 10_000 });

// Per-attempt timeout: covers the wait for headers *and* reading the body
await api.get('/report', undefined, { timeout: 30_000 });

// 0 or false disables the per-attempt timeout for this request
await api.get('/export', undefined, { timeout: false });

// totalTimeout caps the whole call: every attempt, every retry back-off
await api.get('/flaky', undefined, { retry: 5, totalTimeout: 15_000 });
```

| Option | Default | Covers |
|---|---|---|
| `timeout` | 10 000 ms | one attempt: headers and body (`stream()`: headers only) |
| `totalTimeout` | disabled | the whole call including retries and back-off delays |

Both produce `problem: TIMEOUT_ERROR`, `error.kind === 'timeout'` and a `TimeoutError` whose `scope` tells them apart. Invalid values (negative, `NaN`, above 2³¹ − 1) reject with a `TypeError` / `RangeError` before any request is made. Signals are combined with `AbortSignal.any` where available (Node ≥ 20.3, browsers since early 2024) and with listeners elsewhere.

## Cancellation

```typescript
import { createCancelToken } from '@mshindi-labs/refetch';

const { token, cancel } = createCancelToken();

// Pass the AbortSignal in config
const req = api.get('/slow-resource', undefined, { signal: token });

// Cancel from outside
cancel('User navigated away');

const response = await req;
if (!response.ok && response.error.kind === 'cancel') {
  console.log('Reason:', response.error.reason);
}
```
