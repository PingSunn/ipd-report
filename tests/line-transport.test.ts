import { describe, expect, it } from 'vitest';
import { LineApiTransport } from '../src/lib/line/transport';

const request = {
  to: 'group-id',
  messages: [{ type: 'text' as const, text: 'hello' }],
  retryKey: '00000000-0000-4000-8000-000000000000',
};

describe('LINE Messaging API transport', () => {
  it('sends the persisted retry key and accepts a normal response', async () => {
    let capturedHeaders: HeadersInit | undefined;
    const transport = new LineApiTransport({
      accessToken: 'secret-token',
      fetchImpl: async (_input, init) => {
        capturedHeaders = init?.headers;
        return new Response(null, { status: 200 });
      },
    });
    await expect(transport.push(request)).resolves.toMatchObject({ accepted: true });
    expect(new Headers(capturedHeaders).get('x-line-retry-key')).toBe(request.retryKey);
  });

  it('accepts HTTP 409 only with LINE accepted request evidence', async () => {
    const accepted = new LineApiTransport({
      accessToken: 'secret-token',
      fetchImpl: async () => new Response(null, { status: 409, headers: { 'x-line-accepted-request-id': 'provider-id' } }),
    });
    await expect(accepted.push(request)).resolves.toMatchObject({ accepted: true, providerRequestId: 'provider-id' });

    const ambiguous = new LineApiTransport({
      accessToken: 'secret-token',
      fetchImpl: async () => new Response(null, { status: 409 }),
    });
    await expect(ambiguous.push(request)).resolves.toMatchObject({ accepted: false, retryable: false, status: 409 });
  });

  it('retries network, rate-limit, and server failures but not other 4xx responses', async () => {
    for (const status of [429, 500, 503]) {
      const transport = new LineApiTransport({ accessToken: 'secret-token', fetchImpl: async () => new Response(null, { status }) });
      await expect(transport.push(request)).resolves.toMatchObject({ accepted: false, retryable: true, status });
    }
    const permanent = new LineApiTransport({ accessToken: 'secret-token', fetchImpl: async () => new Response(null, { status: 400 }) });
    await expect(permanent.push(request)).resolves.toMatchObject({ accepted: false, retryable: false, status: 400 });
  });

  it('aborts a hung request before the lock transaction deadline', async () => {
    const transport = new LineApiTransport({
      accessToken: 'secret-token',
      timeoutMs: 20,
      fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    });
    await expect(transport.push(request)).resolves.toMatchObject({ accepted: false, retryable: true });
  });
});
