"use client";

import React, { useState } from "react";
import { PATIENT_CATEGORIES } from "../types/census";

export interface CategoryCounts {
  cat1: number;
  cat2: number;
  cat3: number;
  cat4: number;
  cat5: number;
}
interface PatientCategoryDonutChartProps {
  counts: CategoryCounts;
  subtitle?: string;
  stacked?: boolean;
}

const CATEGORY_COLORS: Record<keyof CategoryCounts, string> = {
  cat1: "var(--category-1)",
  cat2: "var(--category-2)",
  cat3: "var(--category-3)",
  cat4: "var(--category-4)",
  cat5: "var(--category-5)",
};

export const PatientCategoryDonutChart: React.FC<
  PatientCategoryDonutChartProps
> = ({ counts, subtitle, stacked = false }) => {
  const [activeKey, setActiveKey] = useState<keyof CategoryCounts | null>(null);
  const total = PATIENT_CATEGORIES.reduce(
    (sum, item) => sum + (counts[item.key] || 0),
    0,
  );
  const size = 190;
  const center = size / 2;
  const radius = 67;
  const strokeWidth = 20;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = PATIENT_CATEGORIES.map((item, index) => {
    const value = counts[item.key] || 0;
    const fraction = total ? value / total : 0;
    const segment = {
      ...item,
      colorHex: CATEGORY_COLORS[item.key],
      value,
      percentage: fraction * 100,
      length: fraction * circumference,
      offset: -offset * circumference,
      compactLabel: `ประเภท ${index + 1}`,
    };
    offset += fraction;
    return segment;
  });
  const active = activeKey
    ? segments.find((item) => item.key === activeKey) || null
    : null;
  return (
    <div
      className={`flex flex-col items-center gap-6 ${stacked ? "" : "xl:flex-row"}`}
    >
      <div
        className="relative shrink-0"
        role="img"
        aria-label="กราฟโดนัทแสดงสัดส่วนผู้ป่วยประเภท 1 ถึง 5"
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden="true"
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth={strokeWidth}
          />
          {total > 0 && (
            <g transform={`rotate(-90 ${center} ${center})`}>
              {segments.map(
                (segment) =>
                  segment.value > 0 && (
                    <circle
                      key={segment.key}
                      cx={center}
                      cy={center}
                      r={radius}
                      fill="none"
                      stroke={segment.colorHex}
                      strokeWidth={
                        activeKey === segment.key
                          ? strokeWidth + 4
                          : strokeWidth
                      }
                      strokeDasharray={`${segment.length} ${circumference - segment.length}`}
                      strokeDashoffset={segment.offset}
                      className={`transition-opacity duration-200 ${activeKey && activeKey !== segment.key ? "opacity-30" : ""}`}
                      onMouseEnter={() => setActiveKey(segment.key)}
                      onMouseLeave={() => setActiveKey(null)}
                    >
                      <title>
                        {segment.label}: {segment.value} ราย (
                        {segment.percentage.toFixed(1)}%)
                      </title>
                    </circle>
                  ),
              )}
            </g>
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xs text-muted-foreground">
            {active?.compactLabel || "รวมจำแนกประเภท"}
          </span>
          <strong className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {active?.value ?? total}
          </strong>
          <span className="text-xs text-muted-foreground">
            {active ? `${active.percentage.toFixed(1)}%` : subtitle || "ราย"}
          </span>
        </div>
      </div>
      <div
        className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-1"
        role="group"
        aria-label="คำอธิบายสัดส่วนผู้ป่วย"
      >
        {segments.map((segment) => (
          <button
            key={segment.key}
            type="button"
            aria-label={`${segment.label}: ${segment.value} ราย (${segment.percentage.toFixed(1)}%)`}
            title={segment.shortLabel}
            className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-2.5 text-left transition-colors ${activeKey === segment.key ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
            onMouseEnter={() => setActiveKey(segment.key)}
            onMouseLeave={() => setActiveKey(null)}
            onFocus={() => setActiveKey(segment.key)}
            onBlur={() => setActiveKey(null)}
          >
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
              <span
                className="size-3 shrink-0 rounded-sm"
                style={{ backgroundColor: segment.colorHex }}
                aria-hidden="true"
              />
              <span className="whitespace-nowrap">{segment.compactLabel}</span>
            </span>
            <span className="shrink-0 text-right font-mono text-xs tabular-nums">
              <strong>{segment.value}</strong>
              <span className="ml-1 text-xs text-muted-foreground">
                ({segment.percentage.toFixed(1)}%)
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
