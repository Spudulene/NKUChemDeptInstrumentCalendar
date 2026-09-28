# syntax=docker/dockerfile:1

# Container image for campus hosting.
#
# Two publishable stages, on purpose:
#
#   runner   — the application. Carries the standalone build and nothing else.
#   migrator — applies migrations, then exits. Installs just the Prisma CLI rather than
#              reusing the app's node_modules, and the app image never carries the CLI:
#              two ways of keeping ~170 MB of @prisma/engines, studio-core and dev out of
#              the container that serves traffic.
#
# Order matters on first deploy: migrations must land before the app serves traffic.
# compose.yaml encodes that with `service_completed_successfully`.

# ---------------------------------------------------------------------------------
FROM node:22-alpine AS deps
# ---------------------------------------------------------------------------------
WORKDIR /app

# The schema and config are copied before `npm ci` because the postinstall hook runs
# `prisma generate`, which reads both. It never opens a database connection.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci


# ---------------------------------------------------------------------------------
FROM node:22-alpine AS build
# ---------------------------------------------------------------------------------
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# src/lib/env.ts validates the whole environment the moment it is imported, and
# `next build` imports it while collecting routes — so the build needs these present
# even though it never connects to anything. They exist only in this layer; every real
# value arrives at runtime. Port 1 is deliberate: if a build ever did try to reach the
# database, it should fail loudly rather than quietly find something.
ENV DATABASE_URL="postgres://build:build@127.0.0.1:1/placeholder" \
    AUTH_SECRET="build-stage-placeholder-replaced-at-runtime" \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

RUN npm run build


# ---------------------------------------------------------------------------------
FROM node:22-alpine AS migrator
# ---------------------------------------------------------------------------------
# Run once per deploy, before the app starts. Exits when the schema is current.
WORKDIR /app

# The lockfile lands outside /app deliberately. `npm install <pkg>` in a directory that
# already has the app's package.json installs the app's whole dependency tree as well —
# that is how this image first came out at 1.5 GB with Next, TypeScript and Babel in it.
# A generated package.json keeps the install to what migrations actually need, and the
# versions still come from the lockfile so they cannot drift from the schema these
# migrations were written against.
COPY package-lock.json /tmp/package-lock.json

RUN PRISMA_VERSION="$(node -p "require('/tmp/package-lock.json').packages['node_modules/prisma'].version")" && \
    DOTENV_VERSION="$(node -p "require('/tmp/package-lock.json').packages['node_modules/dotenv'].version")" && \
    npm init -y > /dev/null && \
    npm install --omit=optional \
      "prisma@${PRISMA_VERSION}" \
      "dotenv@${DOTENV_VERSION}" && \
    npm cache clean --force && \
    rm -f /tmp/package-lock.json && \
    chown -R node:node /app

# Install scripts run above rather than being skipped: @prisma/engines prepares itself in
# its postinstall, and skipping that leaves it trying to do the work on first use — as a
# non-root user, against a read-only tree, which fails with "Can't write to
# /app/node_modules/@prisma/engines". The chown covers anything it still touches at run
# time. Both belong in the build, where the network is available and root still applies.

COPY prisma ./prisma
COPY prisma.config.ts ./

USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]


# ---------------------------------------------------------------------------------
FROM node:22-alpine AS runner
# ---------------------------------------------------------------------------------
WORKDIR /app

# tzdata is not optional. Bookings are stored as timestamptz and rendered in
# CAMPUS_TIMEZONE, and window expansion resolves wall-clock endpoints to get DST right.
# Without the zone database that arithmetic falls back to UTC — which looks fine all
# year and is wrong on exactly the two nights `npm run db:verify` exists to protect.
RUN apk add --no-cache tzdata

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Output tracing emits neither of these, so they are copied explicitly. Skip them and
# the app serves correct markup with no stylesheet and no favicon.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# uid 1000, already present in the base image. A request that achieved code execution
# should not be able to write to the image filesystem.
USER node

EXPOSE 3000

# No curl or wget in this image, so the check goes through node's own fetch. It asks
# /api/health, which queries Postgres — a process that is up but cannot reach the
# database is not serving anyone, and should not report healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

# server.js is what `output: 'standalone'` emits. Exec form, so it runs as PID 1 and
# receives SIGTERM directly: Next then drains in-flight requests and runs pending
# after() callbacks before exiting.
CMD ["node", "server.js"]
