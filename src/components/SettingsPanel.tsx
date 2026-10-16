"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock3,
  History,
  Mail,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  Users,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "./ui/field";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { DEFAULT_SETTINGS, type LineHistoryItem, type LineStatusDto, type ReportFormat, type SettingsDto, type SettingsUpdateInput, type VerifiedLineGroupDto } from "../types/settings";
import { getLineHistory, saveSettings } from "../services/settingsService";
import {
  getDirectory,
  inviteUser,
  reinviteUser,
  revokeInvitation,
  updateUser,
  type DirectoryUser,
  type InvitationSummary,
  type UserRole,
  type UserStatus,
} from "../services/authService";
import { formatThaiDate, formatUpdatedAt } from "../utils/censusUtils";

export interface SettingsPanelProps {
  settings: SettingsDto | null;
  lineStatus: LineStatusDto | null;
  groups: VerifiedLineGroupDto[];
  loadError?: string | null;
  onSaved?: (settings: SettingsDto) => void;
  canManageUsers?: boolean;
}

type FieldErrors = Record<string, string>;

const reportFormatLabels: Record<ReportFormat, string> = {
  standard: "มาตรฐาน",
  compact: "กระชับ",
  detailed: "ละเอียด",
};

function toDraft(settings: SettingsDto | null): SettingsUpdateInput {
  if (!settings) return { ...DEFAULT_SETTINGS };
  return {
    hospitalName: settings.hospitalName,
    wardName: settings.wardName,
    defaultCapacity: settings.defaultCapacity,
    reportFormat: settings.reportFormat,
    includeCapacityAndOccupancy: settings.includeCapacityAndOccupancy,
    includeCategories: settings.includeCategories,
    includeWorkloadHours: settings.includeWorkloadHours,
    includeNote: settings.includeNote,
    lineEnabled: settings.lineEnabled,
    lineGroupId: settings.lineGroupId,
    nightSendTime: settings.nightSendTime,
    morningSendTime: settings.morningSendTime,
    afternoonSendTime: settings.afternoonSendTime,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "ไม่สามารถบันทึกการตั้งค่าได้ในขณะนี้";
}

function deliveryStatusLabel(item: LineHistoryItem): string {
  if (item.status === "ACCEPTED") return "LINE รับคำขอแล้ว";
  if (item.status === "FAILED") return "ส่งไม่สำเร็จ";
  if (item.status === "SKIPPED") return "ข้ามการส่ง";
  if (item.status === "PROCESSING") return "กำลังส่ง";
  return "รอส่ง";
}

function statusTone(status: LineHistoryItem["status"]): string {
  if (status === "ACCEPTED") return "border-accent bg-secondary text-primary";
  if (status === "FAILED") return "border-destructive/25 bg-destructive/10 text-destructive-strong";
  if (status === "SKIPPED") return "border-border bg-muted text-muted-foreground";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

function roleLabel(role: UserRole): string {
  return role === "WARD_HEAD" ? "หัวหน้าหอผู้ป่วย" : "พยาบาล";
}

function invitationStatusLabel(status: InvitationSummary["status"]): string {
  if (status === "ACCEPTED") return "ใช้งานแล้ว";
  if (status === "EXPIRED") return "หมดอายุ";
  if (status === "REVOKED") return "ยกเลิกแล้ว";
  return "รอดำเนินการ";
}

function normalizeGmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const match = /^([^@]+)@gmail\.com$/.exec(trimmed);
  if (!match) return null;
  return match[1] ? `${match[1]}@gmail.com` : null;
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border py-7 first:pt-0 last:border-b-0 last:pb-0">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function CheckLine({
  label,
  ready,
  readyLabel = "พร้อม",
  notReadyLabel = "ยังไม่พร้อม",
}: {
  label: string;
  ready: boolean;
  readyLabel?: string;
  notReadyLabel?: string;
}) {
  return (
    <li className="flex min-h-11 items-center gap-3 text-sm text-muted-foreground">
      {ready ? <CheckCircle2 className="size-4 text-primary" aria-hidden="true" /> : <AlertCircle className="size-4 text-amber-700" aria-hidden="true" />}
      <span>{label}</span>
      <span className="ml-auto text-xs font-medium">{ready ? readyLabel : notReadyLabel}</span>
    </li>
  );
}

