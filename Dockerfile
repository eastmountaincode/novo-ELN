FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS dev
ENV NODE_ENV=development
ENV NOVO_INSTANCE=dev
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fontconfig \
    fonts-dejavu-core \
    libreoffice \
    poppler-utils \
    sqlite3 \
  && rm -rf /var/lib/apt/lists/*

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NOVO_BUILD_ID=unknown
ARG NOVO_BUILD_DATE
ENV NEXT_TELEMETRY_DISABLED=1
ENV NOVO_BUILD_ID=$NOVO_BUILD_ID
ENV NOVO_BUILD_DATE=$NOVO_BUILD_DATE
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
ARG NOVO_GIT_SHA=unknown
WORKDIR /app

ENV NODE_ENV=production
ENV NOVO_INSTANCE=prod
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV ELN_DATA_DIR=/app-data/data
ENV ELN_UPLOAD_DIR=/app-data/uploads
ENV ELN_PREVIEW_DIR=/app-data/previews
ENV ELN_DATABASE_PATH=/app-data/data/eln.sqlite3

LABEL org.opencontainers.image.revision=$NOVO_GIT_SHA

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

EXPOSE 3000
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]
