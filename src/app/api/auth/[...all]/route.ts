import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '../../../../lib/auth';
import { withBoundedRequestBody } from '../../../../lib/bounded-body';

export const runtime = 'nodejs';

const maxAuthBodyBytes = 64 * 1024;
const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;
export const POST = withBoundedRequestBody(handlers.POST, maxAuthBodyBytes);
export const PATCH = withBoundedRequestBody(handlers.PATCH, maxAuthBodyBytes);
export const PUT = withBoundedRequestBody(handlers.PUT, maxAuthBodyBytes);
export const DELETE = withBoundedRequestBody(handlers.DELETE, maxAuthBodyBytes);
