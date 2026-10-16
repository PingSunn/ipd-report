"use client";

import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  Edit3,
  FilePlus2,
  MessageSquareText,
  Plus,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty";
import { CensusRecord, SHIFT_META, SHIFT_ORDER } from "../types/census";
import {
  calculateNursingWorkloadHours,
  calculateOccupancyRate,
  copyTextToClipboard,
  formatThaiDate,
  formatUpdatedAt,
  generateLineShiftSummary,
  getLineReportOptions,
  getOccupancyStatus,
  type SharedReportSettings,
} from "../utils/censusUtils";
import { PatientCategoryDonutChart } from "./PatientCategoryDonutChart";

interface LatestShiftOverviewProps {
  records: CensusRecord[];
  selectedRecord: CensusRecord | null;
  onSelectRecord: (record: CensusRecord) => void;
  onEditRecord: (record: CensusRecord) => void;
  onCreateNew: () => void;
  onOpenLineGenerator?: (record: CensusRecord) => void;
  reportSettings?: SharedReportSettings;
}

export const LatestShiftOverview: React.FC<LatestShiftOverviewProps> = ({
  records,
  selectedRecord,
  onSelectRecord,
  onEditRecord,
  onCreateNew,
  onOpenLineGenerator,
  reportSettings,
}) => {
  const [copied, setCopied] = useState(false);
  const active = selectedRecord || records[0] || null;
  const recentShiftGroups = useMemo(() => {
    const groups = new Map<string, CensusRecord[]>();
    const recentRecords = records.slice(0, 8);

    if (active && !recentRecords.some((record) => record.id === active.id)) {
      recentRecords.splice(7, 1, active);
    }

    for (const record of recentRecords) {
      const group = groups.get(record.date);
      if (group) {
        group.push(record);
      } else {
        groups.set(record.date, [record]);
      }
    }

    return Array.from(groups, ([date, groupRecords]) => ({
      date,
      records: [...groupRecords].sort(
        (a, b) => SHIFT_ORDER[a.shift] - SHIFT_ORDER[b.shift],
      ),
    }));
  }, [active, records]);
  const categoryCounts = useMemo(
    () =>
      active
        ? {
            cat1: active.cat1,
            cat2: active.cat2,
            cat3: active.cat3,
            cat4: active.cat4,
            cat5: active.cat5,
          }
        : { cat1: 0, cat2: 0, cat3: 0, cat4: 0, cat5: 0 },
    [active],
  );
  if (!active)
    return (
      <Empty className="rounded-xl border-border bg-card py-20">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="bg-secondary text-primary">
            <FilePlus2 />
          </EmptyMedia>
          <EmptyTitle>ยังไม่มีข้อมูลรายงานยอดผู้ป่วย</EmptyTitle>
          <EmptyDescription>
            เริ่มต้นบันทึกเวรแรกของตึกผู้ป่วยใน
            ข้อมูลจริงจะปรากฏที่นี่หลังบันทึกสำเร็จจากฐานข้อมูล
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={onCreateNew}
          >
            <Plus />
            บันทึกเวรแรก
          </Button>
        </EmptyContent>
      </Empty>
    );

  const occupancyRate = calculateOccupancyRate(
    active.totalPatients,
    active.capacity,
  );
  const occupancyStatus = getOccupancyStatus(
    active.totalPatients,
    active.capacity,
  );
  const workload = calculateNursingWorkloadHours(active);
  const copySummary = async () => {
    const ok = await copyTextToClipboard(
      generateLineShiftSummary(active, getLineReportOptions(reportSettings)),
    );
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    }
  };
  const statItems = [
    {
      label: "ผู้ป่วยทั้งหมด",
      value: `${active.totalPatients}`,
      suffix: ` / ${active.capacity} เตียง`,
      tone: "text-foreground",
    },
    {
      label: "ครองเตียง",
      value: `${occupancyRate.toFixed(1)}%`,
      suffix: occupancyStatus.label,
      tone:
        occupancyRate >= 95
          ? "text-red-700"
          : occupancyRate >= 80
            ? "text-amber-700"
            : "text-primary",
    },
    {
      label: "การเคลื่อนไหว",
      value: `+${active.newPatients} / −${active.discharges}`,
      suffix: `ส่งต่อ ${active.referrals}`,
      tone: "text-foreground",
    },
    {
      label: "ภาระงานโดยประมาณ",
      value: workload.toFixed(1),
      suffix: "ชม./วัน",
      tone: "text-primary",
    },
  ];
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-5 border-b border-border p-5 sm:p-7">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
          <div>
            <h2 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
              สรุปเวร · {formatThaiDate(active.date, true)}
              <span className="whitespace-nowrap">
                {" "}· {SHIFT_META[active.shift].label}
              </span>
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {reportSettings?.wardName || "ตึกผู้ป่วยใน"} · {reportSettings?.hospitalName || "โรงพยาบาลองครักษ์"} · {" "}
              {SHIFT_META[active.shift].timeRange} · แก้ไขล่าสุด{" "}
              {formatUpdatedAt(active.updatedAt, true)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 border-input"
              onClick={() => onEditRecord(active)}
            >
              <Edit3 />
              แก้ไข
            </Button>
            {onOpenLineGenerator && (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 border-input"
                onClick={() => onOpenLineGenerator(active)}
              >
                <MessageSquareText />
                ปรับแต่ง LINE
              </Button>
            )}
            <Button
              size="sm"
              className={
                copied
                  ? "min-h-11 bg-primary text-primary-foreground"
                  : "min-h-11 bg-primary text-primary-foreground hover:bg-primary/90"
              }
              onClick={() => void copySummary()}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "คัดลอกแล้ว" : "คัดลอกส่ง LINE"}
            </Button>
          </div>
        </div>
        <div className="border-t border-border pt-4">
          <div className="mb-3">
            <h3 id="recent-shifts-heading" className="text-sm font-semibold">
              เวรล่าสุด
            </h3>
            <p id="recent-shifts-description" className="mt-1 text-sm text-muted-foreground">
              เลือกวันที่และเวรเพื่อทบทวนยอด
            </p>
          </div>
          <div
            className="flex snap-x gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible xl:grid-cols-3"
            role="group"
            aria-labelledby="recent-shifts-heading"
            aria-describedby="recent-shifts-description"
          >
            {recentShiftGroups.map((group) => {
              const groupId = `recent-shift-date-${group.date}`;
              return (
                <div
                  key={group.date}
                  role="group"
                  aria-labelledby={groupId}
                  className="w-[min(78vw,18rem)] shrink-0 snap-start rounded-lg border border-border bg-background p-2.5 sm:w-auto"
                >
                  <h4 id={groupId} className="px-1.5 pb-2 text-sm font-semibold text-foreground">
                    {formatThaiDate(group.date, false)}
                  </h4>
                  <div className="grid grid-cols-3 gap-2">
                    {group.records.map((record) => {
                      const isSelected = record.id === active.id;
                      return (
                        <button
                          type="button"
                          key={record.id}
                          onClick={() => onSelectRecord(record)}
                          className={`relative flex min-h-11 items-center justify-center rounded-md border px-2 text-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${isSelected ? "border-primary bg-secondary text-foreground" : "border-border bg-card text-muted-foreground hover:border-accent hover:bg-card"}`}
                          aria-label={`${SHIFT_META[record.shift].label} ${formatThaiDate(record.date, false)}${isSelected ? " เลือกอยู่" : ""}`}
                          aria-pressed={isSelected}
                        >
                          <span className="font-semibold">{SHIFT_META[record.shift].label}</span>
                          {isSelected && (
                            <Check
                              className="absolute right-1.5 size-3.5"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-border border-b border-border sm:grid-cols-4 sm:divide-y-0">
        {statItems.map((stat) => (
          <div className="p-5 sm:p-6" key={stat.label}>
            <p className="text-sm text-muted-foreground">{stat.label}</p>
            <p
              className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${stat.tone}`}
            >
              {stat.value}
              <span className="ml-1 text-xs font-sans font-normal text-muted-foreground">
                {stat.suffix}
              </span>
            </p>
          </div>
        ))}
      </div>
      <div className="grid gap-8 p-5 sm:p-7 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-semibold">สัดส่วนประเภทผู้ป่วย</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                รวม {active.totalPatients} รายในเวรนี้
              </p>
            </div>
            <span className="text-sm text-muted-foreground">
              {active.availableBeds} เตียงว่าง
            </span>
          </div>
          <PatientCategoryDonutChart counts={categoryCounts} stacked />
        </div>
        <div>
          <h3 className="font-semibold">การส่งต่อข้อมูลเวร</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            ใช้ตัวเลขชุดเดียวกันในการทบทวนเวรและสร้างข้อความส่งต่อ
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              { label: "รับใหม่", value: active.newPatients, detail: "ราย" },
              { label: "จำหน่าย", value: active.discharges, detail: "ราย" },
              { label: "ส่งต่อ", value: active.referrals, detail: "ราย" },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-border bg-background p-4"
              >
                <p className="text-sm text-muted-foreground">{item.label}</p>
                <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
                  {item.value}
                  <span className="ml-1 text-xs font-sans font-normal text-muted-foreground">
                    {item.detail}
                  </span>
                </p>
              </div>
            ))}
          </div>
          {active.note && (
            <div className="mt-4 rounded-lg bg-muted p-4">
              <p className="text-sm font-medium">หมายเหตุ</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {active.note}
              </p>
            </div>
          )}
          <button
            type="button"
            className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline"
            onClick={onCreateNew}
          >
            บันทึกเวรถัดไป <ArrowRight className="size-4" />
          </button>
        </div>
      </div>
    </section>
  );
};
