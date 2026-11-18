# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@mshindi-labs/refetch` (3.x) is a production-grade HTTP client built on native `fetch`. It is a class-free, composable TypeScript design (a `create()` factory returning a stateful instance, plus plain functions) — 16 single-responsibility modules, return-based interceptors, discriminated error union (`RefetchError`), built-in retry, streaming, and tree-shakeable sub-path exports. It is a modern alternative to axios and apisauce with zero runtime dependencies.

## Development Commands

```bash
npm run build         # tsdown (Rolldown) — produces dist/ (ESM + CJS + .d.ts/.d.cts for 5 entry points; needs Node ≥ 22.18)
npm run typecheck     # tsc --noEmit for src/ and for the test suite
npm test              # Vitest: unit + integration (real node:http server) + type tests
npm run test:coverage # same, with V8 coverage thresholds (80 % lines)
npm run lint          # Biome formatting + lint (npm run lint:fix applies)
npm run check:package # arethetypeswrong + publint on the packed tarball
npm run size          # size-limit budgets for dist/*.js
npm run smoke         # scripts/smoke.mjs against dist/ (CI also runs it under Bun and Deno)
npm run ci            # all of the above in CI order
```

Tests live in `test/` (layout and conventions in CONTRIBUTING.md "Testing Guidelines"). Known bugs are tracked as `it.fails('… (known bug #N)')` tests that assert the correct behaviour: flip them to `it` when fixing the bug.

## Architecture

### Module Layout (`src/`)

| File | Responsibility |
|------|---------------|
| `types.ts` | All public types: `PROBLEM_CODE`, `RefetchError`, `RetryConfig`, `ApiResponse`, `RefetchInstance`, interceptor types, transform types |
| `constants.ts` | `STATUS_RANGES`, `DEFAULT_TIMEOUT`, `DEFAULT_HEADERS` (Accept only — no Content-Type) |
| `errors.ts` | `CancelError`, `TimeoutError`, `NetworkError`, `createCancelToken`, `classifyProblem`, `buildRefetchError`; throw mode: `RefetchResponseError` + one subclass per kind, `toResponseError`, `isRefetchError`, `unwrap` |
| `url.ts` | `buildUrl` (optional `paramsSerializer`), `buildQueryString` (object / `URLSearchParams` / tuples; Dates → ISO, nested objects throw) |
| `headers.ts` | `mergeHeaders`, `headersToObject`, `setRequestHeader` |
| `body.ts` | `prepareRequestBody`, `shouldHaveBody`, `getBodyContentType`, `JSON_LIKE_RE` |
| `response.ts` | `parseResponseBody`, `normalizeSuccessResponse`, `normalizeErrorResponse` |
| `fetch.ts` | `resolveTimeout`, `createAttemptSignal` (caller signal + extra signals + timeout via `AbortSignal.any`, listener fallback), `fetchWithTimeout` |
| `interceptors.ts` | `createInterceptorManager` — Map-based, auto-increment IDs, `getAll()` |
| `retry.ts` | `normalizeRetryConfig`, `getRetryDelay`, `exponentialBackoff`, `retryAfterDelay`, `shouldRetry`, `sleep` (no runtime imports) |
| `middleware.ts` | `withAuth`, `withTimeout`, `withHeaders`, `withBaseURL`, `withLogging` |
| `pipe.ts` | `pipe()` HOF |
| `stream.ts` | `/stream` sub-path: `parseSse`, `parseNdjson` (async generators over a byte stream), `sse()`, `ndjson()` helpers that call `api.stream()`; no runtime imports |
| `schema.ts` | Vendored `StandardSchemaV1` interface, types only (no runtime code) |
| `refetch.ts` | `create()` factory — pipeline, retry loop, stream(), transform aliases |
| `index.ts` | All public exports |

`utils.ts` does not exist — it was dissolved into the six utility modules above.

### Build Entry Points (`tsdown.config.ts`)

| Entry | Sub-path |
|-------|----------|
| `src/index.ts` | `@mshindi-labs/refetch` |
| `src/retry.ts` | `@mshindi-labs/refetch/retry` |
| `src/middleware.ts` | `@mshindi-labs/refetch/middleware` |
| `src/pipe.ts` | `@mshindi-labs/refetch/pipe` |
| `src/stream.ts` | `@mshindi-labs/refetch/stream` |

