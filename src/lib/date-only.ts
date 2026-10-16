/**
 * Date-only helpers for values stored as ISO calendar dates (`yyyy-MM-dd`).
 *
 * A date-only value has no time zone. When a Date is needed for a calendar UI,
 * it is created at local noon so a time-zone conversion cannot move it across
 * a day boundary.
 */

export const BUDDHIST_ERA_OFFSET = 543;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

export function isLeapYear(year: number): boolean {
  return Number.isInteger(year) && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return 0;
  }

  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isValidParts(year: number, month: number, day: number): boolean {
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function isValidDateOnly(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;

  return isValidParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** Creates a local-noon Date from an ISO date-only value. */
export function parseDateOnly(value: string): Date | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidParts(year, month, day)) return null;

  const result = new Date(0);
  result.setFullYear(year, month - 1, day);
  result.setHours(12, 0, 0, 0);
  return result;
}

/** Serializes the local calendar fields of a Date without using UTC conversion. */
export function formatDateOnly(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date');

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (!isValidParts(year, month, day)) throw new RangeError('Date is outside the supported date-only range');

  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

export function buddhistYearToGregorian(year: number): number | null {
  const gregorianYear = year - BUDDHIST_ERA_OFFSET;
  return Number.isInteger(year) && gregorianYear >= 1 && gregorianYear <= 9999 ? gregorianYear : null;
}

export function gregorianYearToBuddhist(year: number): number | null {
  return Number.isInteger(year) && year >= 1 && year <= 9999 ? year + BUDDHIST_ERA_OFFSET : null;
}

function normalizeDigits(value: string): string {
  return [...value]
    .map((character) => {
      const digit = THAI_DIGITS.indexOf(character);
      return digit >= 0 ? digit.toString() : character;
    })
    .join('');
}

/** Parses either the stored ISO value or the Thai-facing `dd/MM/yyyy` BE form. */
export function parseDateInput(value: string): string | null {
  const normalized = normalizeDigits(value.trim());
  if (isValidDateOnly(normalized)) return normalized;

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(normalized);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const buddhistYear = Number(match[3]);
  const year = buddhistYearToGregorian(buddhistYear);
  if (year === null || !isValidParts(year, month, day)) return null;

  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

/** Formats a stored ISO value for the Thai-facing editable input. */
export function formatDateInput(value: string): string {
  const date = parseDateOnly(value);
  if (!date) return '';

  const buddhistYear = gregorianYearToBuddhist(date.getFullYear());
  if (buddhistYear === null) return '';
  return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1)
    .toString()
    .padStart(2, '0')}/${buddhistYear.toString().padStart(4, '0')}`;
}

export function todayDateOnly(): string {
  return formatDateOnly(new Date());
}
