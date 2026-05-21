FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV ELN_SESSION_SECRET=build-time-placeholder-session-secret-change-me
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV ELN_DATA_DIR=/app-data/data
ENV ELN_UPLOAD_DIR=/app-data/uploads
ENV ELN_PREVIEW_DIR=/app-data/previews
ENV ELN_DATABASE_PATH=/app-data/data/eln.sqlite3

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fontconfig \
    fonts-dejavu-core \
    libreoffice \
    poppler-utils \
    sqlite3 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app ./

