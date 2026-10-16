-- Keep persisted counts aligned with the form's nonnegative inputs. A census
-- may intentionally exceed capacity, and category totals may differ while a
-- report is being reconciled in the UI, so neither is constrained here.
ALTER TABLE "census_records"
    ADD CONSTRAINT "census_records_capacity_positive_check"
    CHECK ("capacity" >= 1),
    ADD CONSTRAINT "census_records_shift_check"
    CHECK ("shift" IN ('เช้า', 'บ่าย', 'ดึก')),
    ADD CONSTRAINT "census_records_nonnegative_counts_check"
    CHECK (
        "totalPatients" >= 0
        AND "availableBeds" >= 0
        AND "newPatients" >= 0
        AND "discharges" >= 0
        AND "referrals" >= 0
        AND "cat1" >= 0
        AND "cat2" >= 0
        AND "cat3" >= 0
        AND "cat4" >= 0
        AND "cat5" >= 0
    );
