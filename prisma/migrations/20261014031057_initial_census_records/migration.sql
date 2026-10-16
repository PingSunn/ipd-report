-- CreateTable
CREATE TABLE "census_records" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shift" VARCHAR(16) NOT NULL,
    "totalPatients" INTEGER NOT NULL DEFAULT 0,
    "capacity" INTEGER NOT NULL DEFAULT 30,
    "availableBeds" INTEGER NOT NULL DEFAULT 0,
    "newPatients" INTEGER NOT NULL DEFAULT 0,
    "discharges" INTEGER NOT NULL DEFAULT 0,
    "referrals" INTEGER NOT NULL DEFAULT 0,
    "cat1" INTEGER NOT NULL DEFAULT 0,
    "cat2" INTEGER NOT NULL DEFAULT 0,
    "cat3" INTEGER NOT NULL DEFAULT 0,
    "cat4" INTEGER NOT NULL DEFAULT 0,
    "cat5" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "census_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "census_record_date_idx" ON "census_records"("date");

-- CreateIndex
CREATE INDEX "census_record_updated_at_idx" ON "census_records"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "census_records_date_shift_key" ON "census_records"("date", "shift");
