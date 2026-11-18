import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { create, type Progress, type RefetchInstance } from '../../src/index';
import { asError, asOk } from '../helpers/assert';
import { startTestServer, type TestServer } from '../helpers/server';

interface UploadReport {
  received: number;
  contentType: string | null;
  contentLength: string | null;
  transferEncoding: string | null;
  head: string;
}

let server: TestServer;
let api: RefetchInstance;

beforeAll(async () => {
  server = await startTestServer();
  api = create({ baseURL: server.baseURL });
});

afterAll(() => server.close());

beforeEach(() => server.resetHits());

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Records every progress call with the chunk size it came with. */
function recorder() {
  const calls: Array<Progress & { chunk: number }> = [];
  const callback = (progress: Progress, chunk: Uint8Array) => {
    calls.push({ ...progress, chunk: chunk.byteLength });
  };
  return { calls, callback, last: () => calls[calls.length - 1] };
}

const KB = 1024;

describe('onDownloadProgress', () => {
  it('reports bytes against Content-Length and finishes at 100 %', async () => {
    const { calls, callback, last } = recorder();
    const response = asOk(
      await api.get<string>('/sized', { bytes: 100 * KB }, { onDownloadProgress: callback }),
    );

    expect(response.data.length).toBe(100 * KB);
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.every((call) => call.totalBytes === 100 * KB)).toBe(true);
    const transferred = calls.map((call) => call.transferredBytes);
    expect(transferred).toEqual([...transferred].sort((a, b) => a - b));
    expect(calls.reduce((sum, call) => sum + call.chunk, 0)).toBe(100 * KB);
    expect(calls.every((call) => call.percent >= 0 && call.percent <= 1)).toBe(true);
    expect(last()).toEqual({
      transferredBytes: 100 * KB,
      totalBytes: 100 * KB,
      percent: 1,
      chunk: 0,
    });
  });

  it('reports totalBytes 0 and percent 0 until the end when the length is unknown', async () => {
    const { calls, callback, last } = recorder();
    asOk(await api.get('/big', { bytes: 200 * KB }, { onDownloadProgress: callback }));

    const during = calls.slice(0, -1);
    expect(during.length).toBeGreaterThan(0);
    expect(during.every((call) => call.totalBytes === 0 && call.percent === 0)).toBe(true);
    expect(last()).toMatchObject({ transferredBytes: 200 * KB, percent: 1, chunk: 0 });
  });

  it('leaves parsing untouched', async () => {
    const { calls, callback } = recorder();
    const response = asOk(await api.get('/json', undefined, { onDownloadProgress: callback }));
    expect(response.data).toEqual({ ok: true });
    expect(calls.length).toBeGreaterThan(0);
  });

  it('fires as the caller reads when responseType is stream', async () => {
    const { calls, callback, last } = recorder();
    const response = asOk(
      await api.get<ReadableStream<Uint8Array>>(
        '/sized',
        { bytes: 64 * KB },
        { responseType: 'stream', onDownloadProgress: callback },
      ),
    );
    const before = calls.length;
    await new Response(response.data).arrayBuffer();

    expect(calls.length).toBeGreaterThan(before);
    expect(last()).toMatchObject({ transferredBytes: 64 * KB, percent: 1 });
  });

  it('stops when maxResponseSize is exceeded', async () => {
    const { callback, last } = recorder();
    const response = asError(
      await api.get(
        '/big',
        { bytes: 2 * KB * KB },
        { maxResponseSize: 64 * KB, onDownloadProgress: callback },
      ),
    );
    expect(response.error.kind).toBe('size');
    expect(last()?.transferredBytes ?? 0).toBeLessThanOrEqual(64 * KB);
    expect(last()?.percent).not.toBe(1);
  });

  it('survives a callback that throws', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = asOk(
      await api.get('/json', undefined, {
        onDownloadProgress: () => {
          throw new Error('ui exploded');
        },
      }),
    );
    expect(response.data).toEqual({ ok: true });
    expect(logged).toHaveBeenCalled();
  });
});

