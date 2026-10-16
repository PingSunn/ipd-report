import { describe, expect, it } from 'vitest';
import {
  buddhistYearToGregorian,
  formatDateInput,
  formatDateOnly,
  isLeapYear,
  isValidDateOnly,
  parseDateInput,
  parseDateOnly,
} from '../src/lib/date-only';

describe('date-only values', () => {
  it('validates Gregorian dates, including leap years', () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isValidDateOnly('2024-02-29')).toBe(true);
    expect(isValidDateOnly('2023-02-29')).toBe(false);
    expect(isValidDateOnly('2024-04-31')).toBe(false);
    expect(isValidDateOnly('2024-2-01')).toBe(false);
  });

  it('converts Thai Buddhist input to the ISO model', () => {
    expect(parseDateInput('29/02/2567')).toBe('2024-02-29');
    expect(parseDateInput('01/01/2569')).toBe('2026-01-01');
    expect(parseDateInput('๒๙/๐๒/๒๕๖๗')).toBe('2024-02-29');
    expect(formatDateInput('2024-02-29')).toBe('29/02/2567');
    expect(buddhistYearToGregorian(2567)).toBe(2024);
  });

  it('rejects invalid dates without normalizing them', () => {
    expect(parseDateInput('31/04/2567')).toBeNull();
    expect(parseDateInput('29/02/2566')).toBeNull();
    expect(parseDateOnly('2024-13-01')).toBeNull();
    expect(formatDateInput('2024-02-30')).toBe('');
  });

  it('round-trips local date fields at noon without UTC serialization', () => {
    const parsed = parseDateOnly('2026-10-15');
    expect(parsed).not.toBeNull();
    expect(parsed?.getHours()).toBe(12);
    expect(parsed && formatDateOnly(parsed)).toBe('2026-10-15');
  });
});
