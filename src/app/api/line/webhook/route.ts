import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  RequestBodyTooLargeError,
  readBoundedBodyBytes,
} from '../../../../lib/bounded-body';
import { withLineConfigLock } from '../../../../lib/line-config-lock';
import { prisma } from '../../../../lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const maxBodyBytes = 1024 * 1024;
const noStoreHeaders = { 'Cache-Control': 'no-store' };
const webhookEventMaxAgeMs = 24 * 60 * 60 * 1000;
const webhookFutureSkewMs = 5 * 60 * 1000;

function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env['LINE_CHANNEL_SECRET']?.trim();
  if (!secret) {
    return jsonResponse({ success: false, error: 'LINE webhook ยังไม่พร้อมใช้งาน' }, 503);
  }

  const signature = request.headers.get('x-line-signature');
  if (!signature) {
    return jsonResponse({ success: false, error: 'ลายเซ็นคำขอไม่ถูกต้อง' }, 403);
  }

  let bodyBytes: Uint8Array;
  try {
    bodyBytes = await readBoundedBodyBytes(request, maxBodyBytes);
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError) {
      return jsonResponse({ success: false, error: 'คำขอมีขนาดใหญ่เกินไป' }, 413);
    }
    return jsonResponse({ success: false, error: 'ข้อมูล webhook ไม่ถูกต้อง' }, 400);
  }

  if (!isValidLineSignature(bodyBytes, signature, secret)) {
    return jsonResponse({ success: false, error: 'ลายเซ็นคำขอไม่ถูกต้อง' }, 403);
  }

  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes);
  } catch {
    return jsonResponse({ success: false, error: 'ข้อมูล webhook ไม่ถูกต้อง' }, 400);
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body) as unknown;
  } catch {
    return jsonResponse({ success: false, error: 'ข้อมูล webhook ไม่ถูกต้อง' }, 400);
  }

  const eventGroups = parseWebhookEvents(parsedBody);
  if (!eventGroups) {
    return jsonResponse({ success: false, error: 'ข้อมูล webhook ไม่ถูกต้อง' }, 400);
  }

  const now = new Date();
  try {
    await withLineConfigLock(prisma, async (transaction) => {
      const freshEvents = [] as LineWebhookEvent[];
      for (const event of eventGroups.events) {
        const existing = await transaction.lineWebhookEvent.findUnique({
          where: { webhookEventId: event.webhookEventId },
        });
        if (existing) continue;
        await transaction.lineWebhookEvent.create({
          data: {
            webhookEventId: event.webhookEventId,
            eventTimestamp: event.timestamp,
            redelivered: event.redelivered,
            receivedAt: now,
          },
        });
        if (isFreshWebhookEvent(event.timestamp, now)) freshEvents.push(event);
      }

      const leaves = new Set(
        freshEvents.filter((event) => event.type === 'leave' && event.groupId).map((event) => event.groupId!),
      );
      const groups = new Set(
        freshEvents.filter((event) => event.type !== 'leave' && event.groupId).map((event) => event.groupId!),
      );
      if (leaves.size > 0) {
        await transaction.verifiedLineGroup.deleteMany({
          where: { groupId: { in: [...leaves] } },
        });
        const settings = await transaction.appSettings.findUnique({
          where: { id: 'default' },
        });
        if (settings?.lineEnabled && leaves.has(settings.lineGroupId)) {
          await transaction.appSettings.update({
            where: { id: 'default' },
            data: { lineEnabled: false, lineGroupId: '' },
          });
        }
      }

      for (const groupId of groups) {
        if (leaves.has(groupId)) continue;
        await transaction.verifiedLineGroup.upsert({
          where: { groupId },
          create: { groupId, firstSeen: now, lastSeen: now },
          update: { lastSeen: now },
        });
      }
      await transaction.lineWebhookEvent.deleteMany({
        where: { receivedAt: { lt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) } },
      });
    });
    return jsonResponse({ success: true });
  } catch {
    return jsonResponse(
      { success: false, error: 'ไม่สามารถบันทึกข้อมูล webhook ได้ในขณะนี้' },
      503
    );
  }
}

