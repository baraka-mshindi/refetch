# Interceptors and monitors

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

## Monitors

Observe all responses after the response interceptors — fire-and-forget (exceptions caught internally):

```typescript
api.addMonitor((response) => {
  if (!response.ok) errorTracker.capture(response.error);
});

// Remove or clear
api.removeMonitor(fn);
api.clearMonitors();
```
