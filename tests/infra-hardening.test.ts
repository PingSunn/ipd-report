import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock('../src/lib/prisma', () => ({ prisma: { $queryRaw: queryRaw } }));

import nextConfig from '../next.config';
import { GET } from '../src/app/api/health/route';

describe('HTTP hardening', () => {
  it('disables framework disclosure and emits the required response headers', async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    if (!nextConfig.headers) throw new Error('headers config is missing');

    const rules = await nextConfig.headers();
    const wildcard = rules.find((rule) => rule.source === '/:path*');
    const headers = new Map(wildcard?.headers.map((header) => [header.key, header.value]));

    expect(headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(headers.get('Content-Security-Policy')).toContain('accounts.google.com');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
  });
});

describe('public health probe', () => {
  beforeEach(() => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([]);
  });

  it('coalesces concurrent probes into one database query', async () => {
    const responses = await Promise.all([GET(), GET(), GET()]);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(responses[0].headers.get('Cache-Control')).toBe('no-store');
  });
});
