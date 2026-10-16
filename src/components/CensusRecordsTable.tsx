"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Download,
  Edit3,
  MessageSquareText,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty";
import { DatePicker } from "./ui/date-picker";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Skeleton } from "./ui/skeleton";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { CensusRecord, SHIFT_META, ShiftType } from "../types/census";
import {
  calculateOccupancyRate,
  exportCensusToCSV,
  formatThaiDate,
  getTodayDateString,
} from "../utils/censusUtils";

interface CensusRecordsTableProps {
  records: CensusRecord[];
  isLoading: boolean;
  onEdit: (record: CensusRecord) => void;
  onDelete: (id: string) => void;
  onCreateNew: () => void;
  onOpenLineGenerator: (record: CensusRecord) => void;
  canDelete?: boolean;
  canExport?: boolean;
  compact?: boolean;
}

const shifts: Array<"all" | ShiftType> = ["all", "เช้า", "บ่าย", "ดึก"];
const pageSize = 8;
type DatePreset = "all" | "today" | "7d" | "30d" | "custom";

export const CensusRecordsTable: React.FC<CensusRecordsTableProps> = ({
  records,
  isLoading,
  onEdit,
  onDelete,
  onCreateNew,
  onOpenLineGenerator,
  canDelete = true,
  canExport = true,
  compact = false,
}) => {
  const [query, setQuery] = useState("");
  const [shiftFilter, setShiftFilter] = useState<"all" | ShiftType>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [customDate, setCustomDate] = useState("");
  const [page, setPage] = useState(1);
  const today = getTodayDateString();
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return records.filter((record) => {
      const matchesShift =
        shiftFilter === "all" || record.shift === shiftFilter;
      const matchesDate =
        datePreset === "all" ||
        (datePreset === "today" && record.date === today) ||
        (datePreset === "7d" &&
          record.date >= getTodayDateString(-6) &&
          record.date <= today) ||
        (datePreset === "30d" &&
          record.date >= getTodayDateString(-29) &&
          record.date <= today) ||
        (datePreset === "custom" &&
          (!customDate || record.date === customDate));
      const matchesQuery =
        !normalized ||
        `${record.id} ${record.date} ${formatThaiDate(record.date, true)} ${record.shift} ${SHIFT_META[record.shift].label} ${record.note}`
          .toLowerCase()
          .includes(normalized);
      return matchesShift && matchesDate && matchesQuery;
    });
  }, [customDate, datePreset, query, records, shiftFilter, today]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const effectivePage = Math.min(page, pageCount);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const visibleRecords = compact
    ? filtered.slice(0, 6)
    : filtered.slice((effectivePage - 1) * pageSize, effectivePage * pageSize);
  const setSearch = (value: string) => {
    setQuery(value);
    setPage(1);
  };
  const setShift = (value: "all" | ShiftType) => {
    setShiftFilter(value);
    setPage(1);
  };
  const setDateFilter = (value: DatePreset) => {
    setDatePreset(value);
    setPage(1);
  };
  if (isLoading)
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card p-5">
        <Skeleton className="mb-4 h-11 bg-muted" />
        <Skeleton className="h-52 bg-muted" />
      </div>
    );
  if (records.length === 0)
    return (
      <Empty className="rounded-xl border-border bg-card py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="bg-secondary text-primary">
            <Plus />
          </EmptyMedia>
          <EmptyTitle>ยังไม่มีรายการบันทึก</EmptyTitle>
          <EmptyDescription>
            ข้อมูลจากฐานข้อมูลกลางยังว่างอยู่
            เริ่มบันทึกยอดเวรแรกเพื่อสร้างประวัติและการวิเคราะห์
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            onClick={onCreateNew}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus />
            บันทึกยอดเวร
          </Button>
        </EmptyContent>
      </Empty>
    );
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ค้นหาวันที่หรือหมายเหตุ"
            className="h-11 pl-9"
            aria-label="ค้นหารายการ"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!compact && (
            <div className="flex items-center gap-2">
              <Select
                value={datePreset}
                onValueChange={(value) => setDateFilter(value as DatePreset)}
              >
                <SelectTrigger
                  id="date-filter"
                  aria-label="กรองตามช่วงวันที่"
                  className="h-11 w-auto bg-background text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    <SelectItem value="all">ทุกช่วงเวลา</SelectItem>
                    <SelectItem value="today">วันนี้</SelectItem>
                    <SelectItem value="7d">7 วันล่าสุด</SelectItem>
                    <SelectItem value="30d">30 วันล่าสุด</SelectItem>
                    <SelectItem value="custom">วันที่กำหนด</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              {datePreset === "custom" && (
                <>
                  <Label htmlFor="custom-date" className="sr-only">
                    วันที่กำหนด
                  </Label>
                  <DatePicker
                    id="custom-date"
                    value={customDate}
                    onChange={(value: string) => {
                      setCustomDate(value);
                      setPage(1);
                    }}
                    className="h-11 w-auto"
                  />
                </>
              )}
            </div>
          )}
          <div
            className="flex gap-1 rounded-md border border-border p-1"
            aria-label="กรองตามเวร"
          >
            {shifts.map((shift) => (
              <button
                type="button"
                key={shift}
                onClick={() => setShift(shift)}
                className={`min-h-11 rounded px-2.5 text-xs font-medium transition-colors ${shiftFilter === shift ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-background"}`}
              >
                {shift === "all" ? "ทุกเวร" : shift}
              </button>
            ))}
          </div>
          {canExport && <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 border-input"
            onClick={() => exportCensusToCSV(filtered)}
            disabled={filtered.length === 0}
          >
            <Download />
            ส่งออก CSV
          </Button>}
        </div>
      </div>
      <div className="flex flex-col gap-3 p-4 md:hidden">
        {visibleRecords.map((record) => {
          const rate = calculateOccupancyRate(
            record.totalPatients,
            record.capacity,
          );
          return (
            <article
              key={record.id}
              className="rounded-lg border border-border bg-background p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{formatThaiDate(record.date)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {SHIFT_META[record.shift].label} ·{" "}
                    {SHIFT_META[record.shift].timeRange}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={
                    rate >= 95
                      ? "border-destructive/30 bg-destructive/10 text-destructive-strong"
                      : rate >= 80
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-accent bg-secondary text-primary"
                  }
                >
                  {rate.toFixed(1)}%
                </Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <span className="text-muted-foreground">
                  ผู้ป่วย{" "}
                  <strong className="font-mono text-foreground">
                    {record.totalPatients}
                  </strong>{" "}
                  ราย
                </span>
                <span className="text-muted-foreground">
                  เตียงว่าง{" "}
                  <strong className="font-mono text-foreground">
                    {record.availableBeds}
                  </strong>
                </span>
                <span className="text-muted-foreground">
                  รับใหม่{" "}
                  <strong className="font-mono text-foreground">
                    +{record.newPatients}
                  </strong>
                </span>
                <span className="text-muted-foreground">
                  จำหน่าย{" "}
                  <strong className="font-mono text-foreground">
                    −{record.discharges}
                  </strong>
                </span>
              </div>
              <div className="mt-4 flex justify-end gap-1 border-t border-border pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={() => onOpenLineGenerator(record)}
                >
                  <MessageSquareText />
                  LINE
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={() => onEdit(record)}
                >
                  <Edit3 />
                  แก้ไข
                </Button>
                {canDelete && <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 text-destructive"
                    >
                      <Trash2 />
                      ลบ
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        ลบรายการรายงานยอดผู้ป่วย?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        รายการ {formatThaiDate(record.date)} ·{" "}
                        {SHIFT_META[record.shift].label} จะถูกลบจากฐานข้อมูลกลาง
                        และเรียกคืนไม่ได้
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => onDelete(record.id)}
                      >
                        ลบรายการ
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>}
              </div>
            </article>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-background">
              <TableHead className="pl-5">วันที่ / เวร</TableHead>
              <TableHead>ผู้ป่วย</TableHead>
              {!compact && <TableHead>เตียงว่าง</TableHead>}
              {!compact && <TableHead>การเคลื่อนไหว</TableHead>}
              <TableHead>ครองเตียง</TableHead>
              <TableHead className="pr-5 text-right">การทำงาน</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRecords.map((record) => {
              const rate = calculateOccupancyRate(
                record.totalPatients,
                record.capacity,
              );
              return (
                <TableRow key={record.id}>
                  <TableCell className="pl-5">
                    <p className="font-medium text-foreground">
                      {formatThaiDate(record.date)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {SHIFT_META[record.shift].label} ·{" "}
                      {SHIFT_META[record.shift].timeRange}
                    </p>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-base font-semibold tabular-nums">
                      {record.totalPatients}
                    </span>
                    <span className="ml-1 text-xs text-muted-foreground">ราย</span>
                  </TableCell>
                  {!compact && (
                    <TableCell>
                      <span className="font-mono tabular-nums">
                        {record.availableBeds}
                      </span>
                      <span className="ml-1 text-xs text-muted-foreground">เตียง</span>
                    </TableCell>
                  )}
                  {!compact && (
                    <TableCell className="font-mono text-xs tabular-nums">
                      <span className="text-primary">
                        +{record.newPatients}
                      </span>
                      <span className="mx-1 text-muted-foreground">/</span>
                      <span>−{record.discharges}</span>
                      <span className="mx-1 text-muted-foreground">/</span>
                      <span className="text-amber-700">
                        ส่งต่อ {record.referrals}
                      </span>
                    </TableCell>
                  )}
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        rate >= 95
                          ? "border-destructive/30 bg-destructive/10 text-destructive-strong"
                          : rate >= 80
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : "border-accent bg-secondary text-primary"
                      }
                    >
                      {rate.toFixed(1)}%
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-5">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 text-muted-foreground hover:bg-secondary hover:text-primary"
                        onClick={() => onOpenLineGenerator(record)}
                        aria-label={`สร้างข้อความ LINE สำหรับ ${record.date}`}
                      >
                        <MessageSquareText />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 text-muted-foreground hover:bg-secondary hover:text-primary"
                        onClick={() => onEdit(record)}
                        aria-label={`แก้ไขรายการ ${record.date}`}
                      >
                        <Edit3 />
                      </Button>
                {canDelete && <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-11 text-destructive hover:bg-destructive/10"
                            aria-label={`ลบรายการ ${record.date}`}
                          >
                            <Trash2 />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              ลบรายการรายงานยอดผู้ป่วย?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              รายการ {formatThaiDate(record.date)} ·{" "}
                              {SHIFT_META[record.shift].label}{" "}
                              จะถูกลบจากฐานข้อมูลกลาง และเรียกคืนไม่ได้
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => onDelete(record.id)}
                            >
                              ลบรายการ
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                </AlertDialog>}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {visibleRecords.length === 0 && (
        <p className="p-10 text-center text-sm text-muted-foreground">
          ไม่พบรายการตามเงื่อนไขค้นหา
        </p>
      )}
      {!compact && (
        <div className="flex flex-col gap-3 border-t border-border p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            แสดง {visibleRecords.length} จาก {filtered.length} รายการ
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
            className="min-h-11 border-input"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={effectivePage <= 1}
            >
              ก่อนหน้า
            </Button>
            <span className="min-w-16 text-center tabular-nums">
              {effectivePage} / {pageCount}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
            className="min-h-11 border-input"
              onClick={() =>
                setPage((current) => Math.min(pageCount, current + 1))
              }
              disabled={effectivePage >= pageCount}
            >
              ถัดไป
            </Button>
          </div>
        </div>
      )}
    </section>
  );
};
