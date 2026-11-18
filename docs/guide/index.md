# Getting started

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

Every request resolves to `ApiResponse<T>`, a discriminated union. Check `ok` and TypeScript narrows the rest:

```typescript
type ApiResponse<T> = ApiOkResponse<T> | ApiErrorResponse;

interface ApiOkResponse<T> {
  ok: true;
  problem: null;
  originalError: null;
  data: T;
  status: number;
  // + the shared fields below
}

interface ApiErrorResponse<E = unknown> {
  ok: false;
  problem: ProblemCode;
  error: RefetchError;         // discriminated union — see Error Handling
  originalError: Error | null;
  data?: E;                    // the error body; unknown unless you assert a type
  // + the shared fields below
}

// Shared by both branches
//   status?: number;
//   headers?: Record<string, string>;
//   duration?: number;          // milliseconds
//   response?: Response;        // raw fetch Response
//   request?: ResolvedRequest;  // url, method, headers as sent (credentials redacted), body, config, attempt
```

```typescript
const response = await api.get<User>('/users/1');

if (response.ok) {
  response.data.name;          // User — no undefined, no guard needed
} else {
  response.error.kind;         // 'http' | 'timeout' | 'network' | …
  response.data;               // unknown: the server's error body
}
```

`isOkResponse()` and `isErrorResponse()` are still exported for use as predicates (`responses.filter(isOkResponse)`).

**Building a response by hand** (in a response interceptor or a short-circuit) now has to satisfy one branch completely. To turn a failure into a success, set every field of the ok branch:

```typescript
api.interceptors.response.use((response) =>
  response.status === 404
    ? { ...response, ok: true, problem: null, originalError: null, status: 200, data: [] }
    : response,
);
```
