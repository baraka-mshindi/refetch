# Error handling

## Error Handling

### PROBLEM_CODE

`PROBLEM_CODE` is a plain `as const` object (`PROBLEM_CODE.TIMEOUT_ERROR === 'TIMEOUT_ERROR'`), and `ProblemCode` is the union of its values, so string literals compare and assign directly.

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