### Request/Response Pipeline (`refetch.ts`)

1. HTTP method called (e.g., `api.get(url, params, config)`)
2. Config merged: `{ ...state.config, ...requestConfig, url, method }`
3. `shouldHaveBody(method)` → assign `config.data` (body methods) or `config.params` (GET/HEAD/DELETE); `options()`, `link()` and `unlink()` pass their params through the config because those verbs are body methods; at send time `shouldHaveBody(method, config.data)` lets DELETE carry a body when `config.data` is set. `query()` sends `QUERY` with a body; `options()` passes params through the config because OPTIONS is a body method; `config.headers` is normalised to a lower-cased plain object with the instance headers merged in
4. **Request interceptors applied (LIFO)** — return-based, run **once before any retry**; a throwing interceptor yields an error response (`UNKNOWN_ERROR` / `kind: 'unknown'`) instead of a rejection; returning `{ response }` short-circuits (no network call, `request.attempt === 0`, response interceptors and monitors still run)
5. `normalizeRetryConfig` determines retry settings
6. **Retry loop** (`do/while`):
   - `prepareRequestBody(config.data)` → `BodyInit | undefined`
   - `mergeHeaders(DEFAULT_HEADERS, config.headers)` (instance headers were merged before the interceptors) → then `getBodyContentType` sets `Content-Type`
   - FormData: `headers.delete('Content-Type')` — browser manages multipart boundary
   - `ReadableStream` body: `duplex: 'half'` is added unless `config.duplex` is set; such requests are never retried (one-shot body)
   - `buildUrl(baseURL, url, params)`
   - `fetch` with the attempt signal (caller signal + `totalTimeout` deadline + per-attempt timeout); the same signal bounds the body read, so timeouts and cancels during parsing surface as such
   - `parseResponseBody` — content-type-aware (see below); throws `ParseError` for undecodable bodies. On a 2xx that becomes `PARSE_ERROR` / `kind: 'parse'` with `data` = raw text and status/headers kept; on a non-2xx the HTTP error wins and `data` is the raw text; a `TypeError` while reading (connection drop) becomes `NetworkError`
   - `normalizeSuccessResponse` or `normalizeErrorResponse` + `buildRefetchError`
   - `response.request` (`ResolvedRequest`: url, method, headers as sent with credential headers redacted, body, post-interceptor config with real headers, 1-based attempt) is attached on every path; `config.context` carries user data and is never sent
   - **Response interceptors applied (FIFO)** — per attempt
   - Monitors notified (fire-and-forget)
   - `shouldRetry` check — repeat if configured

### Content-Type Handling

`DEFAULT_HEADERS` contains **only** `Accept: application/json`. `Content-Type` is never in defaults — it is set per-request by `getBodyContentType(body)` in `body.ts`:

| Return value | Meaning |
|---|---|
| `null` | FormData — delete Content-Type so browser can set boundary |
| `undefined` | No body — no Content-Type needed |
| `string` | Set this value, only if caller hasn't already set Content-Type |

### Response Body Parsing (`response.ts`)

`parseResponseBody` routes by MIME type (stripped of parameters) from `Content-Type`:

- `options.responseType` (`'auto'` default) first: `'none'` cancels the body and returns `null`; `'json' | 'text' | 'blob' | 'arrayBuffer' | 'bytes' | 'stream'` force that reader. Everything below is `'auto'`
- 204 / 304 / `content-length: 0` → `null` immediately (no read)
- `text/event-stream` → `response.body` (unread stream)
- `application/json` or `/+json` suffix (via `JSON_LIKE_RE`) → `response.text()` + `options.parseJson ?? JSON.parse` (empty text → `null`, invalid → `ParseError` with the raw text)
- `application/x-www-form-urlencoded` → `URLSearchParams` → `Record<string, string>`
- `image/*`, `audio/*`, `video/*`, `application/pdf`, `application/zip`, Office docs, fonts → `response.blob()`
- `text/*`, `application/xml`, `application/xhtml+xml` → `response.text()`
- Fallback → `response.text()`

