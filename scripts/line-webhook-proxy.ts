import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export const LINE_WEBHOOK_PATH = '/api/line/webhook' as const;
export const LINE_WEBHOOK_PROXY_HOST = '127.0.0.1' as const;
export const LINE_WEBHOOK_PROXY_PORT = 40_473 as const;
export const LINE_WEBHOOK_TARGET_HOST = 'localhost' as const;
export const LINE_WEBHOOK_TARGET_PORT = 40_273 as const;
export const LINE_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
export const LINE_WEBHOOK_PROXY_TIMEOUT_MS = 14_000;

const hopByHopHeaders = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export interface LineWebhookProxyConfig {
  host: string;
  port: number;
  targetUrl: string;
}

class RequestBodyTooLargeError extends Error {
  constructor() {
    super('LINE webhook request body exceeds the configured limit');
  }
}

class ProxyTimeoutError extends Error {
  constructor() {
    super('LINE webhook proxy request timed out');
  }
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('LINE webhook proxy port must be between 1 and 65535');
  }
  return port;
}

function targetHostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

export function readProxyConfig(env: NodeJS.ProcessEnv = process.env): LineWebhookProxyConfig {
  const host = env['LINE_WEBHOOK_PROXY_HOST']?.trim() || LINE_WEBHOOK_PROXY_HOST;
  const port = parsePort(env['LINE_WEBHOOK_PROXY_PORT'], LINE_WEBHOOK_PROXY_PORT);
  const targetHost = env['LINE_WEBHOOK_TARGET_HOST']?.trim() || LINE_WEBHOOK_TARGET_HOST;
  const targetPort = parsePort(env['LINE_WEBHOOK_TARGET_PORT'], LINE_WEBHOOK_TARGET_PORT);
  return {
    host,
    port,
    targetUrl: `http://${targetHostForUrl(targetHost)}:${targetPort}${LINE_WEBHOOK_PATH}`,
  };
}

export function shouldForwardWebhook(method: string | undefined, url: string | undefined): boolean {
  return method === 'POST' && url === LINE_WEBHOOK_PATH;
}

function respondText(response: ServerResponse, status: number, text: string): void {
  response.statusCode = status;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(text);
}

function declaredBodyLength(request: IncomingMessage): number | null {
  const value = request.headers['content-length'];
  if (typeof value !== 'string' || value.length === 0) return null;
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length < 0) throw new RequestBodyTooLargeError();
  return length;
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const declaredLength = declaredBodyLength(request);
  if (declaredLength !== null && declaredLength > LINE_WEBHOOK_MAX_BODY_BYTES) {
    throw new RequestBodyTooLargeError();
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.byteLength;
    if (totalBytes > LINE_WEBHOOK_MAX_BODY_BYTES) throw new RequestBodyTooLargeError();
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, totalBytes);
}

function forwardHeaders(request: IncomingMessage, bodyLength: number): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (hopByHopHeaders.has(name) || typeof value !== 'string') continue;
    headers.set(name, value);
  }
  headers.set('content-length', bodyLength.toString());
  return headers;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: LineWebhookProxyConfig,
): Promise<void> {
  if (!shouldForwardWebhook(request.method, request.url)) {
    request.resume();
    respondText(response, 404, 'Not found');
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LINE_WEBHOOK_PROXY_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const body = await Promise.race([
      readRequestBody(request),
      new Promise<Buffer>((_resolve, reject) => {
        const onAbort = (): void => reject(new ProxyTimeoutError());
        controller.signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
    const requestBody = new Uint8Array(new ArrayBuffer(body.byteLength));
    requestBody.set(body);
    const upstream = await fetch(config.targetUrl, {
      method: 'POST',
      headers: forwardHeaders(request, body.byteLength),
      body: requestBody,
      signal: controller.signal,
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    response.statusCode = upstream.status;
    for (const name of ['cache-control', 'content-type']) {
      const value = upstream.headers.get(name);
      if (value) response.setHeader(name, value);
    }
    response.end(responseBody);
  } catch (error: unknown) {
    request.resume();
    if (error instanceof RequestBodyTooLargeError) {
      respondText(response, 413, 'Request body too large');
      return;
    }
    if (error instanceof ProxyTimeoutError || controller.signal.aborted) {
      respondText(response, 504, 'Webhook proxy request timed out');
      return;
    }
    respondText(response, 502, 'Webhook proxy upstream unavailable');
  } finally {
    clearTimeout(timeout);
  }
}

export function startLineWebhookProxy(config = readProxyConfig()): ReturnType<typeof createServer> {
  const server = createServer((request, response) => {
    void handleRequest(request, response, config).catch(() => {
      if (!response.headersSent) respondText(response, 502, 'Webhook proxy upstream unavailable');
    });
  });
  server.listen(config.port, config.host, () => {
    console.log(`LINE webhook proxy listening on ${config.host}:${config.port}`);
    console.log(`Forwarding POST ${LINE_WEBHOOK_PATH} to ${config.targetUrl}`);
  });
  return server;
}

function main(): void {
  const server = startLineWebhookProxy();
  const stop = (): void => {
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (import.meta.main) main();
