import { z } from 'zod';

const unsupportedCharacters = /[\p{Cc}\p{Cf}]/u;

function isVisibleProfileValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !unsupportedCharacters.test(value);
}

const profileField = (maxLength: number) => z
  .string()
  .trim()
  .min(1, 'กรุณากรอกข้อมูลให้ครบถ้วน')
  .max(maxLength, `ข้อมูลต้องไม่เกิน ${maxLength} ตัวอักษร`)
  .refine((value) => !unsupportedCharacters.test(value), 'ข้อมูลมีอักขระที่ไม่รองรับ');

export const profileSchema = z
  .object({
    firstName: profileField(80),
    lastName: profileField(80),
    nickname: profileField(50),
  })
  .strict();

export type UserProfileInput = z.infer<typeof profileSchema>;

export type UserProfileFields = {
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
};

export function isProfileComplete(profile: UserProfileFields): boolean {
  return [profile.firstName, profile.lastName, profile.nickname].every(isVisibleProfileValue);
}

/**
 * Google usually provides a display name rather than separate name fields.
 * Treat this only as a form suggestion: users still confirm every value.
 */
export function splitGoogleName(name: string): { firstName: string | null; lastName: string | null } {
  const parts = name.trim().split(/\s+/u).filter((part) => part.length > 0);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0] ?? null, lastName: null };
  return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(' ') || null };
}

export function serializeUserProfile(user: UserProfileFields & { id: string; email: string; name: string }) {
  const suggested = splitGoogleName(user.name);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    firstName: user.firstName,
    lastName: user.lastName,
    nickname: user.nickname,
    profileComplete: isProfileComplete(user),
    suggestedFirstName: suggested.firstName,
    suggestedLastName: suggested.lastName,
  };
}
