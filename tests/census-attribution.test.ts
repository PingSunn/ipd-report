import { describe, expect, it, vi } from "vitest";
import { getCensusAttributionDisplay } from "../src/utils/censusAttribution";
import { saveCensusRecord } from "../src/services/censusService";
import type { CensusRecord } from "../src/types/census";

const baseRecord: CensusRecord = {
  id: "attribution-test",
  date: "2026-10-16",
  shift: "เช้า",
  totalPatients: 12,
  capacity: 30,
  availableBeds: 18,
  newPatients: 1,
  discharges: 1,
  referrals: 0,
  cat1: 2,
  cat2: 3,
  cat3: 4,
  cat4: 2,
  cat5: 1,
  note: "",
  updatedAt: "2026-10-16T08:00:00.000Z",
};

describe("census attribution display", () => {
  it("shows one nickname when the creator also made the latest edit", () => {
    expect(getCensusAttributionDisplay({
      ...baseRecord,
      createdBy: { id: "user-1", displayName: "ปิง" },
      updatedBy: { id: "user-1", displayName: "ปิง" },
    })).toEqual({ primary: "บันทึกโดย ปิง", secondary: null });
  });

  it("shows creator and latest updater when they differ", () => {
    expect(getCensusAttributionDisplay({
      ...baseRecord,
      createdBy: { id: "user-1", displayName: "ปิง" },
      updatedBy: { id: "user-2", displayName: "ฝน" },
    })).toEqual({ primary: "บันทึกโดย ปิง", secondary: "แก้ล่าสุดโดย ฝน" });
  });

  it("attributes records without actors to the system once", () => {
    expect(getCensusAttributionDisplay(baseRecord)).toEqual({
      primary: "บันทึกโดย ระบบ/ไม่ทราบผู้บันทึก",
      secondary: null,
    });
  });
});

describe("census attribution persistence", () => {
  it("does not send read-only attribution fields when editing a record", async () => {
    const record = {
      ...baseRecord,
      createdBy: { id: "user-1", displayName: "ปิง" },
      updatedBy: { id: "user-2", displayName: "ฝน" },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ success: true, record })
    );

    await saveCensusRecord(record);

    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("createdBy");
    expect(body).not.toHaveProperty("updatedBy");
    fetchMock.mockRestore();
  });
});
