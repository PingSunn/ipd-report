-- CreateTable
CREATE TABLE "app_settings" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'default',
    "hospitalName" VARCHAR(200) NOT NULL,
    "wardName" VARCHAR(120) NOT NULL,
    "defaultCapacity" INTEGER NOT NULL,
    "reportFormat" VARCHAR(16) NOT NULL,
    "includeCapacityAndOccupancy" BOOLEAN NOT NULL,
    "includeCategories" BOOLEAN NOT NULL,
    "includeWorkloadHours" BOOLEAN NOT NULL,
    "includeNote" BOOLEAN NOT NULL,
    "lineEnabled" BOOLEAN NOT NULL,
    "lineGroupId" VARCHAR(255) NOT NULL DEFAULT '',
    "nightSendTime" VARCHAR(5) NOT NULL,
    "morningSendTime" VARCHAR(5) NOT NULL,
    "afternoonSendTime" VARCHAR(5) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_worker_state" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'default',
    "lastSeenAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "line_worker_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verified_line_groups" (
    "groupId" VARCHAR(255) NOT NULL,
    "firstSeen" TIMESTAMP(3) NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verified_line_groups_pkey" PRIMARY KEY ("groupId")
);

-- CreateTable
CREATE TABLE "line_deliveries" (
    "id" UUID NOT NULL,
    "reportDate" DATE NOT NULL,
    "shift" VARCHAR(16) NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "messageText" TEXT NOT NULL,
    "groupId" VARCHAR(255) NOT NULL,
    "retryKey" UUID NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "firstAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "leaseOwner" VARCHAR(128),
    "acceptedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "line_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verified_line_group_last_seen_idx" ON "verified_line_groups"("lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX "line_deliveries_retryKey_key" ON "line_deliveries"("retryKey");

-- CreateIndex
CREATE INDEX "line_delivery_status_next_attempt_idx" ON "line_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "line_delivery_report_date_idx" ON "line_deliveries"("reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "line_deliveries_reportDate_shift_key" ON "line_deliveries"("reportDate", "shift");
