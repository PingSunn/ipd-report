# LINE scheduled reporting service

The LINE worker is a separate server process. It reads PostgreSQL through Prisma, checks the configured Asia/Bangkok shift schedule approximately every 30 seconds, and sends the latest due slot. It does not run in a browser timer or as an in-request background task.

## LINE OA setup

1. Create a LINE Official Account and enable the Messaging API.
2. Enable the bot to join groups, then invite the OA into the target group.
3. Configure the webhook URL as an HTTPS endpoint and validate the signed webhook request with `LINE_CHANNEL_SECRET`. The webhook records verified group IDs for the settings UI.
4. Select a verified group in the settings UI and enable scheduled LINE reporting.

The server process needs `DATABASE_URL` and `LINE_CHANNEL_ACCESS_TOKEN`. The Next.js webhook needs `LINE_CHANNEL_SECRET`. Keep both values server-only; never put them in browser bundles, logs, or error messages. Scheduled reporting defaults to disabled until `lineEnabled` is explicitly enabled and a verified group is selected.

## Temporary local webhook tunnel

For local signed webhook discovery, run Next.js on port `40273` and start the narrow proxy separately:

```sh
# terminal 1
PORT=40273 bun run dev
# terminal 2
lsof -nP -iTCP:40473 -sTCP:LISTEN
bun run line:webhook-proxy
# terminal 3
cloudflared tunnel --url http://127.0.0.1:40473
```

The proxy binds to `127.0.0.1:40473` by default and forwards only an exact `POST /api/line/webhook` to `http://localhost:40273/api/line/webhook`. Every other method or path returns `404`. Requests are limited to the webhook's `1 MiB` body bound and a `14 second` proxy timeout, below the webhook transaction deadline. Configure `LINE_WEBHOOK_PROXY_HOST`, `LINE_WEBHOOK_PROXY_PORT`, `LINE_WEBHOOK_TARGET_HOST`, and `LINE_WEBHOOK_TARGET_PORT` when the local ports differ. Check the selected port with `lsof` before starting; use a free port instead of stopping another process.

Use the temporary HTTPS URL printed by `cloudflared` as the LINE webhook URL with the `/api/line/webhook` suffix. The URL changes when the tunnel restarts, so update the LINE console each time. Do not copy the actual temporary URL into source files, environment examples, committed logs, or documentation. This proxy only forwards signed webhook discovery; leave scheduled reporting disabled and do not start the worker while testing the tunnel.

## Schedule and catch-up policy

The fixed timezone is `Asia/Bangkok`. Each report date has three immutable slots:

- `ดึก`: the configured night time on the report date (default `08:00`)
- `เช้า`: the configured morning time on the report date (default `16:00`)
- `บ่าย`: the configured afternoon time on the report date when it is after the morning time (for example `23:30`), or on the following calendar date when it is before the night time (default `00:00`, referring to the previous report date)

The worker persists one `LineDelivery` per `(reportDate, shift)`. At restart it creates and processes only the latest due slot. Older pending slots become `SKIPPED` with a visible reason. A live lease or an in-flight result is changed only by its owning worker through a compare-and-set update.

If the census row does not exist when a slot is materialized, the worker snapshots a `MISSING` notice. It never fabricates totals. A later census edit does not resend an accepted missing notice, and saving a census row never sends immediately. A group change while a delivery is pending or being claimed skips the old destination so that a stale group is never sent.

## Delivery and retry policy

The transport follows the [LINE Messaging API retry guidance](https://developers.line.biz/en/reference/messaging-api/#retry-api-request) and push message contract. LINE account and plan push quotas still apply; a `429` is retried with bounded backoff and quota exhaustion is recorded as a retryable failure. A push request being accepted is the service's delivery limit: it does not provide an end-user receipt or read confirmation.

The message text and destination group are snapshots. Report text contains the reporting date and shift, selected census figures, and optional note, without hospital, ward, or reporter names, decorative dividers, or long section headings. Section flags apply at materialization time; detailed format always includes workload hours. Missing-data notices use the same date and shift header followed by a short notice. Text is split into at most five LINE text messages, each no longer than [LINE's 5000 UTF-16 code-unit limit](https://developers.line.biz/en/docs/messaging-api/text-character-count/) and never in the middle of a surrogate pair.

The worker claims and commits the delivery snapshot and retry key before contacting LINE. Final settings, group verification, provider request, and compare-and-set status update run under the shared PostgreSQL advisory lock. This serializes dispatch with settings updates and signed webhook leave events. The transport aborts a request before the 15-second transaction deadline, and an active worker lease is never overwritten by catch-up cleanup.

Every delivery has a persisted UUID retry key sent as `X-Line-Retry-Key`. Network failures, HTTP 429, and HTTP 5xx responses retry with bounded backoff. Other HTTP 4xx responses fail permanently. HTTP 409 counts as accepted only when `x-line-accepted-request-id` is present. The retry key is never replaced after a crash; retries are stopped after the 24-hour LINE retry-key safety window so the worker cannot make an ambiguous duplicate request. Provider acceptance is shown as `ACCEPTED`; it does not prove that every group member received the message.

Disabled reporting, a missing token, or a missing group prevents outbound requests and does not mark a delivery as sent. Run the worker separately from Next.js:

```sh
bun run line:worker
```

No service activation or real send occurs during development unless the server token, enabled setting, and selected group are all configured. Tests use injected mock transports.
