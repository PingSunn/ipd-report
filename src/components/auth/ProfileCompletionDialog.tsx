'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { LogOut, UserRoundCheck } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Alert, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';
import { Field, FieldContent, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';

interface ProfileDraft {
  firstName: string;
  lastName: string;
  nickname: string;
}

interface ProfileCompletionDialogProps {
  initialProfile: ProfileDraft;
  onSave: (profile: ProfileDraft) => Promise<void>;
  onSignOut: () => Promise<void>;
}

type ProfileField = keyof ProfileDraft;
type FieldErrors = Partial<Record<ProfileField, string>>;

const fieldLimits: Record<ProfileField, number> = {
  firstName: 80,
  lastName: 80,
  nickname: 50,
};

function validate(profile: ProfileDraft): FieldErrors {
  const labels: Record<ProfileField, string> = {
    firstName: 'ชื่อจริง',
    lastName: 'นามสกุล',
    nickname: 'ชื่อเล่น',
  };
  const errors: FieldErrors = {};
  for (const field of Object.keys(profile) as ProfileField[]) {
    const value = profile[field].trim();
    if (!value) errors[field] = `กรุณากรอก${labels[field]}`;
    else if (value.length > fieldLimits[field]) errors[field] = `${labels[field]}ยาวเกิน ${fieldLimits[field]} ตัวอักษร`;
  }
  return errors;
}

export function ProfileCompletionDialog({ initialProfile, onSave, onSignOut }: ProfileCompletionDialogProps) {
  const [profile, setProfile] = useState(initialProfile);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => setProfile(initialProfile), [initialProfile]);

  const updateField = (field: ProfileField, value: string) => {
    setProfile((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaveError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validate(profile);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave({
        firstName: profile.firstName.trim(),
        lastName: profile.lastName.trim(),
        nickname: profile.nickname.trim(),
      });
    } catch (cause: unknown) {
      setSaveError(cause instanceof Error ? cause.message : 'บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={() => undefined}>
      <AlertDialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-primary text-primary-foreground">
            <UserRoundCheck aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>ตั้งค่าโปรไฟล์ก่อนเริ่มใช้งาน</AlertDialogTitle>
          <AlertDialogDescription className="leading-6">
            ตรวจสอบชื่อ–นามสกุลจากบัญชี Google และเพิ่มชื่อเล่นที่ทีมใช้เรียกกัน
          </AlertDialogDescription>
        </AlertDialogHeader>

        <form className="mt-2 space-y-5" onSubmit={(event) => void submit(event)} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={Boolean(errors.firstName)}>
              <FieldLabel htmlFor="profile-first-name">ชื่อจริง</FieldLabel>
              <FieldContent>
                <Input
                  id="profile-first-name"
                  value={profile.firstName}
                  onChange={(event) => updateField('firstName', event.target.value)}
                  autoComplete="given-name"
                  maxLength={fieldLimits.firstName}
                  aria-invalid={Boolean(errors.firstName)}
                  aria-describedby={errors.firstName ? 'profile-first-name-error' : undefined}
                  autoFocus
                />
                {errors.firstName && <p id="profile-first-name-error" className="text-sm text-destructive" role="alert">{errors.firstName}</p>}
              </FieldContent>
            </Field>
            <Field data-invalid={Boolean(errors.lastName)}>
              <FieldLabel htmlFor="profile-last-name">นามสกุล</FieldLabel>
              <FieldContent>
                <Input
                  id="profile-last-name"
                  value={profile.lastName}
                  onChange={(event) => updateField('lastName', event.target.value)}
                  autoComplete="family-name"
                  maxLength={fieldLimits.lastName}
                  aria-invalid={Boolean(errors.lastName)}
                  aria-describedby={errors.lastName ? 'profile-last-name-error' : undefined}
                />
                {errors.lastName && <p id="profile-last-name-error" className="text-sm text-destructive" role="alert">{errors.lastName}</p>}
              </FieldContent>
            </Field>
          </div>
          <Field data-invalid={Boolean(errors.nickname)}>
            <FieldLabel htmlFor="profile-nickname">ชื่อเล่น</FieldLabel>
            <FieldContent>
              <Input
                id="profile-nickname"
                value={profile.nickname}
                onChange={(event) => updateField('nickname', event.target.value)}
                autoComplete="nickname"
                maxLength={fieldLimits.nickname}
                placeholder="ชื่อที่ใช้เรียกในทีม"
                aria-invalid={Boolean(errors.nickname)}
                aria-describedby={errors.nickname ? 'profile-nickname-error' : 'profile-nickname-description'}
              />
              {errors.nickname
                ? <p id="profile-nickname-error" className="text-sm text-destructive" role="alert">{errors.nickname}</p>
                : <p id="profile-nickname-description" className="text-xs text-muted-foreground">จะแสดงในมุมบัญชีและรายชื่อผู้ใช้</p>}
            </FieldContent>
          </Field>

          {saveError && <Alert variant="destructive" className="border-destructive/25 bg-surface-danger text-destructive-strong"><AlertDescription>{saveError}</AlertDescription></Alert>}

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSaving || isSigningOut}
              onClick={() => {
                setIsSigningOut(true);
                void onSignOut().catch(() => setIsSigningOut(false));
              }}
            >
              <LogOut />{isSigningOut ? 'กำลังออก…' : 'ออกจากระบบ'}
            </Button>
            <Button type="submit" disabled={isSaving || isSigningOut} className="sm:min-w-32">
              {isSaving ? 'กำลังบันทึก…' : 'บันทึกและเริ่มใช้งาน'}
            </Button>
          </div>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