### Interceptor System (`interceptors.ts`)

`createInterceptorManager<T>()` uses `Map<number, InterceptorHandler<T>>` + auto-increment ID counter:

- `use(onFulfilled?, onRejected?) → id` — registers and returns the ejection ID
- `eject(id)` — deletes from Map (no null-placeholder array like axios)
- `clear()` — clears all
- `getAll()` — returns array of handlers in insertion order

Request interceptors are **reversed** before execution (LIFO). Response interceptors execute in order (FIFO). If the response interceptor chain rejects, the error is wrapped in `normalizeErrorResponse` — it never propagates as an unhandled exception.

### Transform Aliases (Deprecated)

`addRequestTransform` / `addResponseTransform` wrap the transform as an interceptor internally. The original function → interceptor ID mapping is stored in `requestTransformIds` / `responseTransformIds` (`Map<Function, number>`) for reference-based removal via `removeRequestTransform(fn)`. Transforms mutate the config/response then return it — backward compatible with v2 mutation-based usage.

### Retry Loop

```
request interceptors → once
do {
  if (attempt > 0) {
    delay = retryAfterDelay(lastResponse) ?? getRetryDelay(config, attempt)   // server timing wins; stop if > maxRetryAfter (60 s default); delays clamp to 2^31-1 ms
    onRetry?.(attempt, lastResponse, delay); await sleep(delay, callSignal)      // abortable: cancel/total timeout ends the call
  }
  lastResponse = await executeSingleRequest(config, startTime)
  attempt++
} while (retryConfig && attempt < retryConfig.attempts && shouldRetry(lastResponse, retryConfig))
```

