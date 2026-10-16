-- Keep internal census notes separate from text that may be sent to LINE.
ALTER TABLE "census_records"
ADD COLUMN "lineNote" TEXT NOT NULL DEFAULT '';

-- Existing settings must opt in explicitly before a LINE-safe note is sent.
UPDATE "app_settings" SET "includeNote" = FALSE;

-- Unsent legacy snapshots may contain the former internal note. Delete them so
-- the worker can materialize the latest due slot again with the LINE-safe note.
DELETE FROM "line_deliveries"
WHERE "status" <> 'ACCEPTED';

-- Accepted message bodies are no longer retained. Delivery metadata remains.
UPDATE "line_deliveries"
SET "messageText" = ''
WHERE "status" = 'ACCEPTED';

-- Existing auth tokens were stored before encrypted token storage was enabled.
-- Remove them so the auth worker cannot fall back to legacy plaintext values.
UPDATE "Account"
SET "accessToken" = NULL,
    "refreshToken" = NULL,
    "idToken" = NULL,
    "accessTokenExpiresAt" = NULL,
    "refreshTokenExpiresAt" = NULL;

CREATE TABLE "line_webhook_events" (
    "webhookEventId" VARCHAR(255) NOT NULL,
    "eventTimestamp" TIMESTAMP(3),
    "redelivered" BOOLEAN NOT NULL DEFAULT FALSE,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "line_webhook_events_pkey" PRIMARY KEY ("webhookEventId")
);

CREATE INDEX "line_webhook_event_received_at_idx"
ON "line_webhook_events"("receivedAt");

ALTER TABLE "line_webhook_events" ENABLE ROW LEVEL SECURITY;

DO $migration$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',
        'line_webhook_events',
        api_role
      );
    END IF;
  END LOOP;
END
$migration$;
