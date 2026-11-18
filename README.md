# @mshindi-labs/refetch

[![CI](https://github.com/baraka-mshindi/refetch/actions/workflows/ci.yml/badge.svg)](https://github.com/baraka-mshindi/refetch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40mshindi-labs%2Frefetch)](https://www.npmjs.com/package/@mshindi-labs/refetch)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/baraka-mshindi/refetch/badge)](https://scorecard.dev/viewer/?uri=github.com/baraka-mshindi/refetch)

An HTTP client built on native `fetch`. Failures come back as typed values instead of exceptions, with retry, schema validation and streaming built in, and zero runtime dependencies.

**Documentation: https://baraka-mshindi.github.io/refetch/**

## Installation

```bash
npm install @mshindi-labs/refetch
```

Requires Node 22 or newer, or any runtime with `fetch` and `AbortSignal.any` (Bun, Deno, current browsers). Ships ESM and CJS.

## Quick start

```typescript
import { create } from '@mshindi-labs/refetch';

const api = create({
  baseURL: 'https://api.example.com',
  timeout: 10_000,
  retry: 3,
});

const response = await api.get<User>('/users/1');

if (response.ok) {
  console.log(response.data); // typed as User
} else {
  console.error(response.problem, response.error.kind); // 'http' | 'timeout' | 'network' | ...
}
```

Prefer exceptions? Pass `throwOnError: true`, or wrap a call in `unwrap()`.

## What you get

- **Failures are values.** Every call resolves to a response discriminated on `ok`, with a typed `error.kind`. Throwing is opt-in.
- **Retry and timeouts.** Per-attempt and total timeouts, `Retry-After`, back-off with jitter; only idempotent methods are retried by default.
- **Schema validation.** Pass a Zod, Valibot or ArkType schema and `data` is checked and typed from it.
- **Streaming.** `stream()` for any method, plus SSE and NDJSON decoders and progress callbacks.
- **Interceptors and middleware.** Return-based interceptors, `withAuth`, `withHeaders`, `withLogging`, and `extend()` for child instances.
- **Safe defaults.** Bearer tokens stay on your API's origin, responses can be size-capped, credentials are kept out of logs.

## Documentation

| Topic | |
|---|---|
| [Getting started](https://baraka-mshindi.github.io/refetch/guide/) | HTTP methods and the response format |
| [Error handling](https://baraka-mshindi.github.io/refetch/guide/errors) | Problem codes, `RefetchError`, throw mode |
| [Interceptors and monitors](https://baraka-mshindi.github.io/refetch/guide/interceptors) | Request and response hooks |
| [Retry, timeouts and cancellation](https://baraka-mshindi.github.io/refetch/guide/retry-timeouts) | Retry rules, back-off, cancel tokens |
| [Streaming and progress](https://baraka-mshindi.github.io/refetch/guide/streaming) | Streams, SSE, NDJSON, upload and download progress |
| [Middleware and instances](https://baraka-mshindi.github.io/refetch/guide/instances) | `pipe()`, `withAuth`, `extend()` |
| [Bodies, parsing and validation](https://baraka-mshindi.github.io/refetch/guide/bodies) | Body formats, `responseType`, schemas |
| [TypeScript and integrations](https://baraka-mshindi.github.io/refetch/guide/typescript) | Sub-path exports, types, TanStack Query |
| [Security](https://baraka-mshindi.github.io/refetch/guide/security) | Token scoping, size caps, redirects |
| [Comparison](https://baraka-mshindi.github.io/refetch/guide/comparison) | refetch next to ky, ofetch, up-fetch, wretch and axios |
| [Migration](https://baraka-mshindi.github.io/refetch/guide/migration) | Upgrading from v3 or v2 |
| [Changelog](https://baraka-mshindi.github.io/refetch/changelog) | Release history |

## Security

Report vulnerabilities privately through **Security → Report a vulnerability** on GitHub; see [SECURITY.md](SECURITY.md). Releases are published from CI through npm trusted publishing with provenance.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
