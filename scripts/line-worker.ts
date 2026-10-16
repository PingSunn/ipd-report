import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { LineApiTransport } from '../src/lib/line/transport';
import { LineService } from '../src/lib/line/service';

const LOOP_MS = 30_000;
const service = new LineService({ prisma, transport: new LineApiTransport() });
let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let activeTick: Promise<void> | null = null;
let stopPromise: Promise<void> | null = null;

async function loop(): Promise<void> {
  if (stopping) return;
  activeTick = service.tick()
    .then(() => undefined)
    .catch(() => {
      // Keep the worker alive; do not expose provider payloads, destinations, or secrets.
      console.error('LINE worker tick failed');
    });
  await activeTick;
  activeTick = null;
  if (!stopping) timer = setTimeout(() => void loop(), LOOP_MS);
}

async function gracefulStop(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  if (activeTick) {
    await Promise.race([
      activeTick,
      new Promise<void>((resolve) => setTimeout(resolve, 20_000)),
    ]);
  }
  await prisma.$disconnect();
  process.exit(0);
}

function stop(): void {
  if (stopPromise) return;
  stopPromise = gracefulStop();
  void stopPromise;
}

process.once('SIGTERM', stop);
process.once('SIGINT', stop);
void loop();
