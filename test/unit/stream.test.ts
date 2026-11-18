import { describe, expect, it, vi } from 'vitest';
import { parseNdjson, parseSse, type SseEvent } from '../../src/stream';

const encoder = new TextEncoder();

/** A byte stream that delivers the given chunks one read at a time. */
function streamOf(
  chunks: Array<string | Uint8Array>,
  onCancel?: () => void,
): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk === undefined) return controller.close();
      controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
    },
    cancel: onCancel,
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

const events = (...chunks: Array<string | Uint8Array>): Promise<SseEvent[]> =>
  collect(parseSse(streamOf(chunks)));

describe('parseSse', () => {
  it('dispatches an event on a blank line', async () => {
    expect(await events('data: hello\n\n')).toEqual([{ data: 'hello' }]);
  });

  it('joins multiple data lines with a newline', async () => {
    expect(await events('data: line one\ndata: line two\n\n')).toEqual([
      { data: 'line one\nline two' },
    ]);
  });

  it('skips comments and unknown fields', async () => {
    expect(await events(': keep-alive\n\nfoo: bar\ndata: x\n\n')).toEqual([{ data: 'x' }]);
  });

  it('reads event, id and retry fields', async () => {
    expect(await events('event: update\nid: 7\nretry: 3000\ndata: x\n\n')).toEqual([
      { data: 'x', event: 'update', id: '7', retry: 3000 },
    ]);
  });

  it('resets the event name between events but keeps the last id', async () => {
    expect(await events('event: a\nid: 1\ndata: x\n\ndata: y\n\n')).toEqual([
      { data: 'x', event: 'a', id: '1' },
      { data: 'y', id: '1' },
    ]);
  });

  it('ignores an id containing NUL and a retry that is not all digits', async () => {
    expect(await events('id: a\0b\nretry: 1s\ndata: x\n\n')).toEqual([{ data: 'x' }]);
  });

  it('strips only one leading space and accepts fields without a colon or space', async () => {
    expect(await events('data:  two spaces\n\ndata:none\n\ndata\n\n')).toEqual([
      { data: ' two spaces' },
      { data: 'none' },
      { data: '' },
    ]);
  });

  it('does not dispatch when there is no data line', async () => {
    expect(await events('event: ping\n\n: comment\n\n')).toEqual([]);
  });

  it('accepts CRLF and lone CR line endings', async () => {
    expect(await events('data: a\r\n\r\ndata: b\r\rdata: c\n\n')).toEqual([
      { data: 'a' },
      { data: 'b' },
      { data: 'c' },
    ]);
  });

  it('handles line endings and fields split across chunks', async () => {
    expect(await events('da', 'ta: a\r', '\n\r', '\nda', 'ta: b\n', '\n')).toEqual([
      { data: 'a' },
      { data: 'b' },
    ]);
  });

  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = encoder.encode('data: 5 € ✓\n\n');
    const cut = bytes.indexOf(0xe2) + 1; // inside the euro sign
    expect(await events(bytes.slice(0, cut), bytes.slice(cut))).toEqual([{ data: '5 € ✓' }]);
  });

  it('strips a leading byte order mark', async () => {
    expect(await events('﻿data: x\n\n')).toEqual([{ data: 'x' }]);
  });

  it('discards an event that is not terminated by a blank line', async () => {
    expect(await events('data: done\n\ndata: cut off')).toEqual([{ data: 'done' }]);
  });

  it('cancels the source stream when the consumer stops early', async () => {
    const onCancel = vi.fn();
    for await (const event of parseSse(streamOf(['data: 1\n\n', 'data: 2\n\n'], onCancel))) {
      expect(event.data).toBe('1');
      break;
    }
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('fails with a TimeoutError when idleTimeout passes without data', async () => {
    const onCancel = vi.fn();
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: first\n\n'));
      },
      cancel: onCancel,
    });
    const received: string[] = [];
    const reading = (async () => {
      for await (const event of parseSse(stalled, { idleTimeout: 30 })) received.push(event.data);
    })();

    await expect(reading).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(received).toEqual(['first']);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('parseNdjson', () => {
  it('parses one value per line, skipping blank lines', async () => {
    const values = await collect(parseNdjson(streamOf(['{"n":1}\n\n{"n":2}\r\n[3]\n'])));
    expect(values).toEqual([{ n: 1 }, { n: 2 }, [3]]);
  });

  it('parses a final line without a trailing newline', async () => {
    expect(await collect(parseNdjson(streamOf(['1\n2'])))).toEqual([1, 2]);
  });

  it('handles values split across chunks', async () => {
    expect(await collect(parseNdjson(streamOf(['{"n"', ':1}\n{"n":', '2}\n'])))).toEqual([
      { n: 1 },
      { n: 2 },
    ]);
  });

  it('uses a custom parseJson', async () => {
    const parseJson = vi.fn((text: string) => text.length);
    expect(await collect(parseNdjson(streamOf(['ab\nabcd\n']), { parseJson }))).toEqual([2, 4]);
  });

  it('throws a SyntaxError naming the line, with the parser error as cause', async () => {
    const reading = collect(parseNdjson(streamOf(['{"ok":true}\n{broken\n'])));
    await expect(reading).rejects.toThrow(SyntaxError);
    await expect(collect(parseNdjson(streamOf(['{broken\n'])))).rejects.toMatchObject({
      message: 'Invalid NDJSON line: {broken',
      cause: expect.any(SyntaxError),
    });
  });
});
