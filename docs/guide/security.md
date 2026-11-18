# Security

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

**Parse untrusted JSON safely.** `JSON.parse` keeps `__proto__` keys. If you merge response bodies into other objects, plug in a hardened parser through [`parseJson`](/guide/bodies#custom-json-parsejson-and-stringifyjson), for example `secure-json-parse`.

**Redirects and custom headers.** On a cross-origin redirect `fetch` drops `Authorization`, but not custom credential headers such as `X-API-Key`. If you send one, either trust every redirect target or pass `redirect: 'manual'` (the 3xx then comes back as `kind: 'http'`) or `redirect: 'error'`.

**Browser defaults.** refetch does not change `fetch`'s `credentials` (`same-origin`) or `mode` (`cors`). Cookies are therefore not sent cross-origin unless you set `credentials: 'include'`; if you do, protect state-changing endpoints against CSRF on the server (SameSite cookies or a CSRF token header added with `withHeaders`).

**Logs and error reports.** `response.request.headers` redacts credential headers, and thrown errors keep the request config and headers non-enumerable; see [Throwing instead of returning](/guide/errors#throwing-instead-of-returning).

Report vulnerabilities privately through **Security → Report a vulnerability** on GitHub; see [SECURITY.md](/security) for scope and response times. Releases are published only from CI through npm trusted publishing with provenance, and third-party actions are pinned to commit SHAs. Verify an installed version with `npm audit signatures`.