Default non-retryable status codes: `{400, 401, 403, 404, 422}`; `statusCodes` replaces that set with an allow-list, `methods` restricts by HTTP method, `condition` overrides everything except cancels and total-timeout expiries. Delays: `delay` × `backoff` (`fixed` | `linear` | `exponential`) capped by `maxDelay`, optionally jittered; `exponentialBackoff()` builds a `delay` function. Phase B (#11, v4) changes the defaults to idempotent methods and an explicit status list.

### Error Classification (`errors.ts`)

`classifyProblem(status?, error?)` → `PROBLEM_CODE`. `buildRefetchError` returns the matching `RefetchError` variant:

- `TimeoutError` (ours; `scope: 'request' | 'total'`), `AbortSignal.timeout()`'s DOMException, or any `*TimeoutError` name → `{ kind: 'timeout', duration }` / `TIMEOUT_ERROR`
- `CancelError` / `AbortError` → `{ kind: 'cancel', reason }` / `CANCEL_ERROR`
- `NetworkError` (wraps the `TypeError` thrown by `fetch()`; extends `TypeError`; `code` read from the cause chain) → `{ kind: 'network' }`; `CONNECTION_ERROR` when `code` is a connection code (`ECONNREFUSED`, `ENOTFOUND`, …), else `NETWORK_ERROR`
- Any non-2xx status (4xx, 5xx, and 1xx/3xx/0 under `redirect: 'manual'`) → `{ kind: 'http', status, statusText }`
- `ParseError` (thrown by `parseResponseBody`; `contentType`, `raw`, `cause`) → `{ kind: 'parse', contentType, cause }` / `PARSE_ERROR`
- `ValidationError` (thrown by `validate()` in `refetch.ts` when a `schema` / `bodySchema` reports issues) → `{ kind: 'validation', issues, cause }` / `VALIDATION_ERROR`; status and headers of the 2xx are kept
- Everything else → `{ kind: 'unknown', cause }`

Classification is by origin first (abort reason, `fetch()` throwing) and by message only as a fallback for foreign errors.

`CancelError` and `createCancelToken` live in `errors.ts`, not `interceptors.ts`.

### Middleware HOFs (`middleware.ts`)

Each HOF has type `(instance: RefetchInstance) => RefetchInstance`. They register interceptors and return the same instance. `pipe(value, ...fns)` reduces them left-to-right — the standard composition pattern.

## Key Invariants

- `utils.ts` does not exist
- `observeBytes(stream, limit?, onBytes?)` in `response.ts` is the one byte counter: it enforces `maxResponseSize`, drives `onDownloadProgress`, and counts uploads. `reportProgress()` in `refetch.ts` adapts user callbacks and swallows (logs) their errors
- Upload progress serialises the body through `new Response(body)` and streams the resulting Blob when `supportsRequestStreams()` and the request is not `keepalive` / `no-cors`; the multipart Content-Type is read from the Response **header**, never from `Blob.type` (lower-cased, which would corrupt the boundary). Otherwise the body is sent unchanged and one 100 % call is made after the response arrives
- `withAuth` scopes the token to the base URL's origin by default (`AuthOptions.origins`: `'baseURL'` | `string[]` | `'any'`); it mirrors `buildUrl`'s absolute-URL test instead of importing it, to keep the `/middleware` entry small; without a base URL the default attaches everywhere
- `maxResponseSize` wraps the response in `limitResponseSize()` (`response.ts`) before parsing; exceeding it throws `ResponseSizeError` → `{ kind: 'size', limit }` / `RESPONSE_TOO_LARGE`, with the status and headers kept, never retried
- `finalize(response, schema?)` order is fixed: response interceptors → `schema` validation (ok responses only) → monitors. `bodySchema` runs in `send()` after request interceptors and before the retry loop; its failure is an attempt-0 error response
- Validation failures are never retried (`isUnretryable` in `retry.ts`, duck-typed on `kind`); a validator that throws is `kind: 'unknown'`
- Response data inference uses one signature per method with `SchemaData<T, C>`, not overloads: overloads break instantiation expressions such as `api.post<User, Dto>`
- GET and HEAD never send a body; DELETE sends one only when `config.data` is set; there is no `trace()` because fetch forbids TRACE
- `DEFAULT_HEADERS` has **only** `Accept` — never `Content-Type`
- `RefetchError` is defined in `types.ts`; `buildRefetchError` is in `errors.ts`
- When the parsed `data` is a `ReadableStream` (`responseType: 'stream'`, or SSE under `'auto'`), `executeSingleRequest` clears the attempt timeout but does not dispose the attempt or call signals, so the caller's abort still reaches the body; a failed request with `responseType: 'stream'` is parsed as `'auto'`
- `responseType`, `parseJson`, `stringifyJson` live on both `RefetchConfig` and `RequestConfig` (`BodyOptions`) and are in `REFETCH_KEYS` so they never reach `fetch()`
- `stream()` returns `ApiResponse<ReadableStream<T>>` and is a thin wrapper over `request()` with `responseType: 'stream'` and `retry: 1`: any method / `config.data`, response interceptors and monitors run, no retry, error bodies are parsed
- `src/stream.ts` has no runtime imports (like `retry.ts`); its idle timeout throws a plain `Error` named `TimeoutError` and NDJSON failures throw `SyntaxError`, so it never pulls `errors.ts` into the sub-path
- Request interceptors run **once** before the retry loop; response interceptors run **per attempt**
- Cancelled requests, `totalTimeout` expiries, parse failures (by default) and `ReadableStream`-bodied requests are never retried; `timeout: 0` / `false` disables the per-attempt timeout
- `request()` and `stream()` resolve by default; they reject only when `throwOnError` (instance or per request) says so, with a `RefetchResponseError` subclass, and only after retries, response interceptors and monitors have run (`settle()` in `refetch.ts`)
- The thrown base class is `RefetchResponseError` because `RefetchError` is already the discriminated-union type
- `request()` and `stream()` never reject because of an interceptor: interceptor errors become error responses that still reach response interceptors and monitors
- `src/retry.ts` has no runtime imports (keeps the `/retry` sub-path tiny)
- Request interceptors always receive `config.headers` as a lower-cased plain object; middleware must merge with `mergeHeaders`/`setRequestHeader`, never spread `HeadersInit`
- Every response the client produces has `request` set; the 401-refresh recipe is `api.any({ ...response.request.config, context: { refreshed: true } })`
- `buildQueryString` never emits `[object Object]`: nested objects throw, Dates serialise as ISO 8601
- FormData `Content-Type` must always be deleted — browser manages the boundary
- `npm run lint`, `npm run typecheck` and `npm test` must pass before any commit