export function SettingsPanel({ settings, lineStatus, groups, loadError, onSaved, canManageUsers = false }: SettingsPanelProps) {
  const [draft, setDraft] = useState<SettingsUpdateInput>(() => toDraft(settings));
  const [dirty, setDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [history, setHistory] = useState<LineHistoryItem[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [invitations, setInvitations] = useState<InvitationSummary[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("NURSE");
  const [directoryBusy, setDirectoryBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty && settings) setDraft(toDraft(settings));
  }, [dirty, settings]);

  const loadHistory = React.useCallback(async (silent = false) => {
    if (!silent) setHistoryLoading(true);
    try {
      const items = await getLineHistory();
      setHistory(items);
      setHistoryError(null);
    } catch (error: unknown) {
      setHistoryError(errorMessage(error));
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
    const intervalId = window.setInterval(() => void loadHistory(true), 10000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadHistory]);

  const loadDirectory = React.useCallback(async () => {
    if (!canManageUsers) return;
    setDirectoryLoading(true);
    try {
      const directory = await getDirectory();
      setUsers(directory.users);
      setInvitations(directory.invitations);
      setDirectoryError(null);
    } catch (error: unknown) {
      setDirectoryError(errorMessage(error));
    } finally {
      setDirectoryLoading(false);
    }
  }, [canManageUsers]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const directoryAction = async (key: string, action: () => Promise<void>) => {
    setDirectoryBusy(key);
    setDirectoryError(null);
    try {
      await action();
      await loadDirectory();
    } catch (error: unknown) {
      setDirectoryError(errorMessage(error));
    } finally {
      setDirectoryBusy(null);
    }
  };

  const submitInvitation = async () => {
    const normalized = normalizeGmail(inviteEmail);
    if (!normalized) {
      setDirectoryError("กรุณาใช้ Gmail ที่ถูกต้อง เช่น nurse@gmail.com");
      return;
    }
    await directoryAction("invite", async () => {
      await inviteUser(normalized, inviteRole);
      setInviteEmail("");
    });
  };

  const updateDirectoryUser = async (user: DirectoryUser, update: { role?: UserRole; status?: UserStatus }) => {
    if (update.role === "NURSE" || update.status === "SUSPENDED") {
      const activeHeads = users.filter((item) => item.role === "WARD_HEAD" && item.status === "ACTIVE").length;
      if (user.role === "WARD_HEAD" && user.status === "ACTIVE" && activeHeads <= 1) {
        setDirectoryError("ต้องมีหัวหน้าหอผู้ป่วยที่ใช้งานอยู่อย่างน้อย 1 คน");
        return;
      }
    }
    await directoryAction(`user-${user.id}`, () => updateUser(user.id, update));
  };

  const readiness = useMemo(
    () => ({
      accessToken: lineStatus?.accessTokenConfigured ?? false,
      webhookSecret: lineStatus?.webhookSecretConfigured ?? false,
      group: groups.some((group) => group.groupId === draft.lineGroupId.trim()),
    }),
    [draft.lineGroupId, groups, lineStatus],
  );
  const allConfigReady = readiness.accessToken && readiness.group;

  const update = <K extends keyof SettingsUpdateInput>(key: K, value: SettingsUpdateInput[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setSaveError(null);
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setSaveError(null);
    setFieldErrors({});
    try {
      const saved = await saveSettings(draft);
      setDraft(toDraft(saved));
      setDirty(false);
      onSaved?.(saved);
    } catch (error: unknown) {
      setSaveError(errorMessage(error));
      const responseError = error as Error & { fieldErrors?: FieldErrors };
      if (responseError.fieldErrors) setFieldErrors(responseError.fieldErrors);
    } finally {
      setIsSaving(false);
    }
  };

  const groupOptions = groups.map((group) => group.groupId);
  const selectedGroupId = groupOptions.includes(draft.lineGroupId)
    ? draft.lineGroupId
    : undefined;
  const settingsUpdatedAt = settings?.updatedAt ? formatUpdatedAt(settings.updatedAt, true) : "กำลังโหลด…";

  return (
    <form onSubmit={submit} className="mx-auto max-w-[1000px]">
      <div className="mb-7 flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-end">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            <Settings2 className="size-7 text-primary" aria-hidden="true" />
            ตั้งค่าระบบ
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            ตั้งค่าข้อมูลหอผู้ป่วยและรูปแบบรายงานที่ใช้ร่วมกันทั้งทีม ข้อมูลจะมีผลกับรายการใหม่และตัวอย่างรายงานถัดไป
          </p>
        </div>
        <div className="text-sm text-muted-foreground">อัปเดตล่าสุด {settingsUpdatedAt}</div>
      </div>

      {saveError && (
        <Alert variant="destructive" className="mb-6 border-destructive/25 bg-destructive/10 text-destructive-strong">
          <AlertCircle />
          <AlertTitle>บันทึกการตั้งค่าไม่สำเร็จ</AlertTitle>
          <AlertDescription>{saveError} ตรวจสอบช่องที่แจ้งแล้วลองอีกครั้ง</AlertDescription>
        </Alert>
      )}
      {loadError && !settings && (
        <Alert variant="destructive" className="mb-6 border-destructive/25 bg-destructive/10 text-destructive-strong">
          <AlertCircle />
          <AlertTitle>โหลดการตั้งค่าไม่สำเร็จ</AlertTitle>
          <AlertDescription>{loadError} ระบบยังไม่เปิดให้บันทึกจนกว่าจะโหลดข้อมูลได้</AlertDescription>
        </Alert>
      )}

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <SettingsSection title="ข้อมูลหอผู้ป่วย" description="ชื่อที่แสดงบนหัวระบบเท่านั้น">
          <FieldGroup className="grid gap-5 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="hospital-name">ชื่อโรงพยาบาล</FieldLabel>
              <FieldContent>
                <Input id="hospital-name" value={draft.hospitalName} onChange={(event) => update("hospitalName", event.target.value)} aria-invalid={Boolean(fieldErrors.hospitalName)} />
                {fieldErrors.hospitalName && <p className="text-sm text-destructive">{fieldErrors.hospitalName}</p>}
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="ward-name">ชื่อหอผู้ป่วย</FieldLabel>
              <FieldContent>
                <Input id="ward-name" value={draft.wardName} onChange={(event) => update("wardName", event.target.value)} aria-invalid={Boolean(fieldErrors.wardName)} />
                {fieldErrors.wardName && <p className="text-sm text-destructive">{fieldErrors.wardName}</p>}
              </FieldContent>
            </Field>
          </FieldGroup>
        </SettingsSection>

        <SettingsSection title="ค่าเริ่มต้นเตียง" description="ใช้เติมในแบบฟอร์มรายการใหม่เท่านั้น รายการเดิมจะเก็บความจุที่บันทึกไว้">
          <FieldGroup>
            <Field className="max-w-sm">
              <FieldLabel htmlFor="default-capacity">ความจุเตียงเริ่มต้น</FieldLabel>
              <FieldContent>
                <Input id="default-capacity" type="number" min={1} step={1} value={draft.defaultCapacity} onChange={(event) => update("defaultCapacity", Number(event.target.value) || 0)} aria-invalid={Boolean(fieldErrors.defaultCapacity)} />
                <FieldDescription>หน่วยเป็นเตียง ใช้เป็นค่าเริ่มต้นเมื่อกด “บันทึกยอดเวร”</FieldDescription>
                {fieldErrors.defaultCapacity && <p className="text-sm text-destructive">{fieldErrors.defaultCapacity}</p>}
              </FieldContent>
            </Field>
          </FieldGroup>
        </SettingsSection>

        <SettingsSection title="รูปแบบตัวอย่างรายงาน" description="เลือกเนื้อหาที่สร้างใน LINE และตัวอย่างในแบบฟอร์ม">
          <FieldSet>
            <FieldLegend variant="label">รูปแบบข้อความ</FieldLegend>
            <FieldGroup className="grid gap-3 sm:grid-cols-3">
              {(Object.keys(reportFormatLabels) as ReportFormat[]).map((format) => (
                <label key={format} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm ${draft.reportFormat === format ? "border-primary bg-secondary text-foreground" : "border-border bg-card text-muted-foreground"}`}>
                  <input type="radio" name="report-format" value={format} checked={draft.reportFormat === format} onChange={() => update("reportFormat", format)} className="accent-primary" />
                  <span>{reportFormatLabels[format]}</span>
                </label>
              ))}
            </FieldGroup>
          </FieldSet>
          <FieldSet className="mt-6">
            <FieldLegend variant="label">ส่วนที่แสดง</FieldLegend>
            <FieldGroup data-slot="checkbox-group" className="grid gap-1 sm:grid-cols-2">
              <SettingCheckbox id="include-capacity" checked={draft.includeCapacityAndOccupancy} onChange={(value) => update("includeCapacityAndOccupancy", value)} label="เตียงและอัตราครองเตียง" />
              <SettingCheckbox id="include-categories" checked={draft.includeCategories} onChange={(value) => update("includeCategories", value)} label="ประเภทผู้ป่วย 1–5" />
              <SettingCheckbox id="include-workload" checked={draft.includeWorkloadHours} onChange={(value) => update("includeWorkloadHours", value)} label="ภาระงานพยาบาลโดยประมาณ" />
              <SettingCheckbox id="include-note" checked={draft.includeNote} onChange={(value) => update("includeNote", value)} label="หมายเหตุสำหรับ LINE-safe" description="เปิดเมื่อมีข้อความที่ตรวจแล้วว่าไม่มีชื่อหรือรหัสผู้ป่วย" />
            </FieldGroup>
          </FieldSet>
        </SettingsSection>

        <SettingsSection title="กำหนดการส่ง LINE" description="ตั้งเวลาตาม Asia/Bangkok (UTC+07:00) ระบบจะส่งเมื่อมีการตั้งค่าครบและเปิดใช้งาน">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
            <div className="flex flex-col gap-5">
              <SettingCheckbox id="line-enabled" checked={draft.lineEnabled} onChange={(value) => update("lineEnabled", value)} label="เปิดการส่ง LINE อัตโนมัติ" disabled={!allConfigReady && !draft.lineEnabled} description={!allConfigReady ? "ยังเปิดไม่ได้จนกว่าจะมี Channel access token และ Group ID ที่ยืนยันจาก signed webhook" : "การแก้ไขภายหลังจะมีผลกับรอบถัดไป ไม่ส่งซ้ำรายการเดิม"} />
              <Field>
                <FieldLabel htmlFor="verified-line-group">เลือกจาก verified Group ID</FieldLabel>
                <FieldContent>
                  <Select
                    value={selectedGroupId ?? ""}
                    onValueChange={(value) => update("lineGroupId", value)}
                    disabled={groupOptions.length === 0}
                  >
                    <SelectTrigger id="verified-line-group" className="w-full">
                      <SelectValue placeholder="เลือกจาก verified groups" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectGroup>
                        {groupOptions.map((groupId) => (
                          <SelectItem key={groupId} value={groupId}>
                            {groupId}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldLabel htmlFor="line-group-id">หรือกรอก Group ID ด้วยตนเอง</FieldLabel>
                  <Input id="line-group-id" value={draft.lineGroupId} onChange={(event) => update("lineGroupId", event.target.value)} placeholder="วาง Group ID ที่ค้นพบจาก signed webhook" aria-invalid={Boolean(fieldErrors.lineGroupId)} />
                  <FieldDescription>Dropdown แสดงเฉพาะ Group ID ที่ยืนยันจาก signed webhook แล้ว</FieldDescription>
                  {fieldErrors.lineGroupId && <p className="text-sm text-destructive">{fieldErrors.lineGroupId}</p>}
                </FieldContent>
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <TimeField id="night-time" label="เวรดึก" value={draft.nightSendTime} onChange={(value) => update("nightSendTime", value)} error={fieldErrors.nightSendTime} />
                <TimeField id="morning-time" label="เวรเช้า" value={draft.morningSendTime} onChange={(value) => update("morningSendTime", value)} error={fieldErrors.morningSendTime} />
                <TimeField id="afternoon-time" label="เวรบ่าย" value={draft.afternoonSendTime} onChange={(value) => update("afternoonSendTime", value)} error={fieldErrors.afternoonSendTime} />
              </div>
            </div>
            <aside className="rounded-lg border border-border bg-muted p-4" aria-label="สถานะการเชื่อมต่อ LINE">
              <h3 className="font-semibold text-foreground">ความพร้อมของ LINE</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">สถานะจาก environment และ signed webhook discovery</p>
              <ul className="mt-3 divide-y divide-border">
                <CheckLine label="LINE worker token พร้อมใช้งาน" ready={readiness.accessToken} readyLabel="ตั้งค่าแล้ว" notReadyLabel="ยังไม่ตั้งค่า" />
                <CheckLine label="Webhook secret ใน environment" ready={readiness.webhookSecret} readyLabel="ตั้งค่าแล้ว" notReadyLabel="ยังไม่ตั้งค่า" />
                <CheckLine label="Group ID จาก signed webhook" ready={readiness.group} readyLabel="ยืนยันแล้ว" notReadyLabel="ยังไม่ยืนยัน" />
              </ul>
              {groups.length > 0 && <p className="mt-3 text-xs text-muted-foreground">พบ verified groups {groups.length} กลุ่ม · เลือกได้จากช่อง Group ID</p>}
              {lineStatus?.workerLastSeenAt && <p className="mt-2 text-xs text-muted-foreground">worker ล่าสุด {formatUpdatedAt(lineStatus.workerLastSeenAt, true)}</p>}
            </aside>
          </div>
        </SettingsSection>

        <SettingsSection title="ประวัติการส่ง LINE" description="แสดงผลการส่งจริงจาก worker เท่านั้น สถานะรับคำขอไม่ใช่หลักฐานว่าผู้รับอ่านแล้ว">
          {historyLoading && !history ? (
            <div className="rounded-lg border border-border bg-background p-6 text-center" role="status" aria-live="polite">
              <RefreshCw className="mx-auto size-5 animate-spin text-primary" aria-hidden="true" />
              <p className="mt-2 font-medium text-foreground">กำลังโหลดประวัติการส่ง…</p>
            </div>
          ) : historyError && !history ? (
            <Alert variant="destructive" className="border-destructive/25 bg-destructive/10 text-destructive-strong">
              <AlertCircle />
              <AlertTitle>โหลดประวัติการส่งไม่สำเร็จ</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>{historyError}</span>
                <Button type="button" variant="outline" size="sm" className="min-h-11 border-destructive/40 bg-card text-destructive" onClick={() => void loadHistory()}>
                  <RefreshCw />
                  ลองใหม่
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {historyError && history && (
                <Alert className="mb-4 border-amber-200 bg-amber-50 text-amber-950">
                  <AlertCircle />
                  <AlertTitle>ประวัติอาจยังไม่ล่าสุด</AlertTitle>
                  <AlertDescription className="flex flex-wrap items-center gap-3">
                    <span>{historyError}</span>
                    <Button type="button" variant="outline" size="sm" className="min-h-11 border-amber-300 bg-card text-amber-950" onClick={() => void loadHistory()}>
                      <RefreshCw />
                      ลองใหม่
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              {history?.length === 0 ? (
            <div className="rounded-lg border border-dashed border-input bg-background p-6 text-center">
              <History className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
              <p className="mt-2 font-medium text-foreground">ยังไม่มีประวัติการส่ง</p>
              <p className="mt-1 text-sm text-muted-foreground">เมื่อ worker ส่งงานแล้ว ผลลัพธ์จะแสดงที่นี่</p>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {history?.map((item) => (
                <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-foreground">{formatThaiDate(item.reportDate)} · เวร{item.shift}</p>
                    <p className="mt-1 text-xs text-muted-foreground">กำหนดส่ง {formatUpdatedAt(item.scheduledAt, true)} · {item.kind === "MISSING" ? "แจ้งข้อมูลไม่ครบ" : `กลุ่ม ${item.groupId}`}</p>
                  </div>
                  <span className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium ${statusTone(item.status)}`}>{deliveryStatusLabel(item)}</span>
                </div>
              ))}
            </div>
          )}
            </>
          )}
        </SettingsSection>

        {canManageUsers && (
          <SettingsSection title="ผู้ใช้และคำเชิญ" description="จัดการสมาชิกของหอผู้ป่วยด้วย Gmail ที่ได้รับอนุญาต บัญชีที่ถูกระงับจะเข้าสู่ระบบและใช้งานข้อมูลไม่ได้">
            <div className="rounded-xl bg-surface-cyan p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <UserPlus className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-semibold text-foreground">เชิญผู้ใช้ใหม่</h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">ผู้รับต้องเข้าสู่ระบบด้วย Gmail ที่ระบุไว้</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-end">
                  <Field className="min-w-0 flex-1">
                    <FieldLabel htmlFor="invite-email">Gmail</FieldLabel>
                    <FieldContent>
                      <Input id="invite-email" type="email" inputMode="email" autoComplete="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitInvitation(); } }} placeholder="name@gmail.com" disabled={directoryBusy === "invite"} />
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel id="invite-role-label">บทบาท</FieldLabel>
                    <FieldContent>
                      <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as UserRole)} disabled={directoryBusy === "invite"}>
                        <SelectTrigger aria-labelledby="invite-role-label"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NURSE"><Stethoscope />พยาบาล</SelectItem>
                          <SelectItem value="WARD_HEAD"><ShieldCheck />หัวหน้าหอผู้ป่วย</SelectItem>
                        </SelectContent>
                      </Select>
                    </FieldContent>
                  </Field>
                  <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={directoryBusy === "invite"} onClick={() => void submitInvitation()}>
                    <Mail />{directoryBusy === "invite" ? "กำลังเชิญ…" : "ส่งคำเชิญ"}
                  </Button>
              </div>
              <div className="mt-4 flex items-start gap-2 border-t border-primary/10 pt-3 text-xs leading-5 text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <p>สิทธิ์ถูกตรวจสอบที่ server ทุกครั้ง และระบบจะรักษาหัวหน้าหอผู้ป่วยที่ใช้งานอยู่อย่างน้อย 1 คน</p>
              </div>
            </div>

            {directoryError && (
              <Alert variant="destructive" className="mt-5 border-destructive/25 bg-destructive/10 text-destructive-strong">
                <AlertCircle />
                <AlertTitle>จัดการผู้ใช้ไม่สำเร็จ</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-3"><span>{directoryError}</span><Button type="button" variant="outline" size="sm" className="border-destructive/30 bg-card text-destructive" onClick={() => void loadDirectory()}><RefreshCw /> ลองใหม่</Button></AlertDescription>
              </Alert>
            )}

            {directoryLoading ? (
              <div className="mt-5 rounded-lg border border-border bg-background p-6 text-center text-sm text-muted-foreground" role="status">กำลังโหลดผู้ใช้และคำเชิญ…</div>
            ) : (
              <div className="mt-6 grid gap-7 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                <div>
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-primary" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-foreground">ผู้ใช้</h3>
                    <Badge variant="secondary">{users.length} คน</Badge>
                  </div>
                  <div className="mt-3 space-y-3">
                    {users.length === 0 ? <div className="rounded-xl border border-dashed border-input bg-background p-6 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูลผู้ใช้</div> : users.map((user) => (
                      <div key={user.id} className="rounded-xl border border-border bg-card p-4 shadow-xs">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-primary" aria-hidden="true">{user.name.trim().charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-semibold text-foreground">{user.name}{user.nickname ? ` (${user.nickname})` : ''}</p>
                              <Badge variant={user.status === "ACTIVE" ? "secondary" : "destructive"} className={user.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : undefined}>
                                {user.status === "ACTIVE" ? <CheckCircle2 /> : <Ban />}{user.status === "ACTIVE" ? "ใช้งาน" : "ระงับ"}
                              </Badge>
                            </div>
                            <p className="mt-0.5 truncate text-sm text-muted-foreground">{user.email}</p>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                          <Field>
                            <FieldLabel id={`user-role-${user.id}`}>บทบาท</FieldLabel>
                            <FieldContent>
                              <Select value={user.role} disabled={directoryBusy === `user-${user.id}`} onValueChange={(value) => void updateDirectoryUser(user, { role: value as UserRole })}>
                                <SelectTrigger aria-labelledby={`user-role-${user.id}`}><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="NURSE"><Stethoscope />พยาบาล</SelectItem><SelectItem value="WARD_HEAD"><ShieldCheck />หัวหน้าหอผู้ป่วย</SelectItem></SelectContent>
                              </Select>
                            </FieldContent>
                          </Field>
                          <Field>
                            <FieldLabel id={`user-status-${user.id}`}>สถานะบัญชี</FieldLabel>
                            <FieldContent>
                              <Select value={user.status} disabled={directoryBusy === `user-${user.id}`} onValueChange={(value) => void updateDirectoryUser(user, { status: value as UserStatus })}>
                                <SelectTrigger aria-labelledby={`user-status-${user.id}`}><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="ACTIVE"><CheckCircle2 className="text-emerald-700" />ใช้งาน</SelectItem><SelectItem value="SUSPENDED"><Ban className="text-destructive" />ระงับ</SelectItem></SelectContent>
                              </Select>
                            </FieldContent>
                          </Field>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <Mail className="size-4 text-primary" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-foreground">คำเชิญ</h3>
                    <Badge variant="outline">{invitations.length} รายการ</Badge>
                  </div>
                  <div className="mt-3 space-y-3">
                    {invitations.length === 0 ? <div className="rounded-xl border border-dashed border-input bg-background p-6 text-center"><Mail className="mx-auto size-5 text-muted-foreground" aria-hidden="true" /><p className="mt-2 text-sm font-medium text-foreground">ยังไม่มีคำเชิญ</p><p className="mt-1 text-xs text-muted-foreground">คำเชิญที่ส่งแล้วจะแสดงที่นี่</p></div> : invitations.map((item) => (
                      <div key={item.id} className="rounded-xl border border-border bg-card p-4 shadow-xs">
                        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium text-foreground">{item.email}</p><p className="mt-1 text-xs text-muted-foreground">{roleLabel(item.role)} · หมดอายุ {formatUpdatedAt(item.expiresAt, true)}</p></div><Badge variant={item.status === "PENDING" ? "secondary" : "outline"} className={item.status === "PENDING" ? "bg-amber-100 text-amber-900" : undefined}>{invitationStatusLabel(item.status)}</Badge></div>
                        {item.status === "PENDING" && <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3"><Button type="button" variant="outline" size="sm" disabled={directoryBusy === `reinvite-${item.id}`} onClick={() => void directoryAction(`reinvite-${item.id}`, () => reinviteUser(item.id))}><RefreshCw />ส่งอีกครั้ง</Button><Button type="button" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={directoryBusy === `revoke-${item.id}`} onClick={() => void directoryAction(`revoke-${item.id}`, () => revokeInvitation(item.id))}>ยกเลิกคำเชิญ</Button></div>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </SettingsSection>
        )}

        <div className="mt-7 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{dirty ? "มีการแก้ไขที่ยังไม่ได้บันทึก" : "การตั้งค่าถูกบันทึกแล้ว"}</p>
          <Button type="submit" disabled={!dirty || isSaving || !settings} className="min-h-11 bg-primary text-primary-foreground hover:bg-primary/90">
            <Save />
            {isSaving ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function SettingCheckbox({
  id,
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className={`flex min-h-12 items-start gap-3 rounded-lg border px-3 py-2.5 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-background"} ${checked ? "border-accent bg-secondary" : "border-transparent"}`}>
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(value === true)} className="mt-0.5" />
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {description && <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}

function TimeField({ id, label, value, onChange, error }: { id: string; label: string; value: string; onChange: (value: string) => void; error?: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}><Clock3 className="size-4" aria-hidden="true" />{label}</FieldLabel>
      <FieldContent>
        <Input id={id} type="time" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </FieldContent>
    </Field>
  );
}
