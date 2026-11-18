# Streaming and progress

## Streaming

`stream()` returns the raw `ReadableStream` without parsing the body. It accepts any method and body, runs response interceptors and monitors, and honours `throwOnError`:

```typescript
const download = await api.stream('/large-file.bin');
if (download.ok) {
  const reader = download.data.getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    processChunk(chunk.value); // Uint8Array
  }
}

const upload = await api.stream('/render', undefined, { method: 'POST', data: { scene } });
```

`stream()` is shorthand for `responseType: 'stream'` with retries off. `timeout` covers the wait for headers only, the request `signal` stays linked to the body, and a failed request resolves as an error response with its parsed error body.

### Server-Sent Events and NDJSON

The `/stream` sub-path decodes the two common streaming formats into async iterables. Nothing is buffered beyond the current line, and breaking out of the loop cancels the download.

```typescript
import { sse, ndjson } from '@mshindi-labs/refetch/stream';

// LLM chat completion: POST + text/event-stream
const chat = await sse(api, '/v1/chat/completions', {
  method: 'POST',
  data: { model, messages, stream: true },
  idleTimeout: 30_000, // fail if the stream goes quiet for 30 s
});

if (chat.ok) {
  for await (const event of chat.data) {
    if (event.data === '[DONE]') break;
    render(JSON.parse(event.data).choices[0].delta.content);
  }
} else {
  showError(chat.problem, chat.data); // ordinary error response, body parsed
}

// NDJSON: one JSON value per line
const logs = await ndjson<LogLine>(api, '/logs/tail');
if (logs.ok) for await (const line of logs.data) append(line);
```

- `sse()` and `ndjson()` call `api.stream()`, so everything above applies. They send `Accept: text/event-stream` / `application/x-ndjson` unless you set one.
- Each SSE event is `{ data, event?, id?, retry? }`, parsed by the WHATWG rules: comments are skipped, multiple `data:` lines are joined with `\n`, `\n`, `\r\n` and `\r` are all accepted, and an event cut off before its blank line is discarded. `id` is the last event ID seen so far.
- **Cancellation:** abort the request `signal` (or call `cancel()` from `createCancelToken()`). The `for await` loop then throws the abort reason, a `CancelError` for cancel tokens. The response has already resolved by then, so this arrives as a thrown error, not as `kind: 'cancel'`.
- **Reconnecting** is up to you: keep the last `event.id` and pass it back as a `Last-Event-ID` header on the next call.
- `ndjson()` uses `config.parseJson` when set; an invalid line throws a `SyntaxError` from the loop.
- Already holding a stream? Use the decoders directly: `parseSse(stream)` and `parseNdjson(stream, { parseJson })`.

## Progress

```typescript
await api.get<Blob>('/video.mp4', undefined, {
  responseType: 'blob',
  onDownloadProgress: ({ percent, transferredBytes, totalBytes }) => bar.set(percent),
});

await api.post('/upload', formData, {
  onUploadProgress: ({ percent }) => bar.set(percent),
});
```

Both callbacks receive `({ transferredBytes, totalBytes, percent }, chunk)` for every chunk, then one final call with `percent: 1` and an empty chunk. `percent` runs from 0 to 1. An error thrown inside a callback is logged and ignored; it never fails the request.

**Download**

- Bytes are counted after decompression. `totalBytes` comes from `Content-Length`; it is `0` (and `percent` stays `0` until the final call) when the header is missing or the body is compressed.
- With `responseType: 'stream'` the callback fires as you read the stream, not before the call resolves.
- Bodiless responses (204, 304) produce no calls. If `maxResponseSize` is exceeded, progress stops and there is no final call.

**Upload**

- Where the runtime can stream request bodies (Node, Bun, Deno, and Chromium over HTTP/2 or HTTP/3) the body is sent as a counted stream and the callback fires per chunk. The request is then sent without `Content-Length` (chunked), and it cannot follow a 307 / 308 redirect.
- Elsewhere (Firefox, Safari), and for `keepalive` or `mode: 'no-cors'` requests, the body is sent unchanged and the callback fires once, at 100 %, when the response arrives.
- Retries work: the body is re-sent and progress starts again from 0.
- Chromium decides HTTP/2 support at send time, so an upload with progress to an HTTP/1.1 server fails there with a network error. Leave `onUploadProgress` off for such servers.
