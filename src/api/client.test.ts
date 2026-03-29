import { describe, expect, it, vi } from 'vitest';
import { checkHealth, processDocuments, type StudyPlan } from './client';

const encoder = new TextEncoder();

function createStreamResponse(chunks: string[], status = 200) {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, { status });
}

describe('processDocuments', () => {
  it('parses fragmented SSE progress and result events', async () => {
    const onProgress = vi.fn();
    const onResult = vi.fn();
    const onError = vi.fn();
    const plan: StudyPlan = {
      chapters: [
        { id: 'T1-C1', title: 'Intro', summary: 'Summary', topic: 'General', content: 'Body' },
      ],
      topics: ['General'],
      masterStudyMap: '| topic | chapter |',
      gptSystemInstructions: 'Use the KB.',
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      createStreamResponse([
        'event: progress\ndata: {"step":"document","progress":50',
        ',"message":"Halfway"}\n\n',
        `event: result\ndata: ${JSON.stringify(plan)}\n\n`,
      ]),
    ));

    await processDocuments(
      [new File(['hello'], 'notes.txt', { type: 'text/plain' })],
      onProgress,
      onResult,
      onError,
    );

    expect(onProgress).toHaveBeenCalledWith({
      step: 'document',
      progress: 50,
      message: 'Halfway',
    });
    expect(onResult).toHaveBeenCalledWith(plan);
    expect(onError).not.toHaveBeenCalled();
  });

  it('surfaces a stream that ends without a terminal event', async () => {
    const onProgress = vi.fn();
    const onResult = vi.fn();
    const onError = vi.fn();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      createStreamResponse([
        'event: progress\ndata: {"step":"document","progress":20,"message":"Starting"}\n\n',
      ]),
    ));

    await processDocuments(
      [new File(['hello'], 'notes.txt', { type: 'text/plain' })],
      onProgress,
      onResult,
      onError,
      { maxRetries: 0 },
    );

    expect(onProgress).toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(String), 'unexpected-end');
  });

  it('rethrows abort errors without converting them to toastable API errors', async () => {
    const onProgress = vi.fn();
    const onResult = vi.fn();
    const onError = vi.fn();
    const controller = new AbortController();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
    );

    await expect(
      processDocuments(
        [new File(['hello'], 'notes.txt', { type: 'text/plain' })],
        onProgress,
        onResult,
        onError,
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(onError).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });
});

describe('checkHealth', () => {
  it('throws when the backend health endpoint is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(checkHealth()).rejects.toThrow('Health check mislukt: 503');
  });
});
