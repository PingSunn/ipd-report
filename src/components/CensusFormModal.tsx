"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Calculator,
  Clipboard,
  Info,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { DatePicker } from "./ui/date-picker";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Textarea } from "./ui/textarea";
import {
  CensusRecord,
  DEFAULT_WARD_CAPACITY,
  PATIENT_CATEGORIES,
  SHIFT_META,
  SHIFT_ORDER,
  ShiftType,
} from "../types/census";
import {
  calculateNursingWorkloadHours,
  calculateOccupancyRate,
  generateLineShiftSummary,
  getLineReportOptions,
  getOccupancyStatus,
  getTodayDateString,
  sortRecordsDesc,
  type SharedReportSettings,
} from "../utils/censusUtils";

interface CensusFormProps {
  initialRecord?: CensusRecord | null;
  allRecords: CensusRecord[];
  onSave: (record: CensusRecord) => Promise<void>;
  onCancel?: () => void;
  isModal?: boolean;
  isSubmitting?: boolean;
  defaultCapacity?: number;
  reportSettings?: SharedReportSettings;
}

const shifts: ShiftType[] = ["ดึก", "เช้า", "บ่าย"];
const categoryAccentClasses = [
  "border-category-1/40 bg-category-1-surface",
  "border-category-2/40 bg-category-2-surface",
  "border-category-3/40 bg-category-3-surface",
  "border-category-4/40 bg-category-4-surface",
  "border-category-5/40 bg-category-5-surface",
] as const;
function makeDraftId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `REC-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function readNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function NumberStepper({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-4 last:border-b-0">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 border-input"
          onClick={() => onChange(Math.max(0, value - 1))}
          aria-label={`ลด ${label}`}
        >
          <Minus />
        </Button>
        <Input
          aria-label={label}
          type="number"
          min={0}
          value={value}
          onChange={(event) => onChange(readNumber(event.target.value))}
          className="h-11 w-20 text-center font-mono tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 border-input"
          onClick={() => onChange(value + 1)}
          aria-label={`เพิ่ม ${label}`}
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
}

export const CensusForm: React.FC<CensusFormProps> = ({
  initialRecord,
  allRecords,
  onSave,
  onCancel,
  isSubmitting = false,
  defaultCapacity = DEFAULT_WARD_CAPACITY,
  reportSettings,
}) => {
  const [date, setDate] = useState(() =>
    initialRecord?.date || (initialRecord ? "" : getTodayDateString()),
  );
  const initialRecordId = initialRecord?.id ?? null;
  const previousInitialRecordId = useRef(initialRecordId);
  const [shift, setShift] = useState<ShiftType>(initialRecord?.shift || "เช้า");
  const [capacity, setCapacity] = useState(
    initialRecord?.capacity ?? defaultCapacity,
  );
  const [totalPatients, setTotalPatients] = useState(
    initialRecord?.totalPatients || 0,
  );
  const [availableBeds, setAvailableBeds] = useState(
    initialRecord?.availableBeds ?? defaultCapacity,
  );
  const [autoAvailable, setAutoAvailable] = useState(true);
  const [newPatients, setNewPatients] = useState(
    initialRecord?.newPatients || 0,
  );
  const [discharges, setDischarges] = useState(initialRecord?.discharges || 0);
  const [referrals, setReferrals] = useState(initialRecord?.referrals || 0);
  const [categories, setCategories] = useState({
    cat1: initialRecord?.cat1 || 0,
    cat2: initialRecord?.cat2 || 0,
    cat3: initialRecord?.cat3 || 0,
    cat4: initialRecord?.cat4 || 0,
    cat5: initialRecord?.cat5 || 0,
  });
  const [note, setNote] = useState(initialRecord?.note || "");
  const [lineNote, setLineNote] = useState(initialRecord?.lineNote || "");
  const [error, setError] = useState<string | null>(null);
  const [draftId] = useState(makeDraftId);

  useEffect(() => {
    if (
      initialRecordId === null &&
      previousInitialRecordId.current !== null
    ) {
      setDate(getTodayDateString());
    }
    previousInitialRecordId.current = initialRecordId;
  }, [initialRecordId]);

  useEffect(() => {
    if (!initialRecord) return;
    setDate(initialRecord.date);
    setShift(initialRecord.shift);
    setCapacity(initialRecord.capacity || DEFAULT_WARD_CAPACITY);
    setTotalPatients(initialRecord.totalPatients);
    setAvailableBeds(initialRecord.availableBeds);
    setNewPatients(initialRecord.newPatients);
    setDischarges(initialRecord.discharges);
    setReferrals(initialRecord.referrals);
    setCategories({
      cat1: initialRecord.cat1,
      cat2: initialRecord.cat2,
      cat3: initialRecord.cat3,
      cat4: initialRecord.cat4,
      cat5: initialRecord.cat5,
    });
    setNote(initialRecord.note || "");
    setLineNote(initialRecord.lineNote || "");
    setAutoAvailable(
      initialRecord.availableBeds ===
        Math.max(
          0,
          (initialRecord.capacity || DEFAULT_WARD_CAPACITY) -
            initialRecord.totalPatients,
        ),
    );
  }, [initialRecord]);
  useEffect(() => {
    if (autoAvailable) setAvailableBeds(Math.max(0, capacity - totalPatients));
  }, [autoAvailable, capacity, totalPatients]);

  const isEditing = Boolean(initialRecord);
  const duplicateRecord = useMemo(
    () =>
      isEditing
        ? null
        : allRecords.find(
            (record) => record.date === date && record.shift === shift,
          ) || null,
    [allRecords, date, isEditing, shift],
  );
  const previousShiftRecord = useMemo(
    () =>
      sortRecordsDesc(allRecords).find((record) => {
        if (initialRecord?.id === record.id) return false;
        return (
          record.date < date ||
          (record.date === date &&
            SHIFT_ORDER[record.shift] < SHIFT_ORDER[shift])
        );
      }) || null,
    [allRecords, date, initialRecord?.id, shift],
  );
  const categoryTotal = Object.values(categories).reduce(
    (sum, value) => sum + value,
    0,
  );
  const categoryDifference = totalPatients - categoryTotal;
  const occupancy = calculateOccupancyRate(totalPatients, capacity);
  const occupancyStatus = getOccupancyStatus(totalPatients, capacity);
  const workloadHours = calculateNursingWorkloadHours(categories);
  const draftRecord: CensusRecord = useMemo(
    () => ({
      id: initialRecord?.id || duplicateRecord?.id || draftId,
      date,
      shift,
      totalPatients,
      capacity: Math.max(1, capacity),
      availableBeds,
      newPatients,
      discharges,
      referrals,
      ...categories,
      note: note.trim(),
      lineNote: lineNote.trim(),
      updatedAt: initialRecord?.updatedAt || new Date().toISOString(),
    }),
    [
      availableBeds,
      capacity,
      categories,
      date,
      discharges,
      draftId,
      duplicateRecord?.id,
      initialRecord?.id,
      initialRecord?.updatedAt,
      newPatients,
      note,
      lineNote,
      referrals,
      shift,
      totalPatients,
    ],
  );
  const previewText = useMemo(
    () => reportSettings
      ? generateLineShiftSummary(draftRecord, getLineReportOptions(reportSettings))
      : null,
    [draftRecord, reportSettings],
  );

  const setCategory = (key: keyof typeof categories, value: number) =>
    setCategories((current) => ({ ...current, [key]: value }));
  const loadDuplicate = () => {
    if (!duplicateRecord) return;
    setCapacity(duplicateRecord.capacity);
    setTotalPatients(duplicateRecord.totalPatients);
    setAvailableBeds(duplicateRecord.availableBeds);
    setNewPatients(duplicateRecord.newPatients);
    setDischarges(duplicateRecord.discharges);
    setReferrals(duplicateRecord.referrals);
    setCategories({
      cat1: duplicateRecord.cat1,
      cat2: duplicateRecord.cat2,
      cat3: duplicateRecord.cat3,
      cat4: duplicateRecord.cat4,
      cat5: duplicateRecord.cat5,
    });
    setNote(duplicateRecord.note);
    setLineNote(duplicateRecord.lineNote || "");
  };
  const applyPrevious = () => {
    if (!previousShiftRecord) return;
    setTotalPatients(
      Math.max(
        0,
        previousShiftRecord.totalPatients +
          newPatients -
          discharges -
          referrals,
      ),
    );
    if (categoryTotal === 0)
      setCategories({
        cat1: previousShiftRecord.cat1,
        cat2: previousShiftRecord.cat2,
        cat3: previousShiftRecord.cat3,
        cat4: previousShiftRecord.cat4,
        cat5: previousShiftRecord.cat5,
      });
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!date) {
      setError("กรุณาระบุวันที่รายงาน");
      return;
    }
    await onSave(draftRecord);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive-strong"
        >
          {error}
        </div>
      )}
      <section className="grid gap-5 rounded-lg border border-border bg-background p-5 md:grid-cols-[1fr_1fr_1.2fr]">
        <div>
          <Label htmlFor="report-date">วันที่รายงาน</Label>
          <DatePicker
            id="report-date"
            value={date}
            onChange={setDate}
            className="mt-2 h-11 bg-card"
            required
          />
        </div>
        <div>
          <Label htmlFor="report-shift">เวรปฏิบัติงาน</Label>
          <Select
            value={shift}
            onValueChange={(value) => setShift(value as ShiftType)}
          >
            <SelectTrigger id="report-shift" className="mt-2 w-full bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                {shifts.map((item) => (
                  <SelectItem key={item} value={item}>
                    {SHIFT_META[item].label} · {SHIFT_META[item].timeRange}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <div className="w-full rounded-md border border-accent bg-secondary p-3 text-sm text-foreground">
            <p className="font-semibold">
              {isEditing ? "กำลังแก้ไขรายการ" : "รายการใหม่"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDateLabel(date)} · {SHIFT_META[shift].label}
            </p>
          </div>
        </div>
      </section>
      {duplicateRecord && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p>
            <strong>มีรายการวันที่และเวรนี้แล้ว</strong>{" "}
            โหลดข้อมูลเดิมเพื่อแก้ไขได้
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-amber-300 bg-card"
            onClick={loadDuplicate}
          >
            <RotateCcw />
            ใช้ข้อมูลเดิม
          </Button>
        </div>
      )}
      {previousShiftRecord && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 text-sm">
          <p className="text-muted-foreground">
            เวรก่อนหน้า {formatDateLabel(previousShiftRecord.date)} ·{" "}
            {SHIFT_META[previousShiftRecord.shift].label} มีผู้ป่วย{" "}
            {previousShiftRecord.totalPatients} ราย
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-input"
            onClick={applyPrevious}
          >
            คำนวณจากเวรก่อนหน้า
          </Button>
        </div>
      )}
      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">ยอดผู้ป่วยและเตียง</h3>
            <p className="mt-1 text-sm text-muted-foreground">ตัวเลขหลักของเวรนี้</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums text-primary">
              {occupancy.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">{occupancyStatus.label}</p>
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <div>
            <Label htmlFor="total-patients">ผู้ป่วยทั้งหมด</Label>
            <Input
              id="total-patients"
              type="number"
              min={0}
              value={totalPatients}
              onChange={(event) =>
                setTotalPatients(readNumber(event.target.value))
              }
              className="mt-2 h-12 text-lg font-semibold tabular-nums"
            />
          </div>
          <div>
            <Label htmlFor="capacity">เตียงทั้งหมด</Label>
            <Input
              id="capacity"
              type="number"
              min={1}
              value={capacity}
              onChange={(event) =>
                setCapacity(Math.max(1, readNumber(event.target.value)))
              }
              className="mt-2 h-12 text-lg font-semibold tabular-nums"
            />
          </div>
          <div>
            <Label htmlFor="available-beds">เตียงว่าง</Label>
            <Input
              id="available-beds"
              type="number"
              min={0}
              value={availableBeds}
              disabled={autoAvailable}
              onChange={(event) =>
                setAvailableBeds(readNumber(event.target.value))
              }
              className="mt-2 h-12 text-lg font-semibold tabular-nums"
            />
            <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={autoAvailable}
                onCheckedChange={(checked) =>
                  setAutoAvailable(checked === true)
                }
              />
              คำนวณจากเตียงทั้งหมด
            </label>
          </div>
        </div>
      </section>
      <section>
        <div className="mb-4">
          <h3 className="text-lg font-semibold">การเคลื่อนไหวในเวร</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            จำนวนรับใหม่ จำหน่าย และส่งต่อ
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          <NumberStepper
            label="รับใหม่"
            hint="Admit"
            value={newPatients}
            onChange={setNewPatients}
          />
          <NumberStepper
            label="จำหน่าย"
            hint="Discharge"
            value={discharges}
            onChange={setDischarges}
          />
          <NumberStepper
            label="ส่งต่อ"
            hint="Refer"
            value={referrals}
            onChange={setReferrals}
          />
        </div>
      </section>
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">จำแนกประเภทผู้ป่วย</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              ใช้คำนวณเวลาการพยาบาลโดยประมาณตามน้ำหนักเดิม
            </p>
          </div>
          <div
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${categoryDifference === 0 ? "bg-secondary text-primary" : "bg-amber-50 text-amber-900"}`}
          >
            <span className="tabular-nums">
              จำแนก {categoryTotal} / {totalPatients} ราย
            </span>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {PATIENT_CATEGORIES.map((category, index) => (
            <div
              key={category.key}
              className={`rounded-lg border p-3 ${categoryAccentClasses[index]}`}
            >
              <label
                htmlFor={category.key}
                className="block min-h-10 text-sm font-medium"
              >
                {category.shortLabel}
              </label>
              <div className="mt-2 flex min-w-0 items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11 border-input"
                  onClick={() =>
                    setCategory(
                      category.key,
                      Math.max(0, categories[category.key] - 1),
                    )
                  }
                  disabled={categories[category.key] === 0}
                  aria-label={`ลด ประเภท ${index + 1}`}
                >
                  <Minus />
                </Button>
                <Input
                  id={category.key}
                  type="number"
                  min={0}
                  value={categories[category.key]}
                  onChange={(event) =>
                    setCategory(category.key, readNumber(event.target.value))
                  }
                  className="h-11 min-w-0 flex-1 px-2 text-center text-lg font-semibold tabular-nums"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11 border-input"
                  onClick={() =>
                    setCategory(category.key, categories[category.key] + 1)
                  }
                  aria-label={`เพิ่ม ประเภท ${index + 1}`}
                >
                  <Plus />
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {category.nursingHours} ชม./ราย
              </p>
            </div>
          ))}
        </div>
        {categoryDifference !== 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <Info className="size-4" />
            <span>
              ยอดรวมประเภทต่างจากยอดผู้ป่วย {Math.abs(categoryDifference)} ราย
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-amber-300 bg-card"
              onClick={() =>
                setCategory(
                  "cat3",
                  Math.max(0, categories.cat3 + categoryDifference),
                )
              }
            >
              ปรับสมดุลที่ประเภท 3
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-amber-300 bg-card"
              onClick={() => setTotalPatients(categoryTotal)}
            >
              ใช้ยอดจำแนก
            </Button>
          </div>
        )}
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-muted p-4">
          <Calculator className="size-5 text-primary" />
          <p className="text-sm text-muted-foreground">
            ภาระงานพยาบาลโดยประมาณ{" "}
            <strong className="ml-1 font-mono text-base text-foreground">
              {workloadHours.toFixed(1)} ชม./วัน
            </strong>
          </p>
        </div>
      </section>
      <section>
        <Label htmlFor="report-note">
          หมายเหตุภายในประจำเวร{" "}
          <span className="font-normal text-muted-foreground">(ถ้ามี)</span>
        </Label>
        <Textarea
          id="report-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="บันทึกสำหรับทีมภายใน เช่น รอผลตรวจ, เตรียมส่งต่อ..."
          className="mt-2 min-h-24"
        />
      </section>
      <section>
        <Label htmlFor="line-note">
          หมายเหตุสำหรับ LINE-safe{" "}
          <span className="font-normal text-muted-foreground">(ถ้ามี)</span>
        </Label>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          ส่งไปยังกลุ่ม LINE ที่ตั้งค่าไว้เมื่อเปิดตัวเลือกนี้เท่านั้น ห้ามใส่ชื่อ รหัสผู้ป่วย HN หรือข้อมูลที่ระบุตัวผู้ป่วยได้
        </p>
        <Textarea
          id="line-note"
          value={lineNote}
          onChange={(event) => setLineNote(event.target.value)}
          placeholder="เช่น เตรียมทีมรับส่งต่อ (ไม่มีข้อมูลผู้ป่วยเฉพาะราย)"
          className="mt-2 min-h-24"
        />
      </section>
      <section className="rounded-lg border border-border bg-background p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Preview ข้อความ LINE</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {reportSettings
                ? "ใช้ข้อมูลที่กรอกและรูปแบบเดียวกับระบบส่งอัตโนมัติ ตรวจทานก่อนบันทึก"
                : "Preview ยังไม่พร้อม เพราะยังโหลดการตั้งค่ารายงานไม่ได้"}
            </p>
          </div>
        </div>
        {previewText !== null ? (
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card p-4 font-sans text-sm leading-6 text-foreground">
            {previewText}
          </pre>
        ) : (
          <p role="status" className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
            รอโหลดการตั้งค่าจากระบบ หากยังไม่แสดง ให้โหลดหน้านี้ใหม่
          </p>
        )}
      </section>
      <div className="flex flex-col-reverse justify-end gap-3 border-t border-border pt-6 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 border-input"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          ยกเลิก
        </Button>
        <Button
          type="submit"
          className="min-h-11 bg-primary text-primary-foreground hover:bg-primary/90"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            "กำลังบันทึก…"
          ) : (
            <>
              <Clipboard />
              {isEditing ? "บันทึกการแก้ไข" : "บันทึกยอดเวร"}
            </>
          )}
        </Button>
      </div>
    </form>
  );
};

function formatDateLabel(date: string): string {
  if (!date) return "ยังไม่ระบุวันที่";
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${Number(year) + 543}`;
}
