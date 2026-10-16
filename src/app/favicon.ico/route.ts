const cacheHeaders = {
  'Cache-Control': 'public, max-age=31536000, immutable',
};

export function GET(): Response {
  const headers = new Headers(cacheHeaders);
  headers.set('Location', '/icon.svg');
  return new Response(null, { status: 307, headers });
}