describe('onUploadProgress', () => {
  const payload = 'x'.repeat(300 * KB);

  it('reports bytes as a string body is sent and finishes at 100 %', async () => {
    const { calls, callback, last } = recorder();
    const response = asOk(
      await api.post<UploadReport>('/upload', payload, {
        headers: { 'Content-Type': 'text/plain' },
        onUploadProgress: callback,
      }),
    );

    expect(response.data.received).toBe(300 * KB);
    expect(response.data.contentType).toBe('text/plain');
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((call) => call.totalBytes === 300 * KB)).toBe(true);
    expect(calls.reduce((sum, call) => sum + call.chunk, 0)).toBe(300 * KB);
    expect(last()).toEqual({
      transferredBytes: 300 * KB,
      totalBytes: 300 * KB,
      percent: 1,
      chunk: 0,
    });
  });

  it('keeps the JSON content type for object bodies', async () => {
    const { callback, last } = recorder();
    const response = asOk(
      await api.post<UploadReport>('/upload', { name: 'Ada' }, { onUploadProgress: callback }),
    );
    expect(response.data.contentType).toBe('application/json');
    expect(response.data.head).toBe('{"name":"Ada"}');
    expect(last()).toMatchObject({ transferredBytes: 14, totalBytes: 14, percent: 1 });
  });

  it('keeps the multipart boundary for FormData bodies', async () => {
    const { callback, last } = recorder();
    const form = new FormData();
    form.append('title', 'holiday');
    form.append('file', new Blob(['binary-ish']), 'photo.jpg');

    const response = asOk(
      await api.post<UploadReport>('/upload', form, { onUploadProgress: callback }),
    );

    const boundary = /^multipart\/form-data; ?boundary=(.+)$/.exec(
      response.data.contentType ?? '',
    )?.[1];
    expect(boundary).toBeTruthy();
    // The declared boundary is the one actually used in the body, character for character.
    expect(response.data.head).toContain(`--${boundary}`);
    expect(response.data.head).toContain('name="title"');
    expect(last()?.percent).toBe(1);
    expect(last()?.transferredBytes).toBe(response.data.received);
  });

  it('re-sends the body on retry', async () => {
    const { callback } = recorder();
    const response = asError(
      await api.post('/status/503', payload, {
        retry: { attempts: 2, delay: 1 },
        onUploadProgress: callback,
      }),
    );
    expect(response.status).toBe(503);
    expect(server.hits('/status/503')).toBe(2);
  });

  it('falls back to one 100 % call for keepalive requests', async () => {
    const { calls, callback } = recorder();
    const response = asOk(
      await api.post<UploadReport>('/upload', payload, {
        keepalive: true,
        onUploadProgress: callback,
      }),
    );
    expect(response.data.received).toBe(300 * KB);
    // Sent as an ordinary body, so the length is declared up front.
    expect(response.data.contentLength).toBe(String(300 * KB));
    expect(calls).toEqual([
      { transferredBytes: 300 * KB, totalBytes: 300 * KB, percent: 1, chunk: 0 },
    ]);
  });

  it('falls back the same way where request streams are unsupported', async () => {
    const RealRequest = globalThis.Request;
    vi.stubGlobal(
      'Request',
      class extends RealRequest {
        constructor(input: RequestInfo | URL, init?: RequestInit) {
          if (init?.body instanceof ReadableStream) throw new TypeError('streams unsupported');
          super(input, init);
        }
      },
    );
    const { calls, callback } = recorder();
    const response = asOk(
      await api.post<UploadReport>('/upload', payload, { onUploadProgress: callback }),
    );
    expect(response.data.received).toBe(300 * KB);
    expect(calls).toEqual([
      { transferredBytes: 300 * KB, totalBytes: 300 * KB, percent: 1, chunk: 0 },
    ]);
  });

  it('survives a callback that throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = asOk(
      await api.post<UploadReport>('/upload', payload, {
        onUploadProgress: () => {
          throw new Error('ui exploded');
        },
      }),
    );
    expect(response.data.received).toBe(300 * KB);
  });

  it('is ignored for requests without a body', async () => {
    const { calls, callback } = recorder();
    asOk(await api.get('/json', undefined, { onUploadProgress: callback }));
    expect(calls).toEqual([]);
  });
});

describe('progress options', () => {
  it('are never passed to fetch as init options', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await api.post('/upload', 'x', {
      keepalive: true,
      onUploadProgress: () => {},
      onDownloadProgress: () => {},
    });
    const init = fetchSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(init).not.toHaveProperty('onUploadProgress');
    expect(init).not.toHaveProperty('onDownloadProgress');
  });
});
