import { describe, expect, it } from "vitest";
import { resolveEditingRecord } from "../src/utils/censusUtils";
import type { CensusRecord } from "../src/types/census";

const storedRecord: CensusRecord = {
  id: "edit-target",
  date: "2026-10-30",
  shift: "เช้า",
  totalPatients: 0,
  capacity: 30,
  availableBeds: 30,
  newPatients: 0,
  discharges: 0,
  referrals: 0,
  cat1: 0,
  cat2: 0,
  cat3: 0,
  cat4: 0,
  cat5: 0,
  note: "",
  updatedAt: "2026-10-30T01:00:00.000Z",
};

describe("entry form editing record", () => {
  it("keeps the record being edited when a background refresh returns the same record", () => {
    const refreshed: CensusRecord = { ...storedRecord };

    expect(resolveEditingRecord(storedRecord, refreshed)).toBe(storedRecord);
  });

  it("switches to the requested record when the requested id changes", () => {
    const other: CensusRecord = { ...storedRecord, id: "other-record" };

    expect(resolveEditingRecord(storedRecord, other)).toBe(other);
  });

  it("opens the requested record when nothing is being edited yet", () => {
    expect(resolveEditingRecord(null, storedRecord)).toBe(storedRecord);
  });
});
