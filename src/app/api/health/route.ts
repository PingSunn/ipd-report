import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const healthCacheTtlMs = 10_000;
const noStoreHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

let lastCheck: { checkedAt: number; healthy: boolean } | undefined;
let checkInFlight: Promise<boolean> | undefined;

async function checkDatabase(): Promise<boolean> {
  const now = Date.now();
  if (lastCheck && now - lastCheck.checkedAt < healthCacheTtlMs) {
    return lastCheck.healthy;
  }

  // Collapse concurrent public probes into one database query. Kubernetes
  // readiness still observes a fresh result at most every ten seconds while
  // bursts of unauthenticated requests cannot amplify database traffic.
  if (!checkInFlight) {
    checkInFlight = prisma.$queryRaw`SELECT 1`
      .then(() => true)
      .catch(() => false)
      .then((healthy) => {
        lastCheck = { checkedAt: Date.now(), healthy };
        return healthy;
      })
      .finally(() => {
        checkInFlight = undefined;
      });
  }

  return checkInFlight;
}

export async function GET(): Promise<NextResponse> {
  try {
    const healthy = await checkDatabase();
    if (!healthy) {
      return NextResponse.json(
        { status: 'unavailable' },
        { status: 503, headers: noStoreHeaders },
      );
    }

    return NextResponse.json(
      { status: 'ok' },
      { headers: noStoreHeaders },
    );
  } catch {
    return NextResponse.json(
      { status: 'unavailable' },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
