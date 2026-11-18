# @mshindi-labs/refetch

[![CI](https://github.com/baraka-mshindi/refetch/actions/workflows/ci.yml/badge.svg)](https://github.com/baraka-mshindi/refetch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40mshindi-labs%2Frefetch)](https://www.npmjs.com/package/@mshindi-labs/refetch)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/baraka-mshindi/refetch/badge)](https://scorecard.dev/viewer/?uri=github.com/baraka-mshindi/refetch)

A modern, production-grade HTTP client built on native `fetch` — composable, class-free TypeScript, interceptors, retry, streaming, and tree-shakeable exports.

## Features

- **Composable, class-free API** — a factory and plain functions, no `this`, compose via `pipe()` (instances are stateful: `setHeader`, `setBaseURL` and `interceptors.use` change them in place)
- **Interceptors** — axios-style request/response middleware with ID-based ejection
- **Discriminated error union** (`RefetchError`) for precise narrowing per error kind
- **Schema validation** — any Standard Schema validator (Zod, Valibot, ArkType) via `schema` / `bodySchema`, with inferred `data` types
- **Opt-in throw mode** — `throwOnError` and `unwrap()` reject with typed error classes for TanStack Query-style callers
- **Retry** — per-request and instance-wide, fully configurable with custom delay/condition
- **Streaming** — raw `ReadableStream` via `stream()` for any method, plus SSE and NDJSON decoders for LLM-style streams
- **Progress** — `onDownloadProgress` and `onUploadProgress` callbacks
- **Cancellation** — `createCancelToken()` wraps `AbortController`
- **Child instances** — `extend()` derives a client that inherits config, interceptors and monitors
- **Middleware HOFs** — `withAuth`, `withTimeout`, `withLogging`, `withHeaders`, `withBaseURL`
- **Full body support** — JSON, `FormData`, `URLSearchParams`, `Blob`, `ArrayBuffer`, `ReadableStream`
- **Full response parsing** — JSON, `+json` variants, form-encoded, binary, text, empty bodies; `responseType` override and pluggable `parseJson` / `stringifyJson`
- **Tree-shakeable** — sub-path exports for retry, middleware, pipe, and stream
- **Zero runtime dependencies**

## Installation

```bash
npm install @mshindi-labs/refetch
```

## Quick Start

```typescript
import { create } from '@mshindi-labs/refetch';

const api = create({
  baseURL: 'https://api.example.com',
  timeout: 10_000,
});

const response = await api.get<User>('/users/1');

if (response.ok) {
  console.log(response.data); // typed as User
} else {
  console.error(response.problem, response.error);
}
```

## HTTP Methods

`GET`, `HEAD`, `DELETE` and `OPTIONS` take a single response generic. `POST`, `PUT`, `PATCH` and `QUERY` take two — response type and body type:

```typescript
// Read
const user  = await api.get<User>('/users/1');
const users = await api.get<User[]>('/users', { page: 1, limit: 10 });

// Write — both generics explicit
const created = await api.post<User, CreateUserDto>('/users', dto);
const updated = await api.put<User, UpdateUserDto>('/users/1', data);
const patched = await api.patch<User, Partial<User>>('/users/1', { name: 'New' });

// Other
await api.delete('/users/1');
await api.delete('/users', undefined, { data: { ids: [1, 2, 3] } }); // DELETE with a body
await api.head('/health');
await api.options('/users');

// QUERY (RFC 10008): a safe, idempotent read whose body defines the query
const found = await api.query<User[], UserFilter>('/users/search', { role: 'admin', active: true });
await api.link('/images/1.jpg', {}, { headers: { Link: '<...>; rel="tag"' } });
await api.unlink('/images/1.jpg', {}, { headers: { Link: '<...>; rel="tag"' } });

// Any HTTP verb
await api.any({ method: 'PROPFIND', url: '/dav', headers: { Depth: '1' } });
```

| Method | Second argument | Body |
|---|---|---|
| `get`, `head` | query params | never (fetch rejects a body on GET / HEAD) |
| `delete`, `options`, `link`, `unlink` | query params | only when `config.data` is set |
| `post`, `put`, `patch`, `query` | body | yes |
| `any({ method, … })` | — | `config.data`, by the rules above |

`QUERY` gets its `Content-Type` from the body like any other request (`application/json` for objects); set the header yourself for other query languages. It is safe to retry, and the retry policy treats it like any other method. `TRACE` has no helper: `fetch` refuses to send it.

**Query params** accept a plain object (arrays repeat the key, `Date` values become ISO 8601 strings, `null`/`undefined` are omitted, nested objects throw a `TypeError` naming the key), a `URLSearchParams`, or `[key, value]` tuples. Pass `paramsSerializer` on the instance or the request to use another format:

```typescript
await api.get('/search', new URLSearchParams({ q: 'refetch' }));
await api.get('/events', { since: new Date('2026-01-01'), tags: ['a', 'b'] }); // ?since=2026-01-01T00%3A00%3A00.000Z&tags=a&tags=b

const api = create({ baseURL, paramsSerializer: (params) => qs.stringify(params, { arrayFormat: 'brackets' }) });
```

## Response Format

Every request returns `ApiResponse<T>` — the shape is identical whether the request succeeded or failed:

```typescript
interface ApiResponse<T> {
  ok: boolean;              // true for 200–299
  problem: PROBLEM_CODE | null;
  originalError: Error | null;
  data?: T;
  status?: number;
  headers?: Record<string, string>;
  duration?: number;        // milliseconds
  response?: Response;      // raw fetch Response
  request?: ResolvedRequest; // url, method, headers as sent (credentials redacted), body, config, attempt
}

// When ok === false, the error field is also present:
interface ApiErrorResponse<T> extends ApiResponse<T> {
  ok: false;
  problem: PROBLEM_CODE;
  error: RefetchError;      // discriminated union — see Error Handling
}
```

**Type guards:**

```typescript
import { isOkResponse, isErrorResponse, setRequestHeader } from '@mshindi-labs/refetch';

if (isOkResponse(response)) {
  response.data; // T — guaranteed present
}

if (isErrorResponse(response)) {
  response.error; // RefetchError — fully narrowable
}
```

## Error Handling

### PROBLEM_CODE

```typescript
import { PROBLEM_CODE } from '@mshindi-labs/refetch';

switch (response.problem) {
  case PROBLEM_CODE.CLIENT_ERROR:    // 400–499
  case PROBLEM_CODE.SERVER_ERROR:    // 500–599
  case PROBLEM_CODE.TIMEOUT_ERROR:
  case PROBLEM_CODE.NETWORK_ERROR:
  case PROBLEM_CODE.CONNECTION_ERROR:
  case PROBLEM_CODE.CANCEL_ERROR:
  case PROBLEM_CODE.PARSE_ERROR:     // 2xx whose body could not be decoded
  case PROBLEM_CODE.VALIDATION_ERROR: // body rejected by a schema
  case PROBLEM_CODE.RESPONSE_TOO_LARGE: // body larger than maxResponseSize
  case PROBLEM_CODE.UNKNOWN_ERROR:
}
```

**Parse failures.** A 2xx whose body cannot be decoded as its declared media type (for example malformed JSON) is an error response: `problem: PARSE_ERROR`, `error.kind === 'parse'`, a `ParseError` cause, `response.data` holding the raw text, and `status`/`headers`/`response` intact. A malformed *error* body never masks the HTTP failure: it stays `kind: 'http'` with the raw text as `data`. Parse failures are not retried by default.

**Typed causes.** For transport-level failures `originalError` (and `error.cause`) is one of the exported classes: `TimeoutError` (with `timeout` and `scope: 'request' | 'total'`), `CancelError`, or `NetworkError` (wraps the `TypeError` thrown by `fetch`, still an `instanceof TypeError`, with `code` such as `ECONNREFUSED` when the platform provides one, which maps to `CONNECTION_ERROR`). Any non-2xx status, including 3xx under `redirect: 'manual'`, is reported as `kind: 'http'` with its status.

### RefetchError discriminated union

Use `response.error` when you need typed access to error-specific fields:

```typescript
if (!response.ok) {
  switch (response.error.kind) {
    case 'http':
      console.error(response.error.status, response.error.statusText);
      break;
    case 'timeout':
      console.error(`Timed out after ${response.error.duration}ms`);
      break;
    case 'cancel':
      console.info('Cancelled:', response.error.reason);
      break;
    case 'network':
      console.error('Network failure:', response.error.cause);
      break;
    case 'parse':
      // response.data holds the raw body text, response.status/headers are still set
      console.error('Parse error for', response.error.contentType, response.error.cause);
      break;
    case 'unknown':
      console.error(response.error.cause);
      break;
  }
}
```

### Throwing instead of returning

Error responses are returned, not thrown, by default. Two opt-ins give rejection semantics for code that expects them (TanStack Query, SWR, route loaders, `Promise.all`):

```typescript
import { create, unwrap, isRefetchError, RefetchHttpError } from '@mshindi-labs/refetch';

// Per call: data on success, a typed error otherwise
const user = await api.get<User>('/users/1').then(unwrap);

// Per instance or per request
const strict = create({ baseURL, throwOnError: true });
await strict.get('/users/1');                                    // rejects on any failure
await strict.get('/users/1', undefined, { throwOnError: false }); // back to a result object
create({ baseURL, throwOnError: (response) => (response.status ?? 0) >= 500 });
```

Each `RefetchError` kind has its own class, all extending `RefetchResponseError`:

| `kind` | Class | Notes |
|---|---|---|
| `http` | `RefetchHttpError` | `status`, `statusText`, `data` (the error body) |
| `timeout` | `RefetchTimeoutError` | `cause` is the `TimeoutError` |
| `network` | `RefetchNetworkError` | `cause` is the `NetworkError` |
| `cancel` | `RefetchCancelError` | |
| `parse` | `RefetchParseError` | `data` is the raw text |
| `size` | `RefetchSizeError` | `limit` in bytes |
| `validation` | `RefetchValidationError` | `issues` from the validator; `data` is the unvalidated body |
| `unknown` | `RefetchUnknownError` | for example a throwing interceptor |

```typescript
try {
  await strict.post('/orders', order);
} catch (error) {
  if (error instanceof RefetchHttpError && error.status === 409) {
    showConflict(error.data);
  } else if (isRefetchError(error)) {
    report(error.kind, error.problem, error.request?.url);
  } else {
    throw error;
  }
}
```

Every error carries `kind`, `problem`, `status`, `data`, `headers`, `request`, the full `response` (the `ApiErrorResponse`) and the underlying `cause`. Throwing happens last: retries, response interceptors and monitors run exactly as they do without it, so an interceptor can still turn a failure into a success.

`response`, `request` and `headers` are non-enumerable, so `JSON.stringify(error)` and error reporters that walk enumerable properties do not pick up the request config (which holds unredacted credentials for replays) or the request body. `data`, the server's error body, is enumerable; scrub it yourself if your API echoes secrets.

## Interceptors

Return-based, ID-tracked, and removable. Request interceptors run **LIFO** (last registered, first to run); response interceptors run **FIFO**.

Request interceptors always receive `config.headers` as a plain object with lower-cased keys and the instance headers already merged in (the default `Accept` is applied at send time, so it can still be overridden). Whatever shape you hold, `setRequestHeader(config, name, value)` returns a copy with the header set.

```typescript
// Add a request interceptor
const id = api.interceptors.request.use(
  async (config) => setRequestHeader(config, 'Authorization', `Bearer ${await getToken()}`),
  // Optional onRejected handler
  (error) => { throw error; },
);

// Eject by ID
api.interceptors.request.eject(id);

// Response interceptor — normalize data, handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => { throw error; },
);

// Clear all interceptors
api.interceptors.request.clear();
api.interceptors.response.clear();
```

**Short-circuiting.** A request interceptor may return `{ response }` instead of a config: no network call is made and that response still passes through the response interceptors and monitors (`response.request.attempt` is `0`). Handy for caches and offline modes.

**Request context and re-issuing.** Every response carries `response.request`: the URL, method and headers as sent (credential headers such as `Authorization`, `Cookie` and `X-Api-Key` show as `[redacted]`, so the snapshot is safe to log), the body, the post-interceptor `config` with the real headers for replays, and the attempt number. Pass `config` back to `api.any()` to replay a request, and use `config.context` (never sent) to carry state between interceptors. The classic refresh-on-401:

```typescript
let token = await loadToken();
api.interceptors.request.use((config) => setRequestHeader(config, 'Authorization', `Bearer ${token}`));
api.interceptors.response.use(async (response) => {
  if (response.status !== 401 || !response.request || response.request.config.context?.refreshed) return response;
  token = await refreshToken();
  return api.any({ ...response.request.config, context: { refreshed: true } });
});
```

Interceptors never throw to the caller. If a request interceptor throws or rejects (a failing token fetch in `withAuth`, say), the request is not sent and the call resolves with an error response (`problem: UNKNOWN_ERROR`, `error.kind === 'unknown'`, `originalError` set) that still passes through the response interceptors and monitors. The same holds for `stream()`.

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
| `delay` | `0` | base delay in ms, or `(attempt) => ms` (then `backoff`/`jitter`/`maxDelay` are not applied) |
| `backoff` | `'fixed'` | `'linear'` multiplies by the attempt, `'exponential'` doubles per attempt |
| `jitter` | `false` | full jitter in `[0, delay]` |
| `maxDelay` | – | cap for computed delays |
| `respectRetryAfter` | `true` | wait for `Retry-After` (seconds or HTTP-date) or `RateLimit-Reset` / `X-RateLimit-Reset` instead of the computed delay; never jittered |
| `maxRetryAfter` | `60_000` | stop retrying when the server asks for longer than this (caps hostile or absurd `Retry-After` values) |
| `methods` | all | only retry these methods (case-insensitive) |
| `statusCodes` | see below | only retry these status codes; transport failures stay retryable |
| `condition` | see below | full override: return `true` to retry |
| `onRetry` | – | called before each delay with `(attempt, lastResponse, delayMs)` |

**Default condition:** retry on any non-ok response except status codes 400, 401, 403, 404, 422 and parse failures. Cancelled requests, `totalTimeout` expiries and requests with a one-shot `ReadableStream` body are never retried. In v4 the defaults move to idempotent methods and an explicit status allow-list; set `methods` and `statusCodes` today to opt in.

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

## Streaming

`stream()` returns the raw `ReadableStream` without parsing the body. It accepts any method and body, runs response interceptors and monitors, and honours `throwOnError`:

```typescript
const download = await api.stream('/large-file.bin');
if (download.ok) {
  const reader = download.data.getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    processChunk(chunk.value); // Uint8Array
  }
}

const upload = await api.stream('/render', undefined, { method: 'POST', data: { scene } });
```

`stream()` is shorthand for `responseType: 'stream'` with retries off. `timeout` covers the wait for headers only, the request `signal` stays linked to the body, and a failed request resolves as an error response with its parsed error body.

### Server-Sent Events and NDJSON

The `/stream` sub-path decodes the two common streaming formats into async iterables. Nothing is buffered beyond the current line, and breaking out of the loop cancels the download.

```typescript
import { sse, ndjson } from '@mshindi-labs/refetch/stream';

// LLM chat completion: POST + text/event-stream
const chat = await sse(api, '/v1/chat/completions', {
  method: 'POST',
  data: { model, messages, stream: true },
  idleTimeout: 30_000, // fail if the stream goes quiet for 30 s
});

if (chat.ok) {
  for await (const event of chat.data) {
    if (event.data === '[DONE]') break;
    render(JSON.parse(event.data).choices[0].delta.content);
  }
} else {
  showError(chat.problem, chat.data); // ordinary error response, body parsed
}

// NDJSON: one JSON value per line
const logs = await ndjson<LogLine>(api, '/logs/tail');
if (logs.ok) for await (const line of logs.data) append(line);
```

- `sse()` and `ndjson()` call `api.stream()`, so everything above applies. They send `Accept: text/event-stream` / `application/x-ndjson` unless you set one.
- Each SSE event is `{ data, event?, id?, retry? }`, parsed by the WHATWG rules: comments are skipped, multiple `data:` lines are joined with `\n`, `\n`, `\r\n` and `\r` are all accepted, and an event cut off before its blank line is discarded. `id` is the last event ID seen so far.
- **Cancellation:** abort the request `signal` (or call `cancel()` from `createCancelToken()`). The `for await` loop then throws the abort reason, a `CancelError` for cancel tokens. The response has already resolved by then, so this arrives as a thrown error, not as `kind: 'cancel'`.
- **Reconnecting** is up to you: keep the last `event.id` and pass it back as a `Last-Event-ID` header on the next call.
- `ndjson()` uses `config.parseJson` when set; an invalid line throws a `SyntaxError` from the loop.
- Already holding a stream? Use the decoders directly: `parseSse(stream)` and `parseNdjson(stream, { parseJson })`.

## Progress

```typescript
await api.get<Blob>('/video.mp4', undefined, {
  responseType: 'blob',
  onDownloadProgress: ({ percent, transferredBytes, totalBytes }) => bar.set(percent),
});

await api.post('/upload', formData, {
  onUploadProgress: ({ percent }) => bar.set(percent),
});
```

Both callbacks receive `({ transferredBytes, totalBytes, percent }, chunk)` for every chunk, then one final call with `percent: 1` and an empty chunk. `percent` runs from 0 to 1. An error thrown inside a callback is logged and ignored; it never fails the request.

**Download**

- Bytes are counted after decompression. `totalBytes` comes from `Content-Length`; it is `0` (and `percent` stays `0` until the final call) when the header is missing or the body is compressed.
- With `responseType: 'stream'` the callback fires as you read the stream, not before the call resolves.
- Bodiless responses (204, 304) produce no calls. If `maxResponseSize` is exceeded, progress stops and there is no final call.

**Upload**

- Where the runtime can stream request bodies (Node, Bun, Deno, and Chromium over HTTP/2 or HTTP/3) the body is sent as a counted stream and the callback fires per chunk. The request is then sent without `Content-Length` (chunked), and it cannot follow a 307 / 308 redirect.
- Elsewhere (Firefox, Safari), and for `keepalive` or `mode: 'no-cors'` requests, the body is sent unchanged and the callback fires once, at 100 %, when the response arrives.
- Retries work: the body is re-sent and progress starts again from 0.
- Chromium decides HTTP/2 support at send time, so an upload with progress to an HTTP/1.1 server fails there with a network error. Leave `onUploadProgress` off for such servers.

## Middleware + pipe

`pipe` chains middleware HOFs onto an instance without mutation at the call site:

```typescript
import { create, pipe } from '@mshindi-labs/refetch';
import { withAuth, withTimeout, withLogging, withHeaders, withBaseURL } from '@mshindi-labs/refetch/middleware';

const api = pipe(
  create({ baseURL: 'https://api.example.com' }),
  withAuth(async () => await getAccessToken()),
  withTimeout(8_000),
  withLogging(),
);
```

| HOF | Effect |
|---|---|
| `withAuth(getToken, { origins? })` | Injects `Authorization: Bearer <token>` for requests to the base URL's origin (see [Security](#security)) — `getToken` called each time |
| `withTimeout(ms)` | Sets request timeout for all requests |
| `withHeaders(headers)` | Merges additional default headers |
| `withBaseURL(url)` | Overrides the base URL |
| `withLogging(logger?)` | Logs each request and response; defaults to `console` |

Sub-path import (tree-shaking):

```typescript
import { withAuth, withLogging } from '@mshindi-labs/refetch/middleware';
import { pipe }                  from '@mshindi-labs/refetch/pipe';
```

## Body Formats

All native `fetch` body types are passed through without transformation. `Content-Type` is set automatically based on body type:

| Body | Auto `Content-Type` |
|---|---|
| Plain object / array | `application/json` |
| `string` | `application/json` |
| `FormData` | *omitted* — browser sets `multipart/form-data; boundary=…` |
| `URLSearchParams` | `application/x-www-form-urlencoded;charset=UTF-8` |
| `Blob` | Blob's own `.type`, or `application/octet-stream` |
| `ArrayBuffer` / `ArrayBufferView` | `application/octet-stream` |
| `ReadableStream` | `application/octet-stream`, sent with `duplex: 'half'` (override via `config.duplex`) |

If you explicitly set `Content-Type` in your request headers, it takes precedence (except FormData, where it is always removed to preserve the browser-managed boundary).

**String bodies are sent as JSON.** A `string` body is assumed to be pre-serialised JSON and gets `Content-Type: application/json`. For plain text or any other format, set the header yourself:

```typescript
await api.post('/notes', 'hello', { headers: { 'Content-Type': 'text/plain' } });
```

**Streaming request bodies** are one-shot: the stream is consumed by the first attempt, so such requests are never retried. In browsers they need HTTP/2 or HTTP/3 over HTTPS and are not supported by Safari; Node, Bun and Deno support them over HTTP/1.1 too.

**Form-encoded body:**

```typescript
await api.post('/login', new URLSearchParams({ username, password }));
```

**File upload:**

```typescript
const form = new FormData();
form.append('avatar', file);
await api.post('/profile/avatar', form);
```

## Response Parsing

`parseResponseBody` automatically picks the right parser based on `Content-Type`:

| Content-Type | Parsed to |
|---|---|
| `application/json` | `T` via `JSON.parse` |
| `application/*+json` (e.g. `vnd.api+json`, `ld+json`, `problem+json`) | `T` via `JSON.parse` |
| `application/x-www-form-urlencoded` | `Record<string, string>` via `URLSearchParams` |
| `text/event-stream` | `ReadableStream` (unread; see `responseType: 'stream'`) |
| `text/*`, `application/xml`, `application/xhtml+xml` | `string` |
| `image/*`, `audio/*`, `video/*` | `Blob` |
| `application/pdf`, `application/zip`, `application/gzip`, Office formats, etc. | `Blob` |
| 204 / 304 / `content-length: 0` | `null` |
| Anything else | `string` (fallback) |

### Overriding the parser: `responseType`

Set `responseType` per request (or as an instance default) to read the body one way whatever `Content-Type` the server sends:

| `responseType` | `data` |
|---|---|
| `'auto'` (default) | chosen from `Content-Type`, as in the table above |
| `'json'` | parsed JSON; a body that is not JSON is a `PARSE_ERROR` with the raw text in `data` |
| `'text'` | `string` |
| `'blob'` | `Blob` |
| `'arrayBuffer'` | `ArrayBuffer` |
| `'bytes'` | `Uint8Array` |
| `'stream'` | the unread `ReadableStream<Uint8Array>` |
| `'none'` | `null`; the body is discarded without being read |

```typescript
// JSON served as text/plain
const res = await api.get<Config>('/config.txt', undefined, { responseType: 'json' });

// Download as bytes
const file = await api.get<Uint8Array>('/report.pdf', undefined, { responseType: 'bytes' });

// Stream a POST response through the normal pipeline (interceptors, monitors, throwOnError)
const chat = await api.post<ReadableStream<Uint8Array>>('/chat', body, { responseType: 'stream' });
```

Notes:

- The generic is not inferred from `responseType`; pass the matching type yourself.
- With `'stream'` (and for `text/event-stream` under `'auto'`), `timeout` covers the wait for headers only, the request `signal` stays linked to the body so aborting it cancels the download, and a successful response is never retried. A failed request is still read normally, so `data` holds the parsed error body.
- For any type other than `'auto'` and `'json'`, `Accept` is sent as `*/*` unless you set one.
- `application/x-ndjson` is still buffered as text under `'auto'`; use `responseType: 'stream'` to read it incrementally.

### Custom JSON: `parseJson` and `stringifyJson`

Both can be set on the instance or per request. `parseJson` replaces `JSON.parse` for success and error bodies and receives `{ response, request }`; if it throws, the result is a `PARSE_ERROR` with the raw text in `data`. `stringifyJson` replaces `JSON.stringify` for plain object and array bodies (strings, `FormData` and other native bodies are left alone).

```typescript
import sjson from 'secure-json-parse';

const api = create({
  baseURL,
  parseJson: (text) => sjson.parse(text),                 // rejects __proto__ / constructor keys
  stringifyJson: (value) =>
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
});
```

## Schema Validation

Pass any [Standard Schema](https://standardschema.dev) validator (Zod, Valibot, ArkType, Effect Schema…) as `schema` and the response body is validated at the boundary. `data` is the schema's output and its type is inferred, so no generic is needed. refetch only uses the Standard Schema interface, so it still has no runtime dependencies.

```typescript
import { z } from 'zod';

const User = z.object({ id: z.number(), name: z.string() });

const response = await api.get('/users/1', undefined, { schema: User });
if (response.ok) {
  response.data.name; // typed as string
} else if (response.error.kind === 'validation') {
  response.error.issues; // [{ message, path }]
  response.data;         // the body as received, for logging
}
```

- A mismatch is an error response: `problem: VALIDATION_ERROR`, `error.kind === 'validation'`, with `status`, `headers` and the unvalidated `data` kept. In throw mode it is a `RefetchValidationError`.
- Validation runs after response interceptors (so they can normalise first) and before monitors, on successful responses only. Error bodies are not validated.
- Validation failures are never retried, whatever `retry.condition` says.
- Async validators are supported. A validator that throws is reported as `kind: 'unknown'`, not as a validation failure.
- An explicit generic still wins: `api.get<Custom>(url, undefined, { schema })` is typed as `Custom`.

`bodySchema` validates the outgoing `data` before it is serialised. The schema's output is what gets sent, and a mismatch fails with `kind: 'validation'` without a network call:

```typescript
const NewUser = z.object({ name: z.string().trim().min(1) });
await api.post('/users', { name: '  Ada  ' }, { schema: User, bodySchema: NewUser }); // sends {"name":"Ada"}
```

## Sub-path Exports

```typescript
import { pipe }                              from '@mshindi-labs/refetch/pipe';
import { withAuth, withLogging }             from '@mshindi-labs/refetch/middleware';
import { normalizeRetryConfig, shouldRetry } from '@mshindi-labs/refetch/retry';
import { sse, ndjson, parseSse, parseNdjson } from '@mshindi-labs/refetch/stream';
```

## Dynamic Instance Configuration

```typescript
api.setHeader('X-Request-Id', crypto.randomUUID());
api.setHeaders({ 'X-API-Key': 'key', 'X-Client-Version': '3.0' });
api.deleteHeader('X-Temporary');

api.setBaseURL('https://api-v2.example.com');
api.getBaseURL();
```

## Child Instances: `extend()`

Derive a client for one feature or one upstream from a shared base. The child inherits the parent's config, interceptors and monitors, and from then on the two are independent.

```typescript
const api = pipe(create({ baseURL: 'https://api.example.com' }), withAuth(getToken), withLogging());

const billing = api.extend({ headers: { 'X-Feature': 'billing' }, timeout: 30_000 });
const reports = api.extend({ baseURL: 'https://reports.example.com', retry: 3 });
```

| Option passed to `extend()` | How it combines with the parent |
|---|---|
| `headers` | merged, case-insensitively; the child wins on a clash |
| `retry` | merged field by field (a number is `{ attempts }`) |
| `signal` | combined: aborting either cancels the child's requests |
| everything else | the child's value replaces the parent's |

Interceptors and monitors registered on the parent **before** the call are copied in the same order (they get new IDs on the child). Anything registered, ejected or changed afterwards, on either side, stays on that side.

Pass a function to replace instead of merge. It receives a copy of the parent config and its result is used as is:

```typescript
const bare = api.extend((parent) => ({ baseURL: parent.baseURL })); // drops headers, retry, timeout…
```

Middleware still mutates the instance it is given: `pipe(api, withHeaders(…))` changes `api`. To add middleware to a child only, extend first: `pipe(api.extend(), withHeaders(…))`.

## Monitors

Observe all responses after transforms — fire-and-forget (exceptions caught internally):

```typescript
api.addMonitor((response) => {
  if (!response.ok) errorTracker.capture(response.error);
});

// Remove or clear
api.removeMonitor(fn);
api.clearMonitors();
```

## TypeScript Types

```typescript
import type {
  ApiResponse,
  ApiOkResponse,
  ApiErrorResponse,
  RefetchError,
  RetryConfig,
  RefetchConfig,
  RefetchInstance,
  RequestConfig,
  InterceptorManager,
  InterceptorHandler,
  Monitor,
} from '@mshindi-labs/refetch';
```

## Deprecated: Transforms

Mutation-based transforms are still supported for backward compatibility. Prefer interceptors for new code:

```typescript
// Deprecated — still works
api.addRequestTransform((config) => {
  config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
});
api.addResponseTransform((response) => {
  if (response.ok) response.data = normalize(response.data);
});
api.removeRequestTransform(fn);
api.clearRequestTransforms();

// Preferred — return-based, removable by ID
const id = api.interceptors.request.use((config) => ({
  ...config,
  headers: { ...config.headers, Authorization: `Bearer ${token}` },
}));
api.interceptors.request.eject(id);
```

## Integration with TanStack Query

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';
import { unwrap } from '@mshindi-labs/refetch';

function useUser(id: string) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: () => api.get<User>(`/users/${id}`).then(unwrap),
  });
}

