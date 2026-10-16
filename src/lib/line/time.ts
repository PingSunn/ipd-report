import type { LineScheduledSlot, LineSettingsSnapshot, LineShift } from './types';

const SHIFT_ORDER: readonly LineShift[] = ['ดึก', 'เช้า', 'บ่าย'];

export function isValidTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function parseTime(value: string): { hour: number; minute: number } {
  if (!isValidTime(value)) throw new Error(`Invalid LINE send time: ${value}`);
  const [hour, minute] = value.split(':').map(Number);
  return { hour, minute };
}

function minutesSinceMidnight(value: string): number {
  const parsed = parseTime(value);
  return parsed.hour * 60 + parsed.minute;
}

export function bangkokDateString(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return `${utc.getUTCFullYear().toString().padStart(4, '0')}-${(utc.getUTCMonth() + 1)
    .toString()
    .padStart(2, '0')}-${utc.getUTCDate().toString().padStart(2, '0')}`;
}

/** Converts a wall-clock time in fixed Asia/Bangkok (UTC+07:00) to an instant. */
export function bangkokDateTime(date: string, time: string): Date {
  const { hour, minute } = parseTime(time);
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute));
}

export function slotFor(reportDate: string, shift: LineShift, settings: LineSettingsSnapshot): LineScheduledSlot {
  const time = shift === 'ดึก'
    ? settings.nightSendTime
    : shift === 'เช้า'
      ? settings.morningSendTime
      : settings.afternoonSendTime;
  const afternoonIsBeforeNight = minutesSinceMidnight(settings.afternoonSendTime)
    < minutesSinceMidnight(settings.nightSendTime);
  const scheduledDate = shift === 'บ่าย' && afternoonIsBeforeNight
    ? addCalendarDays(reportDate, 1)
    : reportDate;
  return { reportDate, shift, scheduledAt: bangkokDateTime(scheduledDate, time) };
}

export function slotsAround(now: Date, settings: LineSettingsSnapshot, days = 3): LineScheduledSlot[] {
  const today = bangkokDateString(now);
  const slots: LineScheduledSlot[] = [];
  for (let offset = -days; offset <= days; offset += 1) {
    const date = addCalendarDays(today, offset);
    for (const shift of SHIFT_ORDER) slots.push(slotFor(date, shift, settings));
  }
  return slots.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

/** Returns the one slot that catches up after a restart. Older due slots are obsolete. */
export function latestDueSlot(now: Date, settings: LineSettingsSnapshot): LineScheduledSlot | null {
  const due = slotsAround(now, settings).filter((slot) => slot.scheduledAt.getTime() <= now.getTime());
  return due.at(-1) ?? null;
}
