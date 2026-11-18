# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 3.x | Yes, security fixes land in the latest 3.x release |
| 2.x and older | No |
| 4.0.0 on npm | Not a release: published by mistake and deprecated; do not use |

## Reporting a vulnerability

Please do not open a public issue for security problems.

1. Use GitHub's private vulnerability reporting: **Security → Report a vulnerability** on this repository. The report is visible only to the maintainers.
2. Include the affected version, a minimal reproduction, and the impact as you understand it.

You will get an acknowledgement within **3 business days**. Confirmed vulnerabilities are fixed in a patch release as soon as possible; the target is **14 days** for high-severity issues. We will credit you in the release notes unless you prefer otherwise.

## Scope

`@mshindi-labs/refetch` is a thin client over native `fetch`. Reports we consider in scope include, for example:

- credentials or headers leaking to unintended origins (for example on redirects or through middleware)
- unbounded resource use triggered by a hostile server (memory, retries, timers)
- unsafe handling of response bodies or JSON
- supply-chain issues in the published package or the release workflow

Vulnerabilities in the runtime's `fetch` implementation itself should go to the respective runtime (Node.js, Bun, Deno, browsers).

## Threat model

What the library defends against by default, and what it leaves to you:

| Threat | Default | Your part |
|---|---|---|
| A bearer token sent to another origin through an absolute URL from untrusted data | `withAuth` only attaches the token to the base URL's origin | Pass `origins` explicitly on instances without a `baseURL`; do not use `origins: 'any'` with untrusted URLs |
| Custom credential headers (`X-API-Key`) following a cross-origin redirect | Not handled: `fetch` only strips `Authorization` | Use `redirect: 'manual'` or `'error'` when sending such headers |
| Memory exhaustion from an oversized or endless response | No cap unless `maxResponseSize` is set | Set `maxResponseSize` for untrusted servers |
| A hostile `Retry-After` parking a request | Capped by `maxRetryAfter` (60 s) | Lower it if needed |
| Prototype pollution through `__proto__` keys in JSON | `JSON.parse` is used as is | Supply a hardened `parseJson` if bodies are merged into objects |
| Credentials in logs and error reports | `response.request.headers` is redacted; thrown errors keep `request`, `response` and `headers` non-enumerable | Do not log `request.config`; scrub error bodies (`data`) if your API echoes secrets |
| CSRF in browsers | `fetch` defaults are untouched (`credentials: 'same-origin'`) | Protect state-changing endpoints server-side when using `credentials: 'include'` |

## Supply chain

- Releases are published only from GitHub Actions through npm trusted publishing (OIDC) with provenance; no long-lived npm tokens exist.
- Every release runs the full verification (`npm run ci`) before publishing.
- Third-party actions are pinned to commit SHAs, and Dependabot keeps dependencies and actions current.
- Verify a published version with `npm audit signatures` or by checking its provenance on npmjs.com.