function useCreateUser() {
  return useMutation({
    mutationFn: (dto: CreateUserDto) => api.post<User, CreateUserDto>('/users', dto).then(unwrap),
  });
}
```

`unwrap` returns `data` or throws a typed error, so `error` in the query result is a `RefetchResponseError` with `status`, `data` and `kind`; see [Throwing instead of returning](#throwing-instead-of-returning).

## Why Refetch?

How refetch compares with the other clients people choose in 2026. **Checked on 2026-11-18** against the latest version of each package on npm. Versions, dependencies, module format and Node range come from the npm registry (`npm view <pkg>`); feature rows for the other libraries reflect what each package's own README documents. "Not documented" means its README does not mention the feature, not that it is impossible.

| | refetch | ky 2.2.0 | ofetch 1.5.1 | up-fetch 2.6.3 | wretch 3.0.9 | axios 1.21.1 |
|---|---|---|---|---|---|---|
| Transport | native `fetch` | native `fetch` | native `fetch` | native `fetch` | native `fetch` | XHR / Node `http` (a `fetch` adapter exists) |
| Runtime dependencies | 0 | 0 | 3 | 0 | 0 | 4 |
| Module format | ESM + CJS | ESM only | ESM + CJS | ESM + CJS | ESM + CJS | ESM + CJS |
| Node range (`engines`) | ≥ 20.19 | ≥ 22 | not declared | ≥ 18 | ≥ 22 | not declared |
| Failure model | result object; opt-in throw | throws `HTTPError` | throws `FetchError` | throws `ResponseError` | throws; per-status catchers | throws `AxiosError` |
| Retry | built in, off by default | on by default (2, idempotent methods) | on by default (1, not POST / PUT / PATCH / DELETE) | built in, opt-in | middleware | not built in |
| Honours `Retry-After` | yes | yes | not documented | not documented | not documented | n/a |
| Schema validation | Standard Schema | Standard Schema | not documented | Standard Schema | not documented | no |
| Progress callbacks | download + upload | download + upload | not documented | yes | addon | download + upload |
| Response size cap | `maxResponseSize` | `maxResponseSize` | not documented | not documented | not documented | `maxContentLength` |
| SSE / NDJSON decoders | yes (`/stream`) | not documented | not documented | not documented | not documented | not documented |
| Token scoped to the API origin | yes (`withAuth`) | n/a (no auth helper documented) | n/a | n/a | n/a | n/a |

Size: refetch's root entry is about 8 KB minified + gzip with every export included (measured by `size-limit` in CI; the `/stream`, `/retry` and `/middleware` sub-paths are under 1 KB each). The other libraries were not measured here; see each one on [Bundlephobia](https://bundlephobia.com). Several are smaller, wretch and up-fetch in particular.

Where refetch differs by design: failures are returned as values with a discriminated `error.kind` instead of thrown, with throwing available per instance, per request or per call (`unwrap`). If you prefer exceptions everywhere and the smallest possible bundle, ky or up-fetch are good choices.

## Migration from v2

**Interceptors replace transforms** (transforms still work, but are deprecated):

```typescript
// v2
api.addRequestTransform((config) => { config.headers = { ...config.headers, 'X-Key': 'v' }; });

