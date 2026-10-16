export const SETTINGS_ID = 'default' as const;
export const SETTINGS_TIMEZONE = 'Asia/Bangkok' as const;

export type ReportFormat = 'standard' | 'compact' | 'detailed';

export interface SettingsDto {
  id: typeof SETTINGS_ID;
  hospitalName: string;
  wardName: string;
  defaultCapacity: number;
  reportFormat: ReportFormat;
  includeCapacityAndOccupancy: boolean;
  includeCategories: boolean;
  includeWorkloadHours: boolean;
  includeNote: boolean;
  lineEnabled: boolean;
  lineGroupId: string;
  nightSendTime: string;
  morningSendTime: string;
  afternoonSendTime: string;
  readonly timezone?: typeof SETTINGS_TIMEZONE;
  updatedAt: string;
}

export interface LineStatusDto {
  accessTokenConfigured: boolean;
  webhookSecretConfigured: boolean;
  workerLastSeenAt: string | null;
}

export interface VerifiedLineGroupDto {
  groupId: string;
  firstSeen: string;
  lastSeen: string;
}

export interface SettingsResponse {
  success: true;
  settings: SettingsDto;
  lineStatus: LineStatusDto;
  groups: VerifiedLineGroupDto[];
}

export interface SettingsErrorResponse {
  success: false;
  error: string;
  fieldErrors?: Record<string, string>;
}

export interface SettingsUpdateInput {
  hospitalName: string;
  wardName: string;
  defaultCapacity: number;
  reportFormat: ReportFormat;
  includeCapacityAndOccupancy: boolean;
  includeCategories: boolean;
  includeWorkloadHours: boolean;
  includeNote: boolean;
  lineEnabled: boolean;
  lineGroupId: string;
  nightSendTime: string;
  morningSendTime: string;
  afternoonSendTime: string;
}

export type LineDeliveryStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'ACCEPTED'
  | 'FAILED'
  | 'SKIPPED';

export type LineDeliveryKind = 'REPORT' | 'MISSING';

export interface LineHistoryItem {
  id: string;
  reportDate: string;
  shift: string;
  scheduledAt: string;
  kind: LineDeliveryKind;
  status: LineDeliveryStatus;
  groupId: string;
  attempts: number;
  firstAttemptAt: string | null;
  nextAttemptAt: string | null;
  acceptedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LineHistoryResponse {
  success: true;
  history: LineHistoryItem[];
}

export const DEFAULT_SETTINGS: SettingsUpdateInput = {
  hospitalName: 'โรงพยาบาลองครักษ์',
  wardName: 'ตึกผู้ป่วยใน',
  defaultCapacity: 30,
  reportFormat: 'standard',
  includeCapacityAndOccupancy: true,
  includeCategories: true,
  includeWorkloadHours: false,
  // LINE notes are opt in; internal census notes are never sent.
  includeNote: false,
  lineEnabled: false,
  lineGroupId: '',
  nightSendTime: '08:00',
  morningSendTime: '16:00',
  afternoonSendTime: '00:00',
};