export function isValidLineSignature(
  body: string | Uint8Array,
  signature: string,
  secret: string,
): boolean {
  let received: Buffer;
  try {
    received = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  if (received.length !== 32) return false;

  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(received, expected);
}

export function parseGroupEvents(value: unknown): string[] | null {
  return parseWebhookEvents(value)?.groups ?? null;
}

export interface LineWebhookGroupEvents {
  groups: string[];
  leaves: string[];
  events: LineWebhookEvent[];
}

export interface LineWebhookEvent {
  webhookEventId: string;
  timestamp: Date | null;
  redelivered: boolean;
  type: string;
  groupId: string | null;
}

export function parseWebhookEvents(value: unknown): LineWebhookGroupEvents | null {
  if (!isRecord(value) || !Array.isArray(value.events) || value.events.length > 1000) {
    return null;
  }

  const groups: string[] = [];
  const leaves: string[] = [];
  const events: LineWebhookEvent[] = [];
  for (const event of value.events) {
    if (!isRecord(event)) return null;
    const webhookEventId = webhookEventIdFor(event);
    if (!webhookEventId) return null;
    if (typeof event.type !== 'string' || event.type.length === 0 || event.type.length > 64) return null;
    const timestamp = webhookTimestamp(event.timestamp);
    if ('timestamp' in event && timestamp === undefined) return null;
    const redelivered = event.deliveryContext === undefined
      ? false
      : isRecord(event.deliveryContext) && typeof event.deliveryContext.isRedelivery === 'boolean'
        ? event.deliveryContext.isRedelivery
        : null;
    if (redelivered === null) return null;
    if (!('source' in event)) return null;
    if (!isRecord(event.source)) return null;
    if (event.source.type === 'group') {
      if (typeof event.source.groupId !== 'string' || !isSafeGroupId(event.source.groupId)) {
        return null;
      }
      const isLeave = event.type === 'leave';
      if (isLeave) leaves.push(event.source.groupId);
      else groups.push(event.source.groupId);
      events.push({
        webhookEventId,
        timestamp: timestamp ?? null,
        redelivered,
        type: isLeave ? 'leave' : String(event.type ?? ''),
        groupId: event.source.groupId,
      });
      continue;
    }
    if (event.source.type === 'user') {
      if (typeof event.source.userId !== 'string' || !isSafeLineSourceId(event.source.userId, 'U')) {
        return null;
      }
      events.push({ webhookEventId, timestamp: timestamp ?? null, redelivered, type: String(event.type ?? ''), groupId: null });
      continue;
    }
    if (event.source.type === 'room') {
      if (typeof event.source.roomId !== 'string' || !isSafeLineSourceId(event.source.roomId, 'R')) {
        return null;
      }
      events.push({ webhookEventId, timestamp: timestamp ?? null, redelivered, type: String(event.type ?? ''), groupId: null });
      continue;
    }
    return null;
  }
  return {
    groups: [...new Set(groups)],
    leaves: [...new Set(leaves)],
    events: [...new Map(events.map((event) => [event.webhookEventId, event])).values()],
  };
}

function webhookEventIdFor(event: Record<string, unknown>): string | null {
  if ('webhookEventId' in event) {
    return typeof event.webhookEventId === 'string' && isSafeWebhookEventId(event.webhookEventId)
      ? event.webhookEventId
      : null;
  }
  // Older local webhook fixtures omitted the provider ID. A deterministic
  // fallback still gives those payloads idempotent replay protection.
  const serialized = JSON.stringify(event);
  if (!serialized) return null;
  return `legacy-${createHash('sha256').update(serialized).digest('hex')}`;
}

function isSafeWebhookEventId(value: string): boolean {
  return value.length > 0 && value.length <= 255 && /^[A-Za-z0-9_-]+$/.test(value);
}

function webhookTimestamp(value: unknown): Date | null | undefined {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return undefined;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp;
}

function isFreshWebhookEvent(timestamp: Date | null, now: Date): boolean {
  if (!timestamp) return true;
  const age = now.getTime() - timestamp.getTime();
  return age <= webhookEventMaxAgeMs && age >= -webhookFutureSkewMs;
}

function isSafeGroupId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    /^C[A-Za-z0-9_-]{1,254}$/.test(value)
  );
}

function isSafeLineSourceId(value: string, prefix: 'U' | 'R'): boolean {
  return value.length > 1 && value.length <= 255 && new RegExp(`^${prefix}[A-Za-z0-9_-]{1,254}$`).test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
