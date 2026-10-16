import type {
  AppSettings as PrismaAppSettings,
  LineWorkerState as PrismaLineWorkerState,
  VerifiedLineGroup as PrismaVerifiedLineGroup,
} from '../generated/prisma/client';
import { prisma } from './prisma';
import {
  DEFAULT_SETTINGS,
  SETTINGS_ID,
  SETTINGS_TIMEZONE,
  type LineStatusDto,
  type SettingsDto,
  type SettingsUpdateInput,
  type VerifiedLineGroupDto,
} from '../types/settings';

export function toSettingsDto(settings: PrismaAppSettings): SettingsDto {
  return {
    id: SETTINGS_ID,
    hospitalName: settings.hospitalName,
    wardName: settings.wardName,
    defaultCapacity: settings.defaultCapacity,
    reportFormat: settings.reportFormat as SettingsDto['reportFormat'],
    includeCapacityAndOccupancy: settings.includeCapacityAndOccupancy,
    includeCategories: settings.includeCategories,
    includeWorkloadHours: settings.includeWorkloadHours,
    includeNote: settings.includeNote,
    lineEnabled: settings.lineEnabled,
    lineGroupId: settings.lineGroupId,
    nightSendTime: settings.nightSendTime,
    morningSendTime: settings.morningSendTime,
    afternoonSendTime: settings.afternoonSendTime,
    timezone: SETTINGS_TIMEZONE,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export function defaultSettingsValues(): SettingsUpdateInput {
  return { ...DEFAULT_SETTINGS };
}

/** The web process receives only this non-secret readiness flag. */
export function isLineAccessTokenConfigured(): boolean {
  return process.env['LINE_CHANNEL_ACCESS_TOKEN_CONFIGURED'] === 'true';
}

export async function getAppSettings(): Promise<PrismaAppSettings> {
  const existing = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;

  try {
    return await prisma.appSettings.create({
      data: { id: SETTINGS_ID, ...defaultSettingsValues() },
    });
  } catch (error: unknown) {
    if (isPrismaUniqueViolation(error)) {
      const createdByOtherRequest = await prisma.appSettings.findUnique({
        where: { id: SETTINGS_ID },
      });
      if (createdByOtherRequest) return createdByOtherRequest;
    }
    throw error;
  }
}

export async function updateAppSettings(input: SettingsUpdateInput): Promise<PrismaAppSettings> {
  return prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...input },
    update: input,
  });
}

export function lineStatus(
  workerState: PrismaLineWorkerState | null | undefined
): LineStatusDto {
  const accessTokenConfigured = isLineAccessTokenConfigured();
  const webhookSecretConfigured = Boolean(process.env['LINE_CHANNEL_SECRET']?.trim());
  return {
    accessTokenConfigured,
    webhookSecretConfigured,
    workerLastSeenAt: workerState?.lastSeenAt?.toISOString() ?? null,
  };
}

export function toVerifiedLineGroupDto(group: PrismaVerifiedLineGroup): VerifiedLineGroupDto {
  return {
    groupId: group.groupId,
    firstSeen: group.firstSeen.toISOString(),
    lastSeen: group.lastSeen.toISOString(),
  };
}

export async function getLineWorkerState(): Promise<PrismaLineWorkerState | null> {
  return prisma.lineWorkerState.findUnique({ where: { id: SETTINGS_ID } });
}

export async function getVerifiedLineGroups(): Promise<PrismaVerifiedLineGroup[]> {
  return prisma.verifiedLineGroup.findMany({ orderBy: { lastSeen: 'desc' } });
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
