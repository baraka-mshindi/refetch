// Matches any MIME type ending in +json: application/vnd.api+json, application/ld+json, etc.
const JSON_LIKE_RE = /^(application|text)\/.+\+json$/i;

/**
 * Whether a request with this method sends a body. GET and HEAD never do (fetch rejects
 * them); DELETE does only when `data` is supplied; every other method does.
 */
export function shouldHaveBody(method: string, data?: unknown): boolean {
  const upper = method.toUpperCase();
  if (upper === 'DELETE') return data !== undefined;
  return upper !== 'GET' && upper !== 'HEAD';
}

/**
 * True where `fetch` can send a `ReadableStream` body (Node, Bun, Deno, Chromium; not Firefox
 * or Safari). Standard feature test: a supporting runtime reads `duplex` and does not treat
 * the stream as a string body with a text Content-Type.
 */
export function supportsRequestStreams(): boolean {
  let duplexRead = false;
  try {
    const hasContentType = new Request('http://localhost', {
      body: new ReadableStream(),
      method: 'POST',
      get duplex() {
        duplexRead = true;
        return 'half';
      },
    } as RequestInit).headers.has('Content-Type');
    return duplexRead && !hasContentType;
  } catch {
    return false;
  }
}

/**
 * Coerce `data` to a value that native `fetch` accepts as a `body`.
 *
 * Pass-through types (no transformation):
 *   string, FormData, URLSearchParams, Blob, ArrayBuffer, ArrayBufferView,
 *   ReadableStream
 *
 * Plain objects / arrays → JSON.stringify (returns a string)
 */
export function prepareRequestBody(
  data: unknown,
  stringify: (value: unknown) => string = JSON.stringify,
): BodyInit | undefined {
  if (data === undefined || data === null) return undefined;

  if (typeof data === 'string') return data;
  if (data instanceof FormData) return data;
  if (data instanceof URLSearchParams) return data;
  if (data instanceof Blob) return data;
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data as ArrayBufferView<ArrayBuffer>;
  if (typeof ReadableStream !== 'undefined' && data instanceof ReadableStream) {
    return data as ReadableStream;
  }

  return stringify(data);
}

/**
 * Returns the Content-Type to set for the prepared body:
 *   - `null`      → do NOT set Content-Type (FormData: browser must write boundary)
 *   - `undefined` → no body, no Content-Type needed
 *   - `string`    → set this value
 */
export function getBodyContentType(body: BodyInit | undefined): string | null | undefined {
  if (body === undefined) return undefined;

  if (body instanceof FormData) return null;

  if (body instanceof URLSearchParams) {
    return 'application/x-www-form-urlencoded;charset=UTF-8';
  }

  if (body instanceof Blob) {
    return body.type || 'application/octet-stream';
  }

  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return 'application/octet-stream';
  }

  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    return 'application/octet-stream';
  }

  if (typeof body === 'string') {
    // A stringified JSON value always starts with { [ " or a digit/null/bool.
    // This is true for all JSON.stringify output from prepareRequestBody.
    return 'application/json';
  }

  return 'application/octet-stream';
}

export { JSON_LIKE_RE };