// v3 — return-based, eject by ID
const id = api.interceptors.request.use((config) => ({
  ...config,
  headers: { ...config.headers, 'X-Key': 'v' },
}));
```

**Body generics on POST/PUT/PATCH:**

```typescript
// v2
const r = await api.post<User>('/users', data);

// v3 — body type explicit
const r = await api.post<User, CreateUserDto>('/users', dto);
```

**RetryConfig:**

```typescript
// v3 — per-request retry
const r = await api.get('/data', undefined, { retry: 3 });
```

**Content-Type is no longer in default headers.** It is now set automatically based on body type. Remove manual `Content-Type: application/json` from your instance headers — it will be set correctly for each body type automatically.

## Security

**Bearer tokens stay on your API's origin.** `withAuth` attaches `Authorization` only to requests bound for the origin of the base URL. An absolute URL to another origin, for example one taken from server data, is sent without the token, and `getToken` is not called for it.

```typescript
pipe(create({ baseURL: 'https://api.example.com' }), withAuth(getToken));                       // api.example.com only
withAuth(getToken, { origins: ['https://api.example.com', 'https://files.example.com'] });      // an explicit list
withAuth(getToken, { origins: 'any' });                                                         // every request, as before origin scoping
```

An instance created without a `baseURL` has no origin to scope to, so the default attaches the token to every request; pass `origins` explicitly in that case.

**Cap response size.** `maxResponseSize` (bytes, counted after decompression) stops reading at the cap and returns an error response with `problem: RESPONSE_TOO_LARGE` and `error.kind === 'size'` (`RefetchSizeError` in throw mode). It applies to success and error bodies, is never retried, and makes a `responseType: 'stream'` body error once the cap is passed.

```typescript
const api = create({ baseURL, maxResponseSize: 5 * 1024 * 1024 });
```

**Parse untrusted JSON safely.** `JSON.parse` keeps `__proto__` keys. If you merge response bodies into other objects, plug in a hardened parser through [`parseJson`](#custom-json-parsejson-and-stringifyjson), for example `secure-json-parse`.

**Redirects and custom headers.** On a cross-origin redirect `fetch` drops `Authorization`, but not custom credential headers such as `X-API-Key`. If you send one, either trust every redirect target or pass `redirect: 'manual'` (the 3xx then comes back as `kind: 'http'`) or `redirect: 'error'`.

**Browser defaults.** refetch does not change `fetch`'s `credentials` (`same-origin`) or `mode` (`cors`). Cookies are therefore not sent cross-origin unless you set `credentials: 'include'`; if you do, protect state-changing endpoints against CSRF on the server (SameSite cookies or a CSRF token header added with `withHeaders`).

**Logs and error reports.** `response.request.headers` redacts credential headers, and thrown errors keep the request config and headers non-enumerable; see [Throwing instead of returning](#throwing-instead-of-returning).

Report vulnerabilities privately through **Security → Report a vulnerability** on GitHub; see [SECURITY.md](SECURITY.md) for scope and response times. Releases are published only from CI through npm trusted publishing with provenance, and third-party actions are pinned to commit SHAs. Verify an installed version with `npm audit signatures`.

## License

MIT
