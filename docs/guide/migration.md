# Migration

## Migration from v3

**Middleware no longer mutates.** `withAuth`, `withHeaders`, `withTimeout`, `withBaseURL` and `withLogging` each return a new instance and leave their argument untouched. `const api = pipe(create(), withAuth(…))` works as before. Code that applied a middleware for its side effect must now use the result:

```typescript
// v3
const api = create({ baseURL });
withAuth(getToken)(api);            // api now sends the token

// v4
const api = withAuth(getToken)(create({ baseURL }));
```

**Transforms are removed.** `addRequestTransform`, `addResponseTransform`, `removeRequestTransform`, `removeResponseTransform`, `clearRequestTransforms` and `clearResponseTransforms` (deprecated since 3.0) are gone, along with the `RequestTransform` / `ResponseTransform` types. Use interceptors, which return the new value instead of mutating:

| v3 | v4 |
|---|---|
| `api.addRequestTransform((config) => { config.headers.x = '1'; })` | `const id = api.interceptors.request.use((config) => setRequestHeader(config, 'x', '1'))` |
| `api.addResponseTransform((response) => { response.data = wrap(response.data); })` | `api.interceptors.response.use((response) => ({ ...response, data: wrap(response.data) }))` |
| `api.removeRequestTransform(fn)` | `api.interceptors.request.eject(id)` |
| `api.clearRequestTransforms()` | `api.interceptors.request.clear()` |

**Runtime baseline.** Node 22 or newer (`engines`; Node 20 reached end of life on 2026-04-30). In browsers and other runtimes `AbortSignal.any` is now required: Chrome / Edge 116, Firefox 124, Safari 17.4, Bun and Deno. The package still ships both ESM and CommonJS builds.

**Retry defaults are stricter.** With `retry` enabled and nothing else configured, v3 retried every method on any failure except 400 / 401 / 403 / 404 / 422, immediately. v4 retries only `GET` `HEAD` `PUT` `DELETE` `OPTIONS` `TRACE` `QUERY`, only on 408 / 413 / 429 / 500 / 502 / 503 / 504 or a transport failure, and waits a jittered exponential back-off (300 ms base, 30 s cap). To keep the old behaviour for a call: `retry: { attempts: 3, delay: 0, methods: ['POST'], statusCodes: [...] }` or a `condition`. An explicit `delay` is still fixed and unjittered.

**`ApiResponse<T>` is a discriminated union.** Reading code gets simpler: after `if (response.ok)`, `response.data` is `T` and after `else`, `response.error` exists, with no type guard. Two things can stop compiling:

- Code that reads `response.data` as `T` *without* checking `ok` first: on the error branch `data` is now `unknown`.
- Code that builds a response object by hand (interceptors, short-circuits, test doubles): an ok response needs `ok: true, problem: null, originalError: null, data, status`; an error response needs `ok: false, problem, error, originalError`. `ApiErrorResponse<T>`'s parameter now types the error body and defaults to `unknown`.

**`PROBLEM_CODE` is a const object, not an enum.** Runtime values are unchanged, so `response.problem === PROBLEM_CODE.CLIENT_ERROR` and `switch` statements keep working. For types, use the new `ProblemCode` union; `PROBLEM_CODE` still works as a type alias but is deprecated. The one thing that no longer compiles is an enum *member* used as a type (`let p: PROBLEM_CODE.CLIENT_ERROR`): write `typeof PROBLEM_CODE.CLIENT_ERROR` or `'CLIENT_ERROR'`.

## Migration from v2

**Interceptors replace transforms** (transforms were removed in v4):

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
