# Middleware and instances

## Middleware + pipe

`pipe` chains middleware onto an instance. Each middleware returns a new instance derived with [`extend()`](#child-instances-extend) and leaves the one it was given untouched, so a shared base client can feed several differently-equipped clients:

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
| `withAuth(getToken, { origins? })` | Injects `Authorization: Bearer <token>` for requests to the base URL's origin (see [Security](/guide/security)) — `getToken` called each time |
| `withTimeout(ms)` | Sets request timeout for all requests |
| `withHeaders(headers)` | Merges additional default headers |
| `withBaseURL(url)` | Overrides the base URL |
| `withLogging(logger?)` | Logs each request and response; defaults to `console` |

```typescript
const base  = pipe(create({ baseURL }), withHeaders({ 'X-App': 'web' }));
const admin = pipe(base, withAuth(getAdminToken)); // base is unchanged
const guest = pipe(base, withTimeout(3_000));
```

Always use the value `pipe` (or the middleware) returns: `withAuth(getToken)(api)` on its own line does nothing to `api`.

Sub-path import (tree-shaking):

```typescript
import { withAuth, withLogging } from '@mshindi-labs/refetch/middleware';
import { pipe }                  from '@mshindi-labs/refetch/pipe';
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

Middleware works the same way: `pipe(api, withHeaders(…))` returns a child and leaves `api` as it was.
