import type {
  LineTransport,
  LineTransportRequest,
  LineTransportResult,
} from './types';

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

export class LineApiTransport implements LineTransport {
  private readonly accessToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options?: { accessToken?: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
    this.accessToken = options?.accessToken ?? process.env['LINE_CHANNEL_ACCESS_TOKEN']?.trim() ?? '';
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.timeoutMs = Math.max(1, Math.min(options?.timeoutMs ?? 10_000, 14_000));
  }

  async push(request: LineTransportRequest): Promise<LineTransportResult> {
    if (!this.accessToken) {
      return { accepted: false, retryable: false, reason: 'LINE channel access token is not configured' };
    }
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const relayAbort = (): void => timeoutController.abort();
    request.signal?.addEventListener('abort', relayAbort, { once: true });
    if (request.signal?.aborted) timeoutController.abort();
    try {
      const response = await this.fetchImpl(LINE_PUSH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'X-Line-Retry-Key': request.retryKey,
        },
        body: JSON.stringify({ to: request.to, messages: request.messages }),
        signal: timeoutController.signal,
      });
      const acceptedRequestId = response.headers.get('x-line-accepted-request-id');
      if (response.ok || (response.status === 409 && Boolean(acceptedRequestId))) {
        return { accepted: true, providerRequestId: acceptedRequestId ?? undefined };
      }
      return {
        accepted: false,
        retryable: response.status === 429 || response.status >= 500,
        status: response.status,
        reason: `LINE API returned HTTP ${response.status}`,
      };
    } catch {
      // Do not include request, token, response body, or destination in worker errors.
      return { accepted: false, retryable: true, reason: 'LINE API network error' };
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', relayAbort);
    }
  }
}
