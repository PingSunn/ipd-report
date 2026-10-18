FROM oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS builder
WORKDIR /app
COPY . .
ARG NEXT_PUBLIC_APP_URL=https://ipd.pskwr.com
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma's config validates DIRECT_URL during generate and the Next.js build
# may import server modules. These values are build-only placeholders.
RUN DIRECT_URL=postgresql://build:build@127.0.0.1:5432/build \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    BETTER_AUTH_SECRET=build-only-secret-012345678901234567890123456789 \
    bun run build

FROM oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS ops
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma
USER bun
CMD ["bun", "run", "line:worker"]

FROM oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=40000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=bun:bun /app/.next/standalone ./
COPY --from=builder --chown=bun:bun /app/.next/static ./.next/static
USER bun
EXPOSE 40000
CMD ["bun", "server.js"]

# The backup image deliberately uses the PostgreSQL distribution image so that
# pg_dump and restore verification use a known PostgreSQL 18 client. Bun is
# copied from the already pinned runtime image; the backup job does not need
# the application, Prisma client, or migration artifacts.
FROM oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS backup-bun

FROM postgres:18-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c AS backup
WORKDIR /app
ENV NODE_ENV=production
COPY --from=backup-bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 app \
    && useradd --uid 1000 --gid 1000 --create-home --shell /usr/sbin/nologin app \
    && pg_dump --version
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --chown=1000:1000 scripts/backup ./scripts/backup
USER 1000:1000
ENTRYPOINT ["bun", "scripts/backup/run.ts"]
