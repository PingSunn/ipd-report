import { createHmac, timingSafeEqual } from 'node:crypto';
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
      const leaves = new Set(eventGroups.leaves);
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

      for (const groupId of eventGroups.groups) {
        if (leaves.has(groupId)) continue;
        await transaction.verifiedLineGroup.upsert({
          where: { groupId },
          create: { groupId, firstSeen: now, lastSeen: now },
          update: { lastSeen: now },
        });
      }
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
}

export function parseWebhookEvents(value: unknown): LineWebhookGroupEvents | null {
  if (!isRecord(value) || !Array.isArray(value.events) || value.events.length > 1000) {
    return null;
  }

  const groups: string[] = [];
  const leaves: string[] = [];
  for (const event of value.events) {
    if (!isRecord(event)) return null;
    if (!('source' in event)) return null;
    if (!isRecord(event.source)) return null;
    if (event.source.type === 'group') {
      if (typeof event.source.groupId !== 'string' || !isSafeGroupId(event.source.groupId)) {
        return null;
      }
      if (event.type === 'leave') leaves.push(event.source.groupId);
      else groups.push(event.source.groupId);
      continue;
    }
    if (event.source.type === 'user') {
      if (typeof event.source.userId !== 'string' || !isSafeLineSourceId(event.source.userId, 'U')) {
        return null;
      }
      continue;
    }
    if (event.source.type === 'room') {
      if (typeof event.source.roomId !== 'string' || !isSafeLineSourceId(event.source.roomId, 'R')) {
        return null;
      }
      continue;
    }
    return null;
  }
  return { groups: [...new Set(groups)], leaves: [...new Set(leaves)] };
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
