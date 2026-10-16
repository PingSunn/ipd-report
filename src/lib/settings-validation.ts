import { z } from 'zod';
import type { SettingsUpdateInput } from '../types/settings';

const reportFormats = ['standard', 'compact', 'detailed'] as const;

const requiredText = (label: string, max: number) =>
  z
    .string({ message: `${label}ต้องเป็นข้อความ` })
    .trim()
    .min(1, `กรุณาระบุ${label}`)
    .max(max, `${label}ยาวเกินไป`);

const timeSchema = z
  .string({ message: 'เวลาต้องเป็นข้อความ' })
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'กรุณาระบุเวลาในรูปแบบ HH:mm');

const groupIdSchema = z
  .string({ message: 'LINE Group ID ต้องเป็นข้อความ' })
  .trim()
  .max(255, 'LINE Group ID ยาวเกินไป')
  .refine(
    (value) => value === '' || /^C[A-Za-z0-9_-]{1,254}$/.test(value),
    'LINE Group ID ไม่ถูกต้อง'
  );

export const settingsUpdateSchema = z
  .object({
    hospitalName: requiredText('ชื่อโรงพยาบาล', 200),
    wardName: requiredText('ชื่อหอผู้ป่วย', 120),
    defaultCapacity: z
      .number({ message: 'ความจุต้องเป็นตัวเลข' })
      .int('ความจุต้องเป็นจำนวนเต็ม')
      .min(1, 'ความจุต้องมากกว่า 0')
      .max(2147483647, 'ความจุต้องไม่เกิน 2147483647'),
    reportFormat: z.enum(reportFormats, { message: 'รูปแบบรายงานไม่ถูกต้อง' }),
    includeCapacityAndOccupancy: z.boolean({ message: 'การแสดงข้อมูลเตียงไม่ถูกต้อง' }),
    includeCategories: z.boolean({ message: 'การแสดงประเภทผู้ป่วยไม่ถูกต้อง' }),
    includeWorkloadHours: z.boolean({ message: 'การแสดงภาระงานไม่ถูกต้อง' }),
    includeNote: z.boolean({ message: 'การแสดงหมายเหตุไม่ถูกต้อง' }),
    lineEnabled: z.boolean({ message: 'สถานะ LINE ไม่ถูกต้อง' }),
    lineGroupId: groupIdSchema,
    nightSendTime: timeSchema,
    morningSendTime: timeSchema,
    afternoonSendTime: timeSchema,
  })
  .strict();

export function parseSettingsUpdate(value: unknown):
  | { success: true; data: SettingsUpdateInput }
  | { success: false; fieldErrors: Record<string, string>; message: string } {
  const parsed = settingsUpdateSchema.safeParse(value);
  if (parsed.success) return { success: true, data: parsed.data };

  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  }

  return {
    success: false,
    fieldErrors,
    message: 'ข้อมูลการตั้งค่าไม่ถูกต้อง กรุณาตรวจสอบรายการที่แจ้ง',
  };
}

export function validateScheduleTimes(input: SettingsUpdateInput): Record<string, string> {
  const toMinutes = (value: string): number => {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const night = toMinutes(input.nightSendTime);
  const morning = toMinutes(input.morningSendTime);
  const afternoon = toMinutes(input.afternoonSendTime);
  const fieldErrors: Record<string, string> = {};

  if (night >= morning) {
    fieldErrors.nightSendTime = 'เวรดึกต้องมีเวลาก่อนเวรเช้า';
    fieldErrors.morningSendTime = 'เวรเช้าต้องมีเวลาหลังเวรดึก';
  }
  if (afternoon <= morning && afternoon >= night) {
    fieldErrors.afternoonSendTime = 'เวรบ่ายต้องอยู่หลังเวรเช้า หรือก่อนเวรดึกของรอบถัดไป';
  }
  return fieldErrors;
}

export function isValidLineGroupId(value: string): boolean {
  return groupIdSchema.safeParse(value).success;
}

export function isLineGroupId(value: string): boolean {
  return groupIdSchema.safeParse(value).success;
}

export function isLineTime(value: string): boolean {
  return timeSchema.safeParse(value).success;
}
