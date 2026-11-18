# Comparison

## Why Refetch?

How refetch compares with the other clients people choose in 2026. **Checked on 2026-11-18** against the latest version of each package on npm. Versions, dependencies, module format and Node range come from the npm registry (`npm view <pkg>`); feature rows for the other libraries reflect what each package's own README documents. "Not documented" means its README does not mention the feature, not that it is impossible.

| | refetch | ky 2.2.0 | ofetch 1.5.1 | up-fetch 2.6.3 | wretch 3.0.9 | axios 1.21.1 |
|---|---|---|---|---|---|---|
| Transport | native `fetch` | native `fetch` | native `fetch` | native `fetch` | native `fetch` | XHR / Node `http` (a `fetch` adapter exists) |
| Runtime dependencies | 0 | 0 | 3 | 0 | 0 | 4 |
| Module format | ESM + CJS | ESM only | ESM + CJS | ESM + CJS | ESM + CJS | ESM + CJS |
| Node range (`engines`) | ≥ 22 | ≥ 22 | not declared | ≥ 18 | ≥ 22 | not declared |
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
