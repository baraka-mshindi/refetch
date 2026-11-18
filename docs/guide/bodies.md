# Bodies, parsing and validation

## Body Formats

All native `fetch` body types are passed through without transformation. `Content-Type` is set automatically based on body type:

| Body | Auto `Content-Type` |
|---|---|
| Plain object / array | `application/json` |
| `string` | `application/json` |
| `FormData` | *omitted* — browser sets `multipart/form-data; boundary=…` |
| `URLSearchParams` | `application/x-www-form-urlencoded;charset=UTF-8` |
| `Blob` | Blob's own `.type`, or `application/octet-stream` |
| `ArrayBuffer` / `ArrayBufferView` | `application/octet-stream` |
| `ReadableStream` | `application/octet-stream`, sent with `duplex: 'half'` (override via `config.duplex`) |

If you explicitly set `Content-Type` in your request headers, it takes precedence (except FormData, where it is always removed to preserve the browser-managed boundary).

**String bodies are sent as JSON.** A `string` body is assumed to be pre-serialised JSON and gets `Content-Type: application/json`. For plain text or any other format, set the header yourself:

```typescript
await api.post('/notes', 'hello', { headers: { 'Content-Type': 'text/plain' } });
```

**Streaming request bodies** are one-shot: the stream is consumed by the first attempt, so such requests are never retried. In browsers they need HTTP/2 or HTTP/3 over HTTPS and are not supported by Safari; Node, Bun and Deno support them over HTTP/1.1 too.

**Form-encoded body:**

```typescript
await api.post('/login', new URLSearchParams({ username, password }));
```

**File upload:**

```typescript
const form = new FormData();
form.append('avatar', file);
await api.post('/profile/avatar', form);
```

## Response Parsing

`parseResponseBody` automatically picks the right parser based on `Content-Type`:

| Content-Type | Parsed to |
|---|---|
| `application/json` | `T` via `JSON.parse` |
| `application/*+json` (e.g. `vnd.api+json`, `ld+json`, `problem+json`) | `T` via `JSON.parse` |
| `application/x-www-form-urlencoded` | `Record<string, string>` via `URLSearchParams` |
| `text/event-stream` | `ReadableStream` (unread; see `responseType: 'stream'`) |
| `text/*`, `application/xml`, `application/xhtml+xml` | `string` |
| `image/*`, `audio/*`, `video/*` | `Blob` |
| `application/pdf`, `application/zip`, `application/gzip`, Office formats, etc. | `Blob` |
| 204 / 304 / `content-length: 0` | `null` |
| Anything else | `string` (fallback) |

### Overriding the parser: `responseType`

Set `responseType` per request (or as an instance default) to read the body one way whatever `Content-Type` the server sends:

| `responseType` | `data` |
|---|---|
| `'auto'` (default) | chosen from `Content-Type`, as in the table above |
| `'json'` | parsed JSON; a body that is not JSON is a `PARSE_ERROR` with the raw text in `data` |
| `'text'` | `string` |
| `'blob'` | `Blob` |
| `'arrayBuffer'` | `ArrayBuffer` |
| `'bytes'` | `Uint8Array` |
| `'stream'` | the unread `ReadableStream<Uint8Array>` |
| `'none'` | `null`; the body is discarded without being read |

```typescript
// JSON served as text/plain
const res = await api.get<Config>('/config.txt', undefined, { responseType: 'json' });

// Download as bytes
const file = await api.get<Uint8Array>('/report.pdf', undefined, { responseType: 'bytes' });

// Stream a POST response through the normal pipeline (interceptors, monitors, throwOnError)
const chat = await api.post<ReadableStream<Uint8Array>>('/chat', body, { responseType: 'stream' });
```

Notes:

- The generic is not inferred from `responseType`; pass the matching type yourself.
- With `'stream'` (and for `text/event-stream` under `'auto'`), `timeout` covers the wait for headers only, the request `signal` stays linked to the body so aborting it cancels the download, and a successful response is never retried. A failed request is still read normally, so `data` holds the parsed error body.
- For any type other than `'auto'` and `'json'`, `Accept` is sent as `*/*` unless you set one.
- `application/x-ndjson` is still buffered as text under `'auto'`; use `responseType: 'stream'` to read it incrementally.

### Custom JSON: `parseJson` and `stringifyJson`

Both can be set on the instance or per request. `parseJson` replaces `JSON.parse` for success and error bodies and receives `{ response, request }`; if it throws, the result is a `PARSE_ERROR` with the raw text in `data`. `stringifyJson` replaces `JSON.stringify` for plain object and array bodies (strings, `FormData` and other native bodies are left alone).

```typescript
import sjson from 'secure-json-parse';

const api = create({
  baseURL,
  parseJson: (text) => sjson.parse(text),                 // rejects __proto__ / constructor keys
  stringifyJson: (value) =>
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
});
```

## Schema Validation

Pass any [Standard Schema](https://standardschema.dev) validator (Zod, Valibot, ArkType, Effect Schema…) as `schema` and the response body is validated at the boundary. `data` is the schema's output and its type is inferred, so no generic is needed. refetch only uses the Standard Schema interface, so it still has no runtime dependencies.

```typescript
import { z } from 'zod';

const User = z.object({ id: z.number(), name: z.string() });

const response = await api.get('/users/1', undefined, { schema: User });
if (response.ok) {
  response.data.name; // typed as string
} else if (response.error.kind === 'validation') {
  response.error.issues; // [{ message, path }]
  response.data;         // the body as received, for logging
}
```

- A mismatch is an error response: `problem: VALIDATION_ERROR`, `error.kind === 'validation'`, with `status`, `headers` and the unvalidated `data` kept. In throw mode it is a `RefetchValidationError`.
- Validation runs after response interceptors (so they can normalise first) and before monitors, on successful responses only. Error bodies are not validated.
- Validation failures are never retried, whatever `retry.condition` says.
- Async validators are supported. A validator that throws is reported as `kind: 'unknown'`, not as a validation failure.
- An explicit generic still wins: `api.get<Custom>(url, undefined, { schema })` is typed as `Custom`.

`bodySchema` validates the outgoing `data` before it is serialised. The schema's output is what gets sent, and a mismatch fails with `kind: 'validation'` without a network call:

```typescript
const NewUser = z.object({ name: z.string().trim().min(1) });
await api.post('/users', { name: '  Ada  ' }, { schema: User, bodySchema: NewUser }); // sends {"name":"Ada"}
```
