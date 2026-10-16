"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  Clipboard,
  Copy,
  MessageSquareText,
  RotateCcw,
} from "lucide-react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
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
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { CensusRecord } from "../types/census";
import {
  copyTextToClipboard,
  generateLineShiftSummary,
  getLineReportOptions,
  LineReportFormat,
  type SharedReportSettings,
} from "../utils/censusUtils";
import { formatThaiDate, formatUpdatedAt } from "../utils/censusUtils";

interface LineReportGeneratorProps {
  record: CensusRecord;
  allRecords: CensusRecord[];
  onSelectRecord: (record: CensusRecord) => void;
  onCopied?: (message: string) => void;
  onClose?: () => void;
  isModal?: boolean;
  reportSettings?: SharedReportSettings;
}

export const LineReportGenerator: React.FC<LineReportGeneratorProps> = ({
  record,
  allRecords,
  onSelectRecord,
  onCopied,
  reportSettings,
}) => {
  const initialOptions = getLineReportOptions(reportSettings);
  const [format, setFormat] = useState<LineReportFormat>(initialOptions.format ?? "standard");
  const [includeCapacity, setIncludeCapacity] = useState(initialOptions.includeCapacityAndOccupancy ?? true);
  const [includeCategories, setIncludeCategories] = useState(initialOptions.includeCategories ?? true);
  const [includeWorkload, setIncludeWorkload] = useState(initialOptions.includeWorkloadHours ?? false);
  const [includeNote, setIncludeNote] = useState(initialOptions.includeNote ?? true);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const detailedFormat = format === "detailed";
  const generatedText = useMemo(
    () =>
      generateLineShiftSummary(record, {
        format,
        includeCapacityAndOccupancy: includeCapacity,
        includeCategories,
        includeWorkloadHours: detailedFormat || includeWorkload,
        includeNote,
        hospitalName: reportSettings?.hospitalName,
        wardName: reportSettings?.wardName,
      }),
    [
      format,
      includeCapacity,
      includeCategories,
      includeNote,
      includeWorkload,
      detailedFormat,
      record,
      reportSettings,
    ],
  );
  useEffect(() => setText(generatedText), [generatedText]);
  const copyReport = async () => {
    const ok = await copyTextToClipboard(text);
    if (!ok) {
      onCopied?.("คัดลอกไม่สำเร็จ กรุณาเลือกข้อความแล้วคัดลอกด้วยตนเอง");
      return;
    }
    setCopied(true);
    onCopied?.("คัดลอกข้อความ LINE ลง Clipboard แล้ว");
    window.setTimeout(() => setCopied(false), 2200);
  };
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border p-5 sm:p-7">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-semibold">
              <MessageSquareText className="size-5 text-primary" />
              สรุปข้อความสำหรับ LINE
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              แก้ไขข้อความได้ก่อนคัดลอก โดยข้อมูลต้นทางยังคงเป็นรายการที่เลือก
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {reportSettings?.wardName || "ตึกผู้ป่วยใน"} · {reportSettings?.hospitalName || "โรงพยาบาลองครักษ์"}
            </p>
          </div>
          <div className="text-sm text-muted-foreground">
            <span>แก้ไขล่าสุด </span>
            {formatUpdatedAt(record.updatedAt, true)}
          </div>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <Label htmlFor="line-record">เลือกเวร</Label>
            <Select
              value={record.id}
              onValueChange={(value) => {
                const next = allRecords.find((item) => item.id === value);
                if (next) onSelectRecord(next);
              }}
            >
              <SelectTrigger id="line-record" className="mt-2 w-full bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectGroup>
                  {allRecords.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {formatThaiDate(item.date)} · {item.shift} · {item.totalPatients} ราย
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border border-border bg-background p-3 text-sm">
            <p className="font-semibold">
              {formatThaiDate(record.date, true)} · เวร{record.shift}
            </p>
            <p className="mt-1 text-muted-foreground">
              {record.totalPatients} ราย · {record.availableBeds} เตียงว่าง
            </p>
          </div>
        </div>
      </div>
      <div className="grid gap-8 p-5 sm:p-7 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <div>
            <Label>รูปแบบข้อความ</Label>
            <ToggleGroup
              type="single"
              value={format}
              onValueChange={(value) => {
                if (value) setFormat(value as LineReportFormat);
              }}
              variant="outline"
              spacing={1}
              className="mt-2 grid w-full grid-cols-3"
            >
              <ToggleGroupItem
                value="standard"
                className="min-h-11 px-2 text-xs"
              >
                มาตรฐาน
              </ToggleGroupItem>
              <ToggleGroupItem
                value="compact"
                className="min-h-11 px-2 text-xs"
              >
                กระชับ
              </ToggleGroupItem>
              <ToggleGroupItem
                value="detailed"
                className="min-h-11 px-2 text-xs"
              >
                ละเอียด
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-2 text-sm font-medium">เนื้อหาที่แสดง</legend>
            <OptionCheckbox
              id="include-capacity"
              checked={includeCapacity}
              onChange={setIncludeCapacity}
              label="เตียงและอัตราครองเตียง"
            />
            <OptionCheckbox
              id="include-categories"
              checked={includeCategories}
              onChange={setIncludeCategories}
              label="ประเภทผู้ป่วย 1–5"
            />
            <OptionCheckbox
              id="include-workload"
              checked={detailedFormat || includeWorkload}
              onChange={setIncludeWorkload}
              disabled={detailedFormat}
              label="ภาระงานโดยประมาณ"
            />
            <OptionCheckbox
              id="include-note"
              checked={includeNote}
              onChange={setIncludeNote}
              label="หมายเหตุประจำเวร"
            />
          </fieldset>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full border-input"
            onClick={() => setText(generatedText)}
          >
            <RotateCcw />
            คืนค่าข้อความตามรูปแบบ
          </Button>
        </div>
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="line-text">ข้อความที่จะแชร์</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                แก้ไขข้อความในช่องนี้ได้โดยตรง
              </p>
            </div>
            <Button
              type="button"
              className={
                copied
                  ? "min-h-11 bg-primary text-primary-foreground"
                  : "min-h-11 bg-primary text-primary-foreground hover:bg-primary/90"
              }
              onClick={() => void copyReport()}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "คัดลอกแล้ว" : "คัดลอกข้อความ"}
            </Button>
          </div>
          <Textarea
            id="line-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-[420px] resize-y whitespace-pre-wrap font-sans text-sm leading-6"
          />
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Clipboard className="size-4" />
            ข้อความนี้ยังไม่ส่งออกจนกว่าจะกดคัดลอก
          </div>
        </div>
      </div>
    </section>
  );
};

function OptionCheckbox({
  id,
  checked,
  onChange,
  disabled = false,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex min-h-11 items-center gap-3 rounded-md px-2 text-sm text-muted-foreground hover:bg-background ${disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      {label}
    </label>
  );
}
