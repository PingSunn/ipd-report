export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the configured limit');
    this.name = 'RequestBodyTooLargeError';
  }
}

export async function readBoundedBody(request: Request, maxBytes: number): Promise<string> {
  const body = await readBoundedBodyBytes(request, maxBytes);
  return new TextDecoder().decode(body);
}

export async function readBoundedBodyBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('maxBytes must be a nonnegative safe integer');
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > maxBytes
    ) {
      throw new RequestBodyTooLargeError();
    }
  }

  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;

      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The body is already over the limit; preserve the bounded-read error.
        }
        throw new RequestBodyTooLargeError();
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

type RequestHandler = (request: Request) => Promise<Response>;

export function withBoundedRequestBody(
  handler: RequestHandler,
  maxBytes: number,
): RequestHandler {
  return async (request) => {
    let body: Uint8Array;
    try {
      body = await readBoundedBodyBytes(request, maxBytes);
    } catch (error: unknown) {
      if (error instanceof RequestBodyTooLargeError) {
        return Response.json({ error: 'Request body too large' }, { status: 413 });
      }
      throw error;
    }

    const boundedRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: body.byteLength > 0 ? Uint8Array.from(body).buffer : undefined,
      signal: request.signal,
    });
    return handler(boundedRequest);
  };
}
