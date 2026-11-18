// Streaming decoders for Server-Sent Events and NDJSON. Like `retry.ts`, this module has no
// runtime imports so the `/stream` sub-path stays small.
import type { ApiResponse, RefetchInstance, RequestConfig } from './types.ts';

/** One dispatched Server-Sent Event. */
export interface SseEvent {
  /** The `data` lines joined with `\n`. */
  data: string;
  /** The `event` field; absent for the default `message` type. */
  event?: string;
  /** The last event ID seen on the stream so far (sticky, as in the SSE spec). */
  id?: string;
  /** Reconnection time in ms from the most recent `retry` field. */
  retry?: number;
}

export interface StreamReadOptions {
  /** Fail with a `TimeoutError` when no chunk arrives for this many ms. Disabled by default. */
  idleTimeout?: number;
}

export interface NdjsonReadOptions extends StreamReadOptions {
  /** Replaces `JSON.parse` for each line. */
  parseJson?: (text: string) => unknown;
}

type ByteStream = ReadableStream<Uint8Array>;

function read(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeout: number | undefined,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!idleTimeout) return reader.read();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`No data received for ${idleTimeout}ms`);
      // Classified as a timeout by name, like AbortSignal.timeout()'s error.
      error.name = 'TimeoutError';
      reject(error);
    }, idleTimeout);
  });
  return Promise.race([reader.read(), idle]).finally(() => clearTimeout(timer));
}

/** Decodes a byte stream to lines; accepts `\n`, `\r\n` and `\r`, also split across chunks. */
async function* readLines(stream: ByteStream, idleTimeout?: number): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await read(reader, idleTimeout);
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const char = buffer[i];
        if (char !== '\n' && char !== '\r') continue;
        // A trailing \r may be the first half of \r\n: wait for the next chunk.
        if (char === '\r' && i === buffer.length - 1 && !done) break;
        yield buffer.slice(start, i);
        if (char === '\r' && buffer[i + 1] === '\n') i++;
        start = i + 1;
      }
      buffer = buffer.slice(start);
      if (done) break;
    }
    if (buffer) yield buffer;
  } finally {
    // Runs when the consumer stops early or an error is thrown: stop the download too.
    await reader.cancel().catch(() => {});
  }
}

/**
 * Parses a `text/event-stream` body into events, following the WHATWG event-stream rules:
 * comments are skipped, multiple `data` lines are joined with `\n`, an event is dispatched on
 * a blank line, and an unterminated final event is discarded.
 *
 * @example
 * for await (const event of parseSse(response.data)) console.log(event.data);
 */
export async function* parseSse(
  stream: ByteStream,
  options: StreamReadOptions = {},
): AsyncGenerator<SseEvent> {
  let data: string[] = [];
  let event = '';
  let id: string | undefined;
  let retry: number | undefined;

  for await (const line of readLines(stream, options.idleTimeout)) {
    if (line === '') {
      if (data.length > 0) {
        const dispatched: SseEvent = { data: data.join('\n') };
        if (event) dispatched.event = event;
        if (id !== undefined) dispatched.id = id;
        if (retry !== undefined) dispatched.retry = retry;
        yield dispatched;
      }
      data = [];
      event = '';
      continue;
    }
    if (line.startsWith(':')) continue;

    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id' && !value.includes('\0')) id = value;
    else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value);
  }
}

/**
 * Parses newline-delimited JSON into values, one per non-empty line. An invalid line throws
 * a `SyntaxError` whose `cause` is the parser's error.
 */
export async function* parseNdjson<T = unknown>(
  stream: ByteStream,
  options: NdjsonReadOptions = {},
): AsyncGenerator<T> {
  const parse = options.parseJson ?? JSON.parse;
  for await (const line of readLines(stream, options.idleTimeout)) {
    const text = line.trim();
    if (!text) continue;
    try {
      yield parse(text) as T;
    } catch (cause) {
      throw new SyntaxError(`Invalid NDJSON line: ${text.slice(0, 80)}`, { cause });
    }
  }
}

type StreamClient = Pick<RefetchInstance, 'stream'>;
type StreamConfig = RequestConfig & StreamReadOptions;

async function open<T>(
  api: StreamClient,
  url: string,
  config: StreamConfig,
  accept: string,
  decode: (stream: ByteStream, response: ApiResponse<ByteStream>) => AsyncGenerator<T>,
): Promise<ApiResponse<AsyncGenerator<T>>> {
  const { idleTimeout: _idleTimeout, ...request } = config;
  const headers = new Headers(request.headers);
  if (!headers.has('Accept')) headers.set('Accept', accept);
  const response = await api.stream(url, request.params, { ...request, headers });
  if (!response.ok || !response.data) return response as ApiResponse<never>;
  return { ...response, data: decode(response.data, response) };
}

/**
 * Opens a Server-Sent Events stream with any method and body and returns the events as an
 * async iterable. The request goes through `api.stream()`, so interceptors, monitors and
 * `throwOnError` apply; a failed request resolves as a normal error response.
 *
 * @example
 * const chat = await sse(api, '/v1/chat', { method: 'POST', data: { prompt, stream: true } });
 * if (chat.ok) for await (const event of chat.data) render(JSON.parse(event.data));
 */
export function sse(
  api: StreamClient,
  url: string,
  config: StreamConfig = {},
): Promise<ApiResponse<AsyncGenerator<SseEvent>>> {
  return open(api, url, config, 'text/event-stream', (stream) => parseSse(stream, config));
}

/** Opens an NDJSON stream and returns the parsed values as an async iterable. */
export function ndjson<T = unknown>(
  api: StreamClient,
  url: string,
  config: StreamConfig = {},
): Promise<ApiResponse<AsyncGenerator<T>>> {
  return open(api, url, config, 'application/x-ndjson', (stream, response) => {
    const { parseJson } = config;
    return parseNdjson<T>(stream, {
      idleTimeout: config.idleTimeout,
      parseJson:
        parseJson && response.response
          ? (text) => parseJson(text, { response: response.response as Response })
          : undefined,
    });
  });
}
