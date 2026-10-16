"use client";

import React, { useMemo, useState } from "react";
import {
  Activity,
  ArrowUpFromLine,
  BedDouble,
  Clock3,
  TrendingUp,
} from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty";
import { CensusRecord, SHIFT_META, ShiftType } from "../types/census";
import {
  calculateNursingWorkloadHours,
  calculateOccupancyRate,
  formatThaiDate,
  sortRecordsAsc,
} from "../utils/censusUtils";
import { PatientCategoryDonutChart } from "./PatientCategoryDonutChart";

interface CensusAnalyticsProps {
  records: CensusRecord[];
  onSelectRecord?: (record: CensusRecord) => void;
}
const shifts: ShiftType[] = ["ดึก", "เช้า", "บ่าย"];

export const CensusAnalytics: React.FC<CensusAnalyticsProps> = ({
  records,
  onSelectRecord,
}) => {
  const [range, setRange] = useState(15);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chronological = useMemo(() => {
    const sorted = sortRecordsAsc(records);
    return sorted.slice(Math.max(0, sorted.length - range));
  }, [range, records]);
  const summary = useMemo(() => {
    const emptyByShift = () => ({
      count: 0,
      totalPatients: 0,
      admits: 0,
      discharges: 0,
      referrals: 0,
    });
    const byShift: Record<ShiftType, ReturnType<typeof emptyByShift>> = {
      ดึก: emptyByShift(),
      เช้า: emptyByShift(),
      บ่าย: emptyByShift(),
    };
    const categories = { cat1: 0, cat2: 0, cat3: 0, cat4: 0, cat5: 0 };
    if (!records.length)
      return {
        avgOccupancy: 0,
        avgPatients: 0,
        peakPatients: 0,
        workload: 0,
        admits: 0,
        discharges: 0,
        referrals: 0,
        categories,
        byShift,
      };
    let occupancy = 0;
    let patientTotal = 0;
    let peak = 0;
    let workload = 0;
    let admits = 0;
    let discharges = 0;
    let referrals = 0;
    records.forEach((record) => {
      occupancy += calculateOccupancyRate(
        record.totalPatients,
        record.capacity,
      );
      patientTotal += record.totalPatients;
      peak = Math.max(peak, record.totalPatients);
      workload += calculateNursingWorkloadHours(record);
      admits += record.newPatients;
      discharges += record.discharges;
      referrals += record.referrals;
      categories.cat1 += record.cat1;
      categories.cat2 += record.cat2;
      categories.cat3 += record.cat3;
      categories.cat4 += record.cat4;
      categories.cat5 += record.cat5;
      const item = byShift[record.shift];
      item.count += 1;
      item.totalPatients += record.totalPatients;
      item.admits += record.newPatients;
      item.discharges += record.discharges;
      item.referrals += record.referrals;
    });
    return {
      avgOccupancy: occupancy / records.length,
      avgPatients: patientTotal / records.length,
      peakPatients: peak,
      workload: workload / records.length,
      admits,
      discharges,
      referrals,
      categories,
      byShift,
    };
  }, [records]);
  const activePoint =
    hoverIndex !== null
      ? chronological[hoverIndex] || chronological.at(-1) || null
      : chronological.at(-1) || null;
  const chart = useMemo(() => {
    const width = 900;
    const height = 280;
    const left = 44;
    const right = 22;
    const top = 24;
    const bottom = 42;
    const innerWidth = width - left - right;
    const innerHeight = height - top - bottom;
    const max =
      Math.max(
        35,
        ...chronological.map((record) =>
          Math.max(record.totalPatients, record.capacity),
        ),
      ) + 4;
    const x = (index: number) =>
      chronological.length <= 1
        ? left + innerWidth / 2
        : left + (index / (chronological.length - 1)) * innerWidth;
    const y = (value: number) =>
      top +
      innerHeight -
      (Math.min(max, Math.max(0, value)) / max) * innerHeight;
    const points = chronological.map((record, index) => ({
      x: x(index),
      y: y(record.totalPatients),
      record,
    }));
    const path = points
      .map(
        (point, index) =>
          `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
      )
      .join(" ");
    return {
      width,
      height,
      left,
      right,
      top,
      bottom,
      innerHeight,
      max,
      x,
      y,
      points,
      path,
    };
  }, [chronological]);
  if (!records.length)
    return (
      <Empty className="rounded-xl border-border bg-card py-20">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="bg-primary/10 text-primary">
            <TrendingUp />
          </EmptyMedia>
          <EmptyTitle>ยังไม่มีข้อมูลสำหรับวิเคราะห์</EmptyTitle>
          <EmptyDescription>
            กราฟและสถิติจะเริ่มแสดงเมื่อมีรายการบันทึกยอดเวรจากฐานข้อมูล
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <div className="grid grid-cols-2 divide-x divide-y border-y border-border bg-muted/40 xl:grid-cols-4 xl:divide-y-0">
        <Metric
          icon={<BedDouble />}
          label="อัตราครองเตียงเฉลี่ย"
          value={`${summary.avgOccupancy.toFixed(1)}%`}
          detail={`${summary.avgPatients.toFixed(1)} ราย/เวร`}
          tone="primary"
        />
        <Metric
          icon={<Activity />}
          label="ยอดผู้ป่วยสูงสุด"
          value={`${summary.peakPatients}`}
          detail="รายในเวรที่มีผู้ป่วยสูงสุด"
          tone="secondary"
        />
        <Metric
          icon={<Clock3 />}
          label="ภาระงานเฉลี่ย"
          value={`${summary.workload.toFixed(1)}`}
          detail="ชม./วัน (เฉลี่ยจากเวรที่บันทึก)"
          tone="accent"
        />
        <Metric
          icon={<ArrowUpFromLine />}
          label="การเคลื่อนไหวสะสม"
          value={`+${summary.admits} / −${summary.discharges}`}
          detail={`ส่งต่อ ${summary.referrals} ราย`}
          tone="warning"
        />
      </div>
      <section className="min-w-0 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-7">
        <div className="flex flex-col justify-between gap-4 border-b border-border pb-5 sm:flex-row sm:items-start">
          <div>
            <h2 className="text-xl font-semibold">
              แนวโน้มผู้ป่วยคงเหลือเทียบศักยภาพเตียง
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              เลือกจุดบนกราฟเพื่อดูรายละเอียดของเวรนั้น
            </p>
          </div>
          <div className="flex gap-1 rounded-md border border-border p-1">
            {[9, 15, 30].map((value) => (
              <button
                type="button"
                key={value}
                onClick={() => setRange(value)}
                className={`min-h-11 rounded px-3 text-xs font-medium ${range === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >
                {value} เวร
              </button>
            ))}
          </div>
        </div>
        {activePoint && (
          <div className="my-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent/35 p-4 text-sm">
            <div>
              <strong>{formatThaiDate(activePoint.date, true)}</strong>
              <span className="mx-2 text-muted-foreground">·</span>
              <span className="text-primary">
                {SHIFT_META[activePoint.shift].label}
              </span>
            </div>
            <div className="font-mono tabular-nums text-muted-foreground">
              คงเหลือ{" "}
              <strong className="text-foreground">
                {activePoint.totalPatients}/{activePoint.capacity}
              </strong>{" "}
              · ว่าง {activePoint.availableBeds} · รับใหม่ +
              {activePoint.newPatients} · จำหน่าย −{activePoint.discharges}
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${chart.width} ${chart.height}`}
            className="h-auto w-full"
            role="img"
            aria-label="กราฟแนวโน้มผู้ป่วยคงเหลือเทียบศักยภาพเตียง"
          >
            <line
              x1={chart.left}
              x2={chart.width - chart.right}
              y1={chart.y(activePoint?.capacity || 30)}
              y2={chart.y(activePoint?.capacity || 30)}
              stroke="var(--muted-foreground)"
              opacity="0.5"
              strokeDasharray="6 6"
            />
            <path
              d={`${chart.path} L ${chart.points.at(-1)?.x || chart.left} ${chart.height - chart.bottom} L ${chart.points[0]?.x || chart.left} ${chart.height - chart.bottom} Z`}
              fill="var(--primary)"
              opacity="0.12"
            />
            <path
              d={chart.path}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {chart.points.map((point, index) => (
              <g key={point.record.id}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="22"
                  fill="transparent"
                  stroke="transparent"
                  className="cursor-pointer focus-visible:stroke-ring"
                  role="button"
                  tabIndex={0}
                  aria-label={
                    formatThaiDate(point.record.date) +
                    " " +
                    point.record.shift +
                    " ผู้ป่วย " +
                    point.record.totalPatients +
                    " ราย"
                  }
                  onMouseEnter={() => setHoverIndex(index)}
                  onMouseLeave={() => setHoverIndex(null)}
                  onFocus={() => setHoverIndex(index)}
                  onBlur={() => setHoverIndex(null)}
                  onClick={() => onSelectRecord?.(point.record)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectRecord?.(point.record);
                    }
                  }}
                />
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={hoverIndex === index ? 7 : 5}
                  fill={hoverIndex === index ? "var(--foreground)" : "var(--primary)"}
                  stroke="var(--card)"
                  strokeWidth="2"
                  pointerEvents="none"
                  aria-hidden="true"
                />
              </g>
            ))}
            {Array.from({ length: 4 }, (_, index) => {
              const value = Math.round((chart.max / 3) * index);
              return (
                <g key={value}>
                  <line
                    x1={chart.left}
                    x2={chart.width - chart.right}
                    y1={chart.y(value)}
                    y2={chart.y(value)}
                    stroke="var(--border)"
                  />
                  <text
                    x="6"
                    y={chart.y(value) + 4}
                    fontSize="12"
                    fill="var(--muted-foreground)"
                  >
                    {value}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="mt-3 flex flex-wrap gap-5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <span className="size-3 rounded-full bg-primary" />
            ผู้ป่วยคงเหลือ
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="w-5 border-t border-dashed border-muted-foreground" />
            ศักยภาพเตียง
          </span>
        </div>
      </section>
      <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="min-w-0 rounded-xl border border-border bg-card p-5 sm:p-7">
          <div className="mb-5">
            <h2 className="text-xl font-semibold">การจำแนกผู้ป่วยประเภท 1–5</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              ยอดรวมจาก {records.length} เวร
            </p>
          </div>
          <PatientCategoryDonutChart
            counts={summary.categories}
          />
        </section>
        <section className="min-w-0 rounded-xl border border-border bg-card p-5 sm:p-7">
          <div className="mb-5">
            <h2 className="text-xl font-semibold">การเคลื่อนไหวแยกตามเวร</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
              <caption className="sr-only">
                เปรียบเทียบค่าเฉลี่ยผู้ป่วยและการเคลื่อนไหวของผู้ป่วยแยกตามเวร
              </caption>
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-2 py-3 font-medium" scope="col">
                    เวรปฏิบัติงาน
                  </th>
                  <th className="whitespace-nowrap px-2 py-3 text-right font-medium" scope="col">
                    เฉลี่ยคงเหลือ
                  </th>
                  <th className="whitespace-nowrap px-2 py-3 text-right font-medium" scope="col">
                    รับใหม่รวม
                  </th>
                  <th className="whitespace-nowrap px-2 py-3 text-right font-medium" scope="col">
                    จำหน่ายรวม
                  </th>
                  <th className="whitespace-nowrap px-2 py-3 text-right font-medium" scope="col">
                    ส่งต่อรวม
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shifts.map((shift) => {
                  const item = summary.byShift[shift];
                  const average = item.count ? item.totalPatients / item.count : 0;
                  return (
                    <tr key={shift} className="align-middle">
                      <th className="px-2 py-3 font-medium text-foreground" scope="row">
                        <span className="block whitespace-nowrap">{SHIFT_META[shift].label}</span>
                        <span className="mt-0.5 block whitespace-nowrap text-xs font-normal text-muted-foreground">
                          บันทึก {item.count} เวร
                        </span>
                      </th>
                      <td className="whitespace-nowrap px-2 py-3 text-right font-mono tabular-nums text-primary">
                        {average.toFixed(1)} ราย
                      </td>
                      <td className="whitespace-nowrap px-2 py-3 text-right font-mono tabular-nums text-foreground">
                        +{item.admits}
                      </td>
                      <td className="whitespace-nowrap px-2 py-3 text-right font-mono tabular-nums text-foreground">
                        −{item.discharges}
                      </td>
                      <td className="whitespace-nowrap px-2 py-3 text-right font-mono tabular-nums text-foreground">
                        {item.referrals}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};

function Metric({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "primary" | "secondary" | "accent" | "warning";
}) {
  const toneClasses = {
    primary: {
      surface: "bg-surface-cyan",
      icon: "text-brand-cyan-strong",
    },
    secondary: {
      surface: "bg-surface-aqua",
      icon: "text-secondary-foreground",
    },
    accent: {
      surface: "bg-surface-emerald",
      icon: "text-brand-emerald-strong",
    },
    warning: {
      surface: "bg-surface-warning",
      icon: "text-amber-700",
    },
  } as const;
  const { surface: surfaceClass, icon: iconClass } = toneClasses[tone];
  return (
    <div className={`min-w-0 p-4 sm:p-5 ${surfaceClass}`}>
      <div className={`flex items-center gap-2 ${iconClass}`}>
        {icon}
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <p className="mt-3 font-mono text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
