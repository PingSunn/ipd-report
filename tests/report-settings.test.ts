import { describe, expect, it } from "vitest";
import { generateLineShiftSummary, getLineReportOptions } from "../src/utils/censusUtils";
import type { CensusRecord } from "../src/types/census";

const record: CensusRecord = {
  id: "report-settings-test",
  date: "2026-10-14",
  shift: "เช้า",
  totalPatients: 12,
  capacity: 20,
  availableBeds: 8,
  newPatients: 2,
  discharges: 1,
  referrals: 0,
  cat1: 4,
  cat2: 3,
  cat3: 3,
  cat4: 1,
  cat5: 1,
  note: "ข้อมูลภายในที่ห้ามส่งออก",
  lineNote: "รอตรวจซ้ำ",
  updatedAt: "2026-10-14T02:00:00.000Z",
};

describe("shared report settings", () => {
  it("maps persisted report defaults into generator options", () => {
    expect(
      getLineReportOptions({
        hospitalName: "โรงพยาบาลทดสอบ",
        wardName: "หอผู้ป่วย A",
        reportFormat: "compact",
        includeCapacityAndOccupancy: false,
        includeCategories: false,
        includeWorkloadHours: true,
        includeNote: false,
      }),
    ).toEqual({
      format: "compact",
      includeCapacityAndOccupancy: false,
      includeCategories: false,
      includeWorkloadHours: true,
      includeNote: false,
      hospitalName: "โรงพยาบาลทดสอบ",
      wardName: "หอผู้ป่วย A",
    });
  });

  it("uses the same plain content layout for every report format", () => {
    const compact = generateLineShiftSummary(record, {
      format: "compact",
      hospitalName: "โรงพยาบาลทดสอบ",
      wardName: "หอผู้ป่วย A",
      reporterName: "พยาบาลเวรเช้า",
    });
    const standard = generateLineShiftSummary(record, { format: "standard" });
    const detailed = generateLineShiftSummary(record, { format: "detailed" });
    const expected = [
      "14 ต.ค. 2569 · เวรเช้า",
      "",
      "ผู้ป่วย 12 ราย · เตียงทั้งหมด 20 · เตียงว่าง 8 · ครองเตียง 60.0%",
      "รับใหม่ 2 · จำหน่าย 1 · ส่งต่อ 0",
      "",
      "ประเภทผู้ป่วย",
      "ประเภท 1 (อาการน้อยสุด): 4 ราย",
      "ประเภท 2 (อาการน้อย): 3 ราย",
      "ประเภท 3 (อาการปานกลาง): 3 ราย",
      "ประเภท 4 (อาการหนัก / กึ่งวิกฤต): 1 ราย",
      "ประเภท 5 (วิกฤต / หนักมาก): 1 ราย",
      "",
      "หมายเหตุสำหรับ LINE: รอตรวจซ้ำ",
    ].join("\n");

    expect(compact).toBe(expected);
    expect(standard).toBe(expected);
    expect(detailed).toBe(
      `${expected.replace("หมายเหตุสำหรับ LINE: รอตรวจซ้ำ", "ภาระงานพยาบาล 37 ชม./วัน\n\nหมายเหตุสำหรับ LINE: รอตรวจซ้ำ")}`,
    );
    expect(compact).not.toMatch(/โรงพยาบาลทดสอบ|หอผู้ป่วย A|พยาบาลเวรเช้า/);
  });

  it("maps detailed shared settings before generating copied summaries", () => {
    const options = getLineReportOptions({
      reportFormat: "detailed",
      includeWorkloadHours: false,
    });

    expect(generateLineShiftSummary(record, options)).toContain(
      "ภาระงานพยาบาล 37 ชม./วัน",
    );
  });

  it("respects persisted content flags", () => {
    expect(
      generateLineShiftSummary(record, {
        format: "standard",
        includeCapacityAndOccupancy: false,
        includeCategories: false,
        includeWorkloadHours: true,
        includeNote: false,
      }),
    ).toBe(
      [
        "14 ต.ค. 2569 · เวรเช้า",
        "",
        "ผู้ป่วย 12 ราย",
        "รับใหม่ 2 · จำหน่าย 1 · ส่งต่อ 0",
        "",
        "ภาระงานพยาบาล 37 ชม./วัน",
      ].join("\n"),
    );

    expect(
      generateLineShiftSummary(record, {
        format: "detailed",
        includeWorkloadHours: false,
        includeNote: false,
      }),
    ).toContain("ภาระงานพยาบาล 37 ชม./วัน");
  });
});
