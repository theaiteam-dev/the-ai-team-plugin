# syntax=docker/dockerfile:1
# Build context must be the repo root:
#   docker build -f packages/kanban-viewer/Dockerfile .

FROM node:20-slim AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy and build the shared package first
COPY packages/shared/package.json packages/shared/tsconfig.json ./shared/
COPY packages/shared/src ./shared/src
COPY packages/shared/dist ./shared/dist

# Copy kanban-viewer package.json and rewrite workspace:* to local path
COPY packages/kanban-viewer/package.json ./package.json
RUN sed -i 's|"workspace:\*"|"file:./shared"|g' package.json

# Install dependencies (fresh install for Linux platform)
RUN npm install

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/shared ./node_modules/@ai-team/shared
COPY packages/kanban-viewer/ .

# Seed the database into data.init/ — this is the factory-fresh DB baked into
# the image. At runtime the entrypoint copies it to the volume mount path on
# first boot so users get stages pre-configured without needing prisma at runtime.
ENV DATABASE_URL="file:./prisma/data.init/ateam.db"
RUN mkdir -p prisma/data.init && \
    npx prisma generate && \
    npx prisma db push --url "$DATABASE_URL" && \
    npx tsx prisma/seed.ts

# Build Next.js
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV DATABASE_URL="file:./prisma/data/ateam.db"

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built assets
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Install Prisma CLI for runtime schema migrations (db push on startup)
COPY --from=builder --chown=nextjs:nodejs /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma/prisma.config.ts ./prisma/prisma.config.ts
ARG PRISMA_VERSION=7.3.0
RUN npm install prisma@${PRISMA_VERSION} --no-save

# Copy the seeded factory database (used to initialize empty volume mounts)
COPY --from=builder --chown=nextjs:nodejs /app/prisma/data.init ./prisma/data.init

# Create the data directory that will be volume-mounted (empty — entrypoint initializes it)
RUN mkdir -p /app/prisma/data && chown nextjs:nodejs /app/prisma/data

# Entrypoint: initializes DB on first boot, then starts the server
COPY --chown=nextjs:nodejs packages/kanban-viewer/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Create mission directory mount point
RUN mkdir -p /app/mission && chown nextjs:nodejs /app/mission

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["./docker-entrypoint.sh"]
